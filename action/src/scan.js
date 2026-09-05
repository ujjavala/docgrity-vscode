/**
 * Scan orchestrator — deterministic loop, LLM only for semantic assessment.
 * Evidence excerpts are verified verbatim against sources (hallucination guard).
 * Each finding gets a stable fingerprint for issue deduplication and trends.
 */
import crypto from 'crypto';
import { collectCorpus, selectCandidatePairs, potentialOwner } from './corpus.js';
import { assessContradiction, assessDuplicate, assessOpenQuestions } from './llm.js';

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function verifyExcerpts(excerpts, docs) {
  const haystacks = docs.map((d) => norm(d.text));
  return excerpts.every((e) => {
    const needle = norm(e.excerpt).slice(0, 200);
    return needle.length > 0 && haystacks.some((h) => h.includes(needle));
  });
}

/** Stable across runs: type + files + first evidence excerpt (normalized). */
function fingerprint(type, files, firstExcerpt) {
  return crypto
    .createHash('sha256')
    .update(`${type}|${[...files].sort().join('|')}|${norm(firstExcerpt).slice(0, 120)}`)
    .digest('hex')
    .slice(0, 16);
}

export async function runScan(root, opts = {}) {
  const {
    client,
    maxFiles = 200,
    maxPairs = 25,
    thresholds = { duplicate: 0.75, contradiction: 0.7, openQuestion: 0.6 },
    checks = { duplicates: true, contradictions: true, openQuestions: true },
    log = () => {},
  } = opts;

  const docs = await collectCorpus(root, { maxFiles });
  // Pair selection is only needed for the pairwise checks.
  const pairs = checks.duplicates || checks.contradictions ? selectCandidatePairs(docs, maxPairs) : [];
  log(`Corpus: ${docs.length} markdown docs; assessing ${pairs.length} candidate pairs`);
  const findings = [];
  const now = new Date().toISOString();

  const owners = async (ds) => {
    const set = new Set();
    for (const d of ds) {
      const o = await potentialOwner(root, d.relPath);
      if (o) set.add(o);
    }
    return [...set];
  };

  let i = 0;
  for (const { a, b } of pairs) {
    i++;
    log(`Pair ${i}/${pairs.length}: ${a.relPath} <-> ${b.relPath}`);
    const dup = checks.duplicates ? await assessDuplicate(client, a, b) : null;
    if (
      dup &&
      dup.output.is_duplicate &&
      dup.output.confidence >= thresholds.duplicate &&
      verifyExcerpts(dup.output.evidence, [a, b])
    ) {
      const files = [a.relPath, b.relPath];
      findings.push({
        fingerprint: fingerprint('duplicate', files, dup.output.evidence[0]?.excerpt ?? dup.output.summary),
        type: 'duplicate',
        severity: 'MEDIUM',
        confidence: dup.output.confidence,
        summary: dup.output.summary,
        detail: { recommended_action: dup.output.recommended_action },
        evidence: dup.output.evidence.map((e) => ({
          sourceLabel: e.page === 'A' ? a.relPath : b.relPath,
          excerpt: e.excerpt,
        })),
        files,
        potentialOwners: await owners([a, b]),
        model: dup.model,
        promptVersion: dup.promptVersion,
        createdAt: now,
      });
    }

    const con = checks.contradictions ? await assessContradiction(client, a, b) : null;
    if (
      con &&
      con.output.is_contradiction &&
      con.output.confidence >= thresholds.contradiction &&
      verifyExcerpts(con.output.evidence, [a, b])
    ) {
      const files = [a.relPath, b.relPath];
      findings.push({
        fingerprint: fingerprint('contradiction', files, con.output.evidence[0]?.excerpt ?? con.output.summary),
        type: 'contradiction',
        severity: con.output.severity,
        confidence: con.output.confidence,
        summary: con.output.summary,
        detail: { conflicting_claims: con.output.conflicting_claims },
        evidence: con.output.evidence.map((e) => ({
          sourceLabel: e.page === 'A' ? a.relPath : b.relPath,
          excerpt: e.excerpt,
        })),
        files,
        potentialOwners: await owners([a, b]),
        model: con.model,
        promptVersion: con.promptVersion,
        createdAt: now,
      });
    }
  }

  let j = 0;
  const oqDocs = checks.openQuestions ? docs : [];
  for (const doc of oqDocs) {
    j++;
    log(`Open questions ${j}/${oqDocs.length}: ${doc.relPath}`);
    const oq = await assessOpenQuestions(client, doc);
    const kept = oq.output.questions.filter(
      (q) => q.confidence >= thresholds.openQuestion && verifyExcerpts([q], [doc])
    );
    if (kept.length > 0) {
      findings.push({
        fingerprint: fingerprint('open_question', [doc.relPath], kept[0].excerpt),
        type: 'open_question',
        severity: kept.some((q) => q.severity === 'HIGH') ? 'HIGH' : 'MEDIUM',
        confidence: Math.max(...kept.map((q) => q.confidence)),
        summary: `${kept.length} unresolved question(s) in ${doc.relPath}`,
        detail: { questions: kept },
        evidence: kept.map((q) => ({ sourceLabel: doc.relPath, excerpt: q.excerpt })),
        files: [doc.relPath],
        potentialOwners: await owners([doc]),
        model: oq.model,
        promptVersion: oq.promptVersion,
        createdAt: now,
      });
    }
  }

  return { findings, stats: { docs: docs.length, pairs: pairs.length, scannedAt: now } };
}
