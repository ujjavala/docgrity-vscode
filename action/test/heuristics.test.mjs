/**
 * heuristics.js tests — no-agent mode. Focus: false positives (must NOT fire),
 * false negatives (must fire), confidence calibration, evidence verbatim-ness,
 * and end-to-end runScan with client=null (contradictions skipped).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { heuristicDuplicate, heuristicOpenQuestions, sharedBlocks, templateIssue } from '../src/heuristics.js';
import { runScan } from '../src/scan.js';

const doc = (relPath, text) => ({ relPath, text, hash: relPath });

const PARA =
  'The payments service is deployed with a canary rollout strategy. Traffic shifts in 10% increments while Grafana dashboards track error rates and latency. A rollback is triggered automatically if the error budget is exceeded during any increment window.';

// ---------- duplicates: true positives ----------

test('duplicate: identical docs fire with high confidence', () => {
  const a = doc('a.md', `# Deploy guide\n\n${PARA}\n\n${PARA}`);
  const b = doc('b.md', `# Release notes\n\n${PARA}\n\n${PARA}`);
  const r = heuristicDuplicate(a, b, 0.9);
  assert.equal(r.output.is_duplicate, true);
  assert.ok(r.output.confidence >= 0.75, `confidence ${r.output.confidence} should pass default threshold`);
  assert.ok(r.output.evidence.length > 0, 'must carry evidence');
});

test('duplicate: evidence is verbatim from the source (hallucination guard passes)', () => {
  const a = doc('a.md', `Intro text here.\n\n${PARA}\n\nOutro.`);
  const b = doc('b.md', `Other intro.\n\n${PARA}\n\nOther outro.`);
  const r = heuristicDuplicate(a, b, 0.7);
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const e of r.output.evidence) {
    assert.ok(norm(a.text).includes(norm(e.excerpt).slice(0, 200)), 'excerpt must exist verbatim in source A');
    assert.ok(norm(b.text).includes(norm(e.excerpt).slice(0, 200)), 'excerpt must exist verbatim in source B');
  }
});

test('duplicate: partial copy-paste (one shared section) still detected', () => {
  const unique1 = 'Gardening requires patience, good soil, regular watering and plenty of morning sunlight for tulips.';
  const unique2 = 'Astronomy rewards the patient observer: telescopes, dark skies, and star charts open up the galaxy.';
  const a = doc('a.md', `${unique1}\n\n${PARA}\n\n${unique1}`);
  const b = doc('b.md', `${unique2}\n\n${PARA}\n\n${unique2}`);
  const r = heuristicDuplicate(a, b, 0.65);
  assert.equal(r.output.is_duplicate, true, 'shared verbatim section must be detected');
});

// ---------- duplicates: false-positive guards ----------

test('duplicate FP guard: similar vocabulary but no verbatim overlap must NOT fire', () => {
  const a = doc(
    'a.md',
    'The payments service deployment uses canary rollout with Grafana monitoring of error rates and latency budgets across increments. '.repeat(3)
  );
  const b = doc(
    'b.md',
    'Canary rollouts for deploying the payments service rely on monitoring latency and error-rate budgets in Grafana during each increment. '.repeat(3)
  );
  const r = heuristicDuplicate(a, b, 0.85); // high TF-IDF similarity, zero shared lines
  assert.equal(r.output.is_duplicate, false, 'paraphrase must not be flagged by heuristics');
});

test('duplicate FP guard: shared code fences alone must NOT fire', () => {
  const code = '```js\nconst deploy = await canaryRollout({ service: "payments", steps: 10, dashboards: grafana });\nawait verifyErrorBudget(deploy);\n```';
  const a = doc('a.md', `About tulip gardening, soil preparation and watering schedules for spring.\n${code}\nMore prose on gardening and greenhouse maintenance through winter months here.`);
  const b = doc('b.md', `Notes on telescope calibration, star charts and long-exposure photography.\n${code}\nFurther prose about astronomy clubs and dark-sky reserves in the region.`);
  const r = heuristicDuplicate(a, b, 0.4);
  assert.equal(r.output.is_duplicate, false, 'code samples are not doc duplication');
});

test('duplicate FP guard: shared boilerplate headings/short lines must NOT fire', () => {
  const boiler = '# Overview\n\n## Getting started\n\n## Configuration\n\n## FAQ\n';
  const a = doc('a.md', `${boiler}\nGardening prose about tulips, soil, watering and sunlight goes here at length for the corpus.`);
  const b = doc('b.md', `${boiler}\nAstronomy prose about telescopes, galaxies, orbits and observation goes here at length too.`);
  const r = heuristicDuplicate(a, b, 0.3);
  assert.equal(r.output.is_duplicate, false, 'structural boilerplate is not duplication');
});

test('duplicate: unrelated docs get near-zero confidence', () => {
  const a = doc('a.md', 'Gardening: tulips, soil, watering, sunlight, greenhouse, compost, pruning, spring planting guide.');
  const b = doc('b.md', 'Astronomy: telescope, galaxy, nebula, orbit, planets, observation, star charts, dark skies.');
  const r = heuristicDuplicate(a, b, 0.02);
  assert.equal(r.output.is_duplicate, false);
  assert.ok(r.output.confidence < 0.2, `confidence should be near zero, got ${r.output.confidence}`);
});

// ---------- confidence calibration ----------

test('duplicate confidence: full copy scores higher than partial copy', () => {
  const filler = 'Unique filler prose about something else entirely, long enough to matter for ratios and lengths.';
  const full = heuristicDuplicate(doc('a.md', `${PARA}\n${PARA}`), doc('b.md', `${PARA}\n${PARA}`), 0.95);
  const partial = heuristicDuplicate(
    doc('a.md', `${PARA}\n${filler}\n${filler}\n${filler}`),
    doc('b.md', `${PARA}\nCompletely different content about star charts and telescope calibration sessions.\n${filler.toUpperCase()}`),
    0.5
  );
  assert.ok(full.output.confidence > partial.output.confidence,
    `full copy (${full.output.confidence}) must outrank partial (${partial.output.confidence})`);
  assert.ok(full.output.confidence <= 0.99, 'confidence is capped below 1 — heuristics are never certain');
});

// ---------- shared blocks ----------

test('sharedBlocks: finds the shared run, ignores non-shared lines', () => {
  const a = `alpha line that is unique to document a and long enough\n${PARA}\nsecond shared line follows the paragraph and is also quite long indeed\nomega unique closer for document a`;
  const b = `${PARA}\nsecond shared line follows the paragraph and is also quite long indeed\nunrelated ending for document b entirely`;
  const blocks = sharedBlocks(a, b);
  assert.ok(blocks.length >= 1);
  assert.ok(blocks[0].text.includes('second shared line'));
  assert.ok(!blocks[0].text.includes('alpha line'));
});

// ---------- open questions: true positives ----------

test('open questions: detects TODO, TBD, FIXME, ???, and explicit language', () => {
  const d = doc('q.md', [
    '# Design notes',
    'TODO: decide on the retry budget for the payments client.',
    'The rollout cadence is TBD pending capacity review.',
    'FIXME the diagram below is stale.',
    'What port does staging use??? nobody has confirmed.',
    'This remains an open question for the platform team.',
    'A perfectly settled statement with no markers at all.',
  ].join('\n'));
  const r = heuristicOpenQuestions(d);
  const qs = r.output.questions;
  assert.equal(qs.length, 5, `expected 5 findings, got ${qs.length}: ${qs.map((q) => q.question).join(' | ')}`);
  assert.ok(qs.every((q) => q.confidence >= 0.85), 'deterministic markers get high confidence');
  assert.ok(qs.every((q) => d.text.includes(q.excerpt)), 'every excerpt is verbatim');
});

test('open questions: confidence reflects marker determinism (TODO > vague language)', () => {
  const r = heuristicOpenQuestions(doc('q.md', 'TODO: fix the deploy docs before release.\nThe budget is undecided at this stage of planning.'));
  const todo = r.output.questions.find((q) => q.excerpt.includes('TODO'));
  const vague = r.output.questions.find((q) => q.excerpt.includes('undecided'));
  assert.ok(todo.confidence > vague.confidence, 'explicit marker must outrank fuzzy language');
});

// ---------- open questions: false-positive guards ----------

test('open questions FP guard: markers inside code fences are ignored', () => {
  const d = doc('q.md', 'Settled prose describing the deployment pipeline in detail.\n```js\n// TODO: refactor this helper\nconst x = tbd();\n```\nMore settled prose after the code sample, still no doc-level markers.');
  assert.equal(heuristicOpenQuestions(d).output.questions.length, 0, 'code TODOs are code concerns, not doc integrity');
});

test('open questions FP guard: ordinary questions and benign words do not fire', () => {
  const d = doc('q.md', [
    '## FAQ',
    'How do I deploy? Run the release workflow from the Actions tab.',
    'Is rollback automatic? Yes, when the error budget is exceeded.',
    'The tool determined the best route automatically.', // "determined" ≠ "to be determined"
    'We decided on canary rollouts last quarter.',
  ].join('\n'));
  assert.equal(heuristicOpenQuestions(d).output.questions.length, 0, 'answered FAQs and benign words must not fire');
});

test('open questions FP guard: single or double question marks do not fire', () => {
  const d = doc('q.md', 'Why does this work? Because the fingerprint is stable.\nReally?? Yes, verified in tests.');
  assert.equal(heuristicOpenQuestions(d).output.questions.length, 0);
});

test('open questions: duplicate lines are deduplicated', () => {
  const d = doc('q.md', 'TODO: fill in the oncall rota.\nTODO: fill in the oncall rota.');
  assert.equal(heuristicOpenQuestions(d).output.questions.length, 1);
});

// ---------- template issue drafting (no LLM) ----------

test('templateIssue: builds a complete issue body without a model', () => {
  const f = {
    type: 'duplicate',
    severity: 'MEDIUM',
    confidence: 0.82,
    summary: 'Verbatim duplicated content between "a.md" and "b.md"',
    files: ['a.md', 'b.md'],
    potentialOwners: ['Ujjavala Singh'],
    evidence: [{ sourceLabel: 'a.md', excerpt: 'shared paragraph text' }],
  };
  const draft = templateIssue(f);
  assert.ok(draft.title.startsWith('[docgrity] duplicate:'));
  assert.ok(draft.body.includes('shared paragraph text'));
  assert.ok(draft.body.includes('potential, not asserted'));
  assert.ok(draft.title.length <= 200 && draft.body.length <= 20000);
});

// ---------- end-to-end: runScan with client=null ----------

test('runScan no-agent: finds duplicates + open questions, skips contradictions with a note', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'docgrity-noagent-'));
  try {
    const shared = `${PARA}\n\n${PARA}`;
    await writeFile(path.join(root, 'deploy.md'), `# Deploy\n\n${shared}\n\nTODO: document the rollback runbook.`);
    await writeFile(path.join(root, 'release.md'), `# Release\n\n${shared}\n\nAll settled here.`);
    await writeFile(path.join(root, 'faq.md'), 'How do I deploy? Use the workflow. Fully answered, nothing unresolved, plenty of settled prose to pass the corpus minimum length.');

    const logs = [];
    const { findings, stats } = await runScan(root, { client: null, log: (m) => logs.push(m) });

    assert.equal(stats.mode, 'heuristic');
    assert.ok(stats.notes?.some((n) => /contradiction/i.test(n) && /AI/i.test(n)), 'stats must carry the contradictions-need-AI note');

    const types = new Set(findings.map((f) => f.type));
    assert.ok(types.has('duplicate'), 'must find the copy-pasted section');
    assert.ok(types.has('open_question'), 'must find the TODO');
    assert.ok(!types.has('contradiction'), 'no contradictions in no-agent mode');
    assert.ok(findings.every((f) => f.method === 'heuristic'));
    assert.ok(findings.every((f) => typeof f.fingerprint === 'string' && f.fingerprint.length === 16), 'fingerprints still stable for issue dedupe');
    // faq.md must be clean (false-positive check end-to-end).
    assert.ok(!findings.some((f) => f.files.includes('faq.md')), 'faq.md must have no findings');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runScan no-agent: clean corpus yields zero findings (false-positive sweep)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'docgrity-clean-'));
  try {
    await writeFile(path.join(root, 'one.md'), 'Gardening: tulips need well-drained soil, morning sunlight and a weekly watering schedule through spring and early summer months.');
    await writeFile(path.join(root, 'two.md'), 'Astronomy: long-exposure photography of nebulae requires a tracking mount, dark skies and patience across many observation sessions.');
    const { findings, stats } = await runScan(root, { client: null });
    assert.equal(findings.length, 0, `clean corpus produced findings: ${JSON.stringify(findings.map((f) => f.summary))}`);
    assert.equal(stats.mode, 'heuristic');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
