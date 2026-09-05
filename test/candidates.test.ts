import { describe, it, expect } from 'vitest';
import { selectCandidatePairs } from '../src/scanner/candidates';
import type { Doc } from '../src/scanner/corpus';

function doc(relPath: string, text: string): Doc {
  return { relPath, text, uri: undefined as never, hash: relPath };
}

const releaseA = doc(
  'docs/release.md',
  'Our release process: deploy pipeline runs tests, then ships to staging, then production. Releases are weekly on Thursdays after QA sign-off from the release manager.'
);
const releaseB = doc(
  'docs/deploy.md',
  'Deployment guide: the deploy pipeline runs tests and ships to staging then production. Releases happen weekly, coordinated by the release manager with QA sign-off.'
);
const unrelated = doc(
  'docs/animals.md',
  'Penguins are flightless birds living in the southern hemisphere. Their diet consists of krill, squid and fish caught while swimming.'
);

describe('selectCandidatePairs', () => {
  it('ranks similar docs above unrelated ones', () => {
    const pairs = selectCandidatePairs([releaseA, releaseB, unrelated], 10);
    expect(pairs.length).toBeGreaterThan(0);
    expect([pairs[0].a.relPath, pairs[0].b.relPath].sort()).toEqual([
      'docs/deploy.md',
      'docs/release.md',
    ]);
  });

  it('filters out low-similarity pairs', () => {
    const pairs = selectCandidatePairs([releaseA, unrelated], 10);
    expect(pairs).toHaveLength(0);
  });

  it('respects maxPairs', () => {
    const docs = Array.from({ length: 6 }, (_, i) =>
      doc(`d${i}.md`, `${releaseA.text} variant ${i}`)
    );
    const pairs = selectCandidatePairs(docs, 3);
    expect(pairs).toHaveLength(3);
  });

  it('returns pairs sorted by descending similarity', () => {
    const pairs = selectCandidatePairs([releaseA, releaseB, doc('c.md', releaseA.text)], 10);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].similarity).toBeLessThanOrEqual(pairs[i - 1].similarity);
    }
  });

  it('handles empty and single-doc corpora', () => {
    expect(selectCandidatePairs([], 10)).toEqual([]);
    expect(selectCandidatePairs([releaseA], 10)).toEqual([]);
  });

  it('ignores fenced code blocks when tokenizing', () => {
    const codeOnlyA = doc('a.md', 'Short intro.\n```\nconst x = identicalCodeBlock();\n```');
    const codeOnlyB = doc('b.md', 'Other topic.\n```\nconst x = identicalCodeBlock();\n```');
    const pairs = selectCandidatePairs([codeOnlyA, codeOnlyB], 10);
    expect(pairs).toHaveLength(0);
  });
});
