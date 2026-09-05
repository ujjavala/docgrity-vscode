/**
 * Scan orchestrator — deterministic code drives the loop; the LLM only does
 * pairwise/per-doc semantic assessment. Confidence gates come from settings.
 */
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { collectCorpus, Doc } from './corpus';
import { selectCandidatePairs } from './candidates';
import { assessContradiction, assessDuplicate, assessOpenQuestions, OpenQuestion } from '../agents/assess';
import { Finding, FindingStore } from '../findings/store';
import { potentialOwner } from '../github/owners';
import { verifyExcerpts } from '../core/verify';
import { log } from '../log';

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

  progress.report({ message: 'Collecting markdown docs…' });
  const docs = await collectCorpus();
  const pairs = selectCandidatePairs(docs, maxPairs);
  log.info(`Scan started: ${docs.length} docs, ${pairs.length} candidate pairs (maxPairs=${maxPairs})`);
  const findings: Finding[] = [];
  const errors: string[] = [];
  const now = () => new Date().toISOString();

  let i = 0;
  for (const { a, b } of pairs) {
    if (token.isCancellationRequested) break;
    i++;
    progress.report({ message: `Assessing pair ${i}/${pairs.length}: ${a.relPath} ↔ ${b.relPath}` });

    try {
      const dup = await assessDuplicate(a, b, token);
      if (
        dup.output.is_duplicate &&
        dup.output.confidence >= tDup &&
        verify(dup.output.evidence, [a, b])
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
    } catch (err) {
      errors.push(`duplicate ${a.relPath}↔${b.relPath}: ${(err as Error).message}`);
      log.error(`Duplicate assessment failed for ${a.relPath} ↔ ${b.relPath}`, err);
    }

    try {
      const con = await assessContradiction(a, b, token);
      if (
        con.output.is_contradiction &&
        con.output.confidence >= tCon &&
        verify(con.output.evidence, [a, b])
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
    } catch (err) {
      errors.push(`contradiction ${a.relPath}↔${b.relPath}: ${(err as Error).message}`);
      log.error(`Contradiction assessment failed for ${a.relPath} ↔ ${b.relPath}`, err);
    }
  }

  let j = 0;
  for (const doc of docs) {
    if (token.isCancellationRequested) break;
    j++;
    progress.report({ message: `Open questions ${j}/${docs.length}: ${doc.relPath}` });
    try {
      const oq = await assessOpenQuestions(doc, token);
      const kept: OpenQuestion[] = oq.output.questions.filter(
        (q: OpenQuestion) => q.confidence >= tOq && verify([q], [doc])
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
    } catch (err) {
      errors.push(`open_question ${doc.relPath}: ${(err as Error).message}`);
      log.error(`Open-question assessment failed for ${doc.relPath}`, err);
    }
  }

  await store.replaceAll(findings);
  log.info(
    `Scan finished: ${findings.length} finding(s), ${errors.length} assessment error(s)` +
      (token.isCancellationRequested ? ' (cancelled early)' : '')
  );
  return { findings: findings.length, docs: docs.length, pairs: pairs.length, errors: errors.length };
}

async function ownersFor(docs: Doc[]): Promise<string[]> {
  const owners = new Set<string>();
  for (const d of docs) {
    const o = await potentialOwner(d.uri);
    if (o) owners.add(o);
  }
  return [...owners];
}
