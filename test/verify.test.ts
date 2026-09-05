import { describe, it, expect } from 'vitest';
import { verifyExcerpts } from '../src/core/verify';

const docA = 'The deploy pipeline runs   on every merge to main.\nReleases are weekly.';
const docB = 'Releases happen monthly after QA sign-off.';

describe('verifyExcerpts', () => {
  it('accepts excerpts present verbatim', () => {
    expect(verifyExcerpts([{ excerpt: 'Releases are weekly.' }], [docA, docB])).toBe(true);
  });

  it('is whitespace-insensitive', () => {
    expect(
      verifyExcerpts([{ excerpt: 'deploy pipeline runs on every merge' }], [docA])
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(verifyExcerpts([{ excerpt: 'RELEASES HAPPEN MONTHLY' }], [docB])).toBe(true);
  });

  it('rejects hallucinated excerpts', () => {
    expect(verifyExcerpts([{ excerpt: 'Releases are daily.' }], [docA, docB])).toBe(false);
  });

  it('rejects when any excerpt fails (all-or-nothing)', () => {
    expect(
      verifyExcerpts(
        [{ excerpt: 'Releases are weekly.' }, { excerpt: 'invented claim' }],
        [docA, docB]
      )
    ).toBe(false);
  });

  it('rejects empty excerpts', () => {
    expect(verifyExcerpts([{ excerpt: '   ' }], [docA])).toBe(false);
  });

  it('accepts an empty excerpt list (nothing to verify)', () => {
    expect(verifyExcerpts([], [docA])).toBe(true);
  });

  it('only compares the first 200 normalised chars of long excerpts', () => {
    const long = 'x'.repeat(300);
    expect(verifyExcerpts([{ excerpt: long }], [`prefix ${'x'.repeat(200)} suffix`])).toBe(true);
  });
});
