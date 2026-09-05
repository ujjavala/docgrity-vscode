/**
 * Scan orchestrator — deterministic code drives the loop; the LLM only does
 * pairwise/per-doc semantic assessment. Confidence gates come from settings.
 */
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { collectCorpus, Doc } from './corpus';
import { selectCandidatePairs } from './candidates';
import { assessContradiction, assessDuplicate, assessOpenQuestions, assessPair, OpenQuestion } from '../agents/assess';
import { heuristicDuplicate, heuristicOpenQuestions } from './heuristics';
import { Finding, FindingStore } from '../findings/store';
import { potentialOwner } from '../github/owners';
import { verifyExcerpts } from '../core/verify';
import { hasOpenQuestionSignals, mapLimit } from '../core/prefilter';
import { log } from '../log';

/** Bounded parallelism for LLM assessments — keeps the UI responsive and stays
 * well under provider rate limits while roughly 4x-ing scan throughput. */
const CONCURRENCY = 4;

function mkId(): string {
  return crypto.randomUUID();
}

function verify(excerpts: { excerpt: string }[], docs: Doc[]): boolean {
  const ok = verifyExcerpts(excerpts, docs.map((d) => d.text));
  if (!ok) log.warn(`Evidence failed verbatim verification; finding dropped (${docs.map((d) => d.relPath).join(', ')})`);
  return ok;
}

export async function runScan(
  store: FindingStore,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<{ findings: number; docs: number; pairs: number; errors: number }> {
  const cfg = vscode.workspace.getConfiguration('docgrity');
  const maxPairs = cfg.get<number>('maxPairs', 25);
  const tDup = cfg.get<number>('thresholds.duplicate', 0.75);
  const tCon = cfg.get<number>('thresholds.contradiction', 0.7);
  const tOq = cfg.get<number>('thresholds.openQuestion', 0.6);
  const checkDup = cfg.get<boolean>('checks.duplicates', true);
  const checkCon = cfg.get<boolean>('checks.contradictions', true);
  const checkOq = cfg.get<boolean>('checks.openQuestions', true);
  // No-agent mode: pure algorithms, zero LLM calls. Duplicates (verbatim
  // shared blocks) and open questions (explicit markers) work; contradictions
  // require AI intelligence and are skipped — the user is told, not guessed at.
  const heuristic = cfg.get<string>('engine', 'ai') === 'no-agent';

  if (!checkDup && !checkCon && !checkOq) {
    throw new Error('All checks are disabled — enable at least one docgrity.checks.* setting.');
  }
  if (heuristic && checkCon) {
    log.info('No-agent mode: contradiction detection requires an AI model — skipped.');
    void vscode.window.showInformationMessage(
      'Docgrity no-agent mode: duplicates and open questions are detected algorithmically; contradiction detection needs an AI model and is skipped.'
    );
  }

  progress.report({ message: 'Collecting markdown docs…' });
  const docs = await collectCorpus();
  // Pair selection is only needed for the pairwise checks.
  const pairs = checkDup || checkCon ? selectCandidatePairs(docs, maxPairs) : [];
  log.info(
    `Scan started: ${docs.length} docs, ${pairs.length} candidate pairs (maxPairs=${maxPairs}, ` +
      `checks: dup=${checkDup} con=${checkCon} oq=${checkOq})`
  );
  const findings: Finding[] = [];
  const errors: string[] = [];
  const now = () => new Date().toISOString();

  let i = 0;
  const pairResults = await mapLimit(pairs, CONCURRENCY, async ({ a, b, similarity }) => {
    if (token.isCancellationRequested) return null;
    i++;
    progress.report({ message: `Assessing pair ${i}/${pairs.length}: ${a.relPath} ↔ ${b.relPath}` });

    const out: Finding[] = [];

    if (heuristic) {
      if (checkDup) {
        const df = await duplicateFinding(heuristicDuplicate(a, b, similarity), a, b, tDup);
        if (df) out.push(df);
      }
      return out; // contradictions skipped — they need AI
    }
    if (checkDup && checkCon) {
      // Combined single-call assessment: the model reads the pair once.
      const pair = await assessPair(a, b, token);
      const dup = { output: pair.output.duplicate, model: pair.model, promptVersion: pair.promptVersion };
      const con = { output: pair.output.contradiction, model: pair.model, promptVersion: pair.promptVersion };
      const df = await duplicateFinding(dup, a, b, tDup);
      if (df) out.push(df);
      const cf = await contradictionFinding(con, a, b, tCon);
      if (cf) out.push(cf);
      return out;
    }
    if (checkDup) {
      const df = await duplicateFinding(await assessDuplicate(a, b, token), a, b, tDup);
      if (df) out.push(df);
    }
    if (checkCon) {
      const cf = await contradictionFinding(await assessContradiction(a, b, token), a, b, tCon);
      if (cf) out.push(cf);
    }
    return out;
  });
  for (let k = 0; k < pairResults.length; k++) {
    const r = pairResults[k];
    if (r.ok) {
      if (r.value) findings.push(...r.value);
    } else {
      const { a, b } = pairs[k];
      errors.push(`pair ${a.relPath}↔${b.relPath}: ${r.error.message}`);
      log.error(`Pair assessment failed for ${a.relPath} ↔ ${b.relPath}`, r.error);
    }
  }

  if (checkOq) {
    // Cheap heuristic gate: only docs showing open-question signals
    // (TODO/TBD/???, unanswered question lines) get an LLM call.
    const oqDocs = docs.filter((d) => hasOpenQuestionSignals(d.text));
    log.info(`Open-question pre-filter: ${oqDocs.length}/${docs.length} docs have signals`);
    let j = 0;
    const oqResults = await mapLimit(oqDocs, CONCURRENCY, async (doc) => {
      if (token.isCancellationRequested) return null;
      j++;
      progress.report({ message: `Open questions ${j}/${oqDocs.length}: ${doc.relPath}` });
      const oq = heuristic ? heuristicOpenQuestions(doc) : await assessOpenQuestions(doc, token);
      const kept: OpenQuestion[] = oq.output.questions.filter(
        (q: OpenQuestion) => q.confidence >= tOq && verify([q], [doc])
      );
      if (kept.length === 0) return null;
      const finding: Finding = {
        id: mkId(),
        type: 'open_question',
        severity: kept.some((q) => q.severity === 'HIGH') ? 'HIGH' : 'MEDIUM',
        confidence: Math.max(...kept.map((q) => q.confidence)),
        summary: `${kept.length} unresolved question(s) in ${doc.relPath}`,
        detail: { questions: kept },
        evidence: kept.map((q) => ({ sourceLabel: doc.relPath, excerpt: q.excerpt })),
        files: [doc.relPath],
        potentialOwners: await ownersFor([doc]),
        model: oq.model,
        promptVersion: oq.promptVersion,
        createdAt: now(),
      };
      return finding;
    });
    for (let k = 0; k < oqResults.length; k++) {
      const r = oqResults[k];
      if (r.ok) {
        if (r.value) findings.push(r.value);
      } else {
        errors.push(`open_question ${oqDocs[k].relPath}: ${r.error.message}`);
        log.error(`Open-question assessment failed for ${oqDocs[k].relPath}`, r.error);
      }
    }
  }

  await store.replaceAll(findings);
  log.info(
    `Scan finished: ${findings.length} finding(s), ${errors.length} assessment error(s)` +
      (token.isCancellationRequested ? ' (cancelled early)' : '')
  );
  return { findings: findings.length, docs: docs.length, pairs: pairs.length, errors: errors.length };
}

type Assessed<T> = { output: T; model: string; promptVersion: string };

async function duplicateFinding(
  dup: Assessed<{ is_duplicate: boolean; confidence: number; summary: string; recommended_action: string; evidence: { page: string; excerpt: string }[] }>,
  a: Doc,
  b: Doc,
  threshold: number
): Promise<Finding | null> {
  if (!dup.output.is_duplicate || dup.output.confidence < threshold || !verify(dup.output.evidence, [a, b])) {
    return null;
  }
  return {
    id: mkId(),
    type: 'duplicate',
    severity: 'MEDIUM',
    confidence: dup.output.confidence,
    summary: dup.output.summary,
    detail: { recommended_action: dup.output.recommended_action },
    evidence: dup.output.evidence.map((e) => ({
      sourceLabel: e.page === 'A' ? a.relPath : b.relPath,
      excerpt: e.excerpt,
    })),
    files: [a.relPath, b.relPath],
    potentialOwners: await ownersFor([a, b]),
    model: dup.model,
    promptVersion: dup.promptVersion,
    createdAt: new Date().toISOString(),
  };
}

async function contradictionFinding(
  con: Assessed<{ is_contradiction: boolean; confidence: number; severity: string; summary: string; conflicting_claims: string[]; evidence: { page: string; excerpt: string }[] }>,
  a: Doc,
  b: Doc,
  threshold: number
): Promise<Finding | null> {
  if (!con.output.is_contradiction || con.output.confidence < threshold || !verify(con.output.evidence, [a, b])) {
    return null;
  }
  return {
    id: mkId(),
    type: 'contradiction',
    severity: con.output.severity,
    confidence: con.output.confidence,
    summary: con.output.summary,
    detail: { conflicting_claims: con.output.conflicting_claims },
    evidence: con.output.evidence.map((e) => ({
      sourceLabel: e.page === 'A' ? a.relPath : b.relPath,
      excerpt: e.excerpt,
    })),
    files: [a.relPath, b.relPath],
    potentialOwners: await ownersFor([a, b]),
    model: con.model,
    promptVersion: con.promptVersion,
    createdAt: new Date().toISOString(),
  };
}

async function ownersFor(docs: Doc[]): Promise<string[]> {
  const owners = new Set<string>();
  for (const d of docs) {
    const o = await potentialOwner(d.uri);
    if (o) owners.add(o);
  }
  return [...owners];
}
