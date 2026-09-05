import { describe, it, expect } from 'vitest';
import { heuristicDuplicate, heuristicOpenQuestions, sharedBlocks } from '../src/scanner/heuristics';
import { verifyExcerpts } from '../src/core/verify';
import type { Doc } from '../src/scanner/corpus';

function doc(relPath: string, text: string): Doc {
  return { relPath, text, uri: undefined as never, hash: relPath };
}

const PARA =
  'The payments service is deployed with a canary rollout strategy. Traffic shifts in 10% increments while Grafana dashboards track error rates and latency. A rollback is triggered automatically if the error budget is exceeded during any increment window.';

describe('heuristicDuplicate (no-agent mode)', () => {
  it('flags identical content with high confidence and verbatim evidence', () => {
    const a = doc('a.md', `# Deploy\n\n${PARA}\n\n${PARA}`);
    const b = doc('b.md', `# Release\n\n${PARA}\n\n${PARA}`);
    const r = heuristicDuplicate(a, b, 0.9);
    expect(r.output.is_duplicate).toBe(true);
    expect(r.output.confidence).toBeGreaterThanOrEqual(0.75);
    // Evidence must pass the same hallucination guard as LLM findings.
    expect(verifyExcerpts(r.output.evidence, [a.text, b.text])).toBe(true);
    expect(r.model).toContain('heuristic');
  });

  it('false-positive guard: paraphrased (similar vocabulary, no verbatim overlap) does not fire', () => {
    const a = doc('a.md', 'The payments service deployment uses canary rollout with Grafana monitoring of error rates and latency budgets across increments. '.repeat(3));
    const b = doc('b.md', 'Canary rollouts for deploying the payments service rely on monitoring latency and error-rate budgets in Grafana during each increment. '.repeat(3));
    expect(heuristicDuplicate(a, b, 0.85).output.is_duplicate).toBe(false);
  });

  it('false-positive guard: shared code fences and boilerplate headings do not fire', () => {
    const code = '```js\nconst deploy = await canaryRollout({ service: "payments", steps: 10 });\nawait verifyErrorBudget(deploy);\n```';
    const boiler = '# Overview\n\n## Getting started\n\n## FAQ\n';
    const a = doc('a.md', `${boiler}${code}\nGardening prose about tulips, soil preparation and watering schedules for spring.`);
    const b = doc('b.md', `${boiler}${code}\nAstronomy prose about telescope calibration, star charts and dark-sky observation.`);
    expect(heuristicDuplicate(a, b, 0.4).output.is_duplicate).toBe(false);
  });

  it('confidence calibration: full copy > partial copy, capped below 1', () => {
    const filler = 'Unique filler prose about something else entirely, long enough to matter for ratios and lengths.';
    const full = heuristicDuplicate(doc('a.md', `${PARA}\n${PARA}`), doc('b.md', `${PARA}\n${PARA}`), 0.95);
    const partial = heuristicDuplicate(
      doc('a.md', `${PARA}\n${filler}\n${filler}\n${filler}`),
      doc('b.md', `${PARA}\nDifferent content about star charts and telescope calibration sessions here.\n${filler.toUpperCase()}`),
      0.5
    );
    expect(full.output.confidence).toBeGreaterThan(partial.output.confidence);
    expect(full.output.confidence).toBeLessThanOrEqual(0.99);
  });
});

describe('sharedBlocks', () => {
  it('finds shared runs, ignores unique lines', () => {
    const a = `alpha line that is unique to document a and long enough\n${PARA}\nsecond shared line follows the paragraph and is also quite long indeed\nomega unique closer`;
    const b = `${PARA}\nsecond shared line follows the paragraph and is also quite long indeed\nunrelated ending`;
    const blocks = sharedBlocks(a, b);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].text).toContain('second shared line');
    expect(blocks[0].text).not.toContain('alpha line');
  });
});

describe('heuristicOpenQuestions (no-agent mode)', () => {
  it('detects TODO/TBD/FIXME/???/explicit language with high confidence and verbatim excerpts', () => {
    const d = doc('q.md', [
      'TODO: decide on the retry budget for the payments client.',
      'The rollout cadence is TBD pending capacity review.',
      'FIXME the diagram below is stale.',
      'What port does staging use??? nobody has confirmed.',
      'This remains an open question for the platform team.',
      'A perfectly settled statement with no markers at all.',
    ].join('\n'));
    const qs = heuristicOpenQuestions(d).output.questions;
    expect(qs).toHaveLength(5);
    expect(qs.every((q) => q.confidence >= 0.85)).toBe(true);
    expect(qs.every((q) => d.text.includes(q.excerpt))).toBe(true);
  });

  it('false-positive guards: code fences, answered FAQs, negations, and 1–2 question marks do not fire', () => {
    const d = doc('q.md', [
      'Settled prose describing the pipeline.',
      '```js',
      '// TODO: refactor this helper',
      '```',
      'How do I deploy? Run the release workflow.',
      'Nothing unresolved here — the tool determined the route automatically.',
      'Really?? Yes, verified in tests.',
    ].join('\n'));
    expect(heuristicOpenQuestions(d).output.questions).toHaveLength(0);
  });

  it('deduplicates repeated marker lines', () => {
    const d = doc('q.md', 'TODO: fill in the oncall rota.\nTODO: fill in the oncall rota.');
    expect(heuristicOpenQuestions(d).output.questions).toHaveLength(1);
  });

  it('explicit markers outrank fuzzy language in confidence', () => {
    const qs = heuristicOpenQuestions(
      doc('q.md', 'TODO: fix the deploy docs.\nThe budget is undecided at this stage.')
    ).output.questions;
    const todo = qs.find((q) => q.excerpt.includes('TODO'))!;
    const vague = qs.find((q) => q.excerpt.includes('undecided'))!;
    expect(todo.confidence).toBeGreaterThan(vague.confidence);
  });
});
