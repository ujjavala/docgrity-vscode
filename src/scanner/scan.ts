/**
 * Scan orchestrator — deterministic code drives the loop; the LLM only does
 * pairwise/per-doc semantic assessment. Confidence gates come from settings.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { collectCorpus, Doc } from './corpus';
import { selectCandidatePairs } from './candidates';
import { assessContradiction, assessDuplicate, assessOpenQuestions, OpenQuestion } from '../agents/assess';
import { Finding, FindingStore } from '../findings/store';
import { potentialOwner } from '../github/owners';

function mkId(): string {
  return crypto.randomUUID();
}

/** Evidence excerpts must actually appear in the source doc (hallucination guard). */
function verifyExcerpts(excerpts: { excerpt: string }[], docs: Doc[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const haystacks = docs.map((d) => norm(d.text));
  return excerpts.every((e) => {
    const needle = norm(e.excerpt).slice(0, 200);
    return needle.length > 0 && haystacks.some((h) => h.includes(needle));
  });
}

export async function runScan(
  store: FindingStore,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<{ findings: number; docs: number; pairs: number }> {
  const cfg = vscode.workspace.getConfiguration('docgrity');
  const maxPairs = cfg.get<number>('maxPairs', 25);
  const tDup = cfg.get<number>('thresholds.duplicate', 0.75);
  const tCon = cfg.get<number>('thresholds.contradiction', 0.7);
  const tOq = cfg.get<number>('thresholds.openQuestion', 0.6);

  progress.report({ message: 'Collecting markdown docs…' });
  const docs = await collectCorpus();
  const pairs = selectCandidatePairs(docs, maxPairs);
  const findings: Finding[] = [];
  const now = () => new Date().toISOString();

  let i = 0;
  for (const { a, b } of pairs) {
    if (token.isCancellationRequested) break;
    i++;
    progress.report({ message: `Assessing pair ${i}/${pairs.length}: ${a.relPath} ↔ ${b.relPath}` });

    const dup = await assessDuplicate(a, b, token);
    if (
      dup.output.is_duplicate &&
      dup.output.confidence >= tDup &&
      verifyExcerpts(dup.output.evidence, [a, b])
    ) {
      findings.push({
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
        createdAt: now(),
      });
    }

    const con = await assessContradiction(a, b, token);
    if (
      con.output.is_contradiction &&
      con.output.confidence >= tCon &&
      verifyExcerpts(con.output.evidence, [a, b])
    ) {
      findings.push({
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
        createdAt: now(),
      });
    }
  }

  let j = 0;
  for (const doc of docs) {
    if (token.isCancellationRequested) break;
    j++;
    progress.report({ message: `Open questions ${j}/${docs.length}: ${doc.relPath}` });
    const oq = await assessOpenQuestions(doc, token);
    const kept: OpenQuestion[] = oq.output.questions.filter(
      (q: OpenQuestion) => q.confidence >= tOq && verifyExcerpts([q], [doc])
    );
    if (kept.length > 0) {
      findings.push({
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
      });
    }
  }

  await store.replaceAll(findings);
  return { findings: findings.length, docs: docs.length, pairs: pairs.length };
}

async function ownersFor(docs: Doc[]): Promise<string[]> {
  const owners = new Set<string>();
  for (const d of docs) {
    const o = await potentialOwner(d.uri);
    if (o) owners.add(o);
  }
  return [...owners];
}
