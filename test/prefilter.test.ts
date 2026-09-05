import { describe, it, expect } from 'vitest';
import { hasOpenQuestionSignals, mapLimit } from '../src/core/prefilter';

describe('hasOpenQuestionSignals', () => {
  it('detects TODO/TBD/FIXME markers', () => {
    expect(hasOpenQuestionSignals('Deploy steps\nTODO: add rollback')).toBe(true);
    expect(hasOpenQuestionSignals('Owner: TBD')).toBe(true);
    expect(hasOpenQuestionSignals('FIXME later')).toBe(true);
    expect(hasOpenQuestionSignals('This is to be decided by the team')).toBe(true);
  });

  it('detects placeholders', () => {
    expect(hasOpenQuestionSignals('Region: ???')).toBe(true);
    expect(hasOpenQuestionSignals('Contact: <add here>')).toBe(true);
  });

  it('detects unanswered question lines', () => {
    expect(hasOpenQuestionSignals('# Notes\nWho owns the billing service?\n')).toBe(true);
  });

  it('ignores questions inside fenced code blocks', () => {
    expect(hasOpenQuestionSignals('```\nis this ok?\n```\nAll settled.')).toBe(false);
  });

  it('returns false for clean docs', () => {
    expect(hasOpenQuestionSignals('# Runbook\nRestart the service with systemctl.')).toBe(false);
  });

  it('does not match marker substrings inside words', () => {
    expect(hasOpenQuestionSignals('The mastodon population is stable.')).toBe(false);
  });
});

describe('mapLimit', () => {
  it('preserves order and maps all items', async () => {
    const res = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(res.map((r) => (r.ok ? r.value : -1))).toEqual([10, 20, 30, 40, 50]);
  });

  it('captures per-item errors without aborting the batch', async () => {
    const res = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(res[0]).toEqual({ ok: true, value: 1 });
    expect(res[1].ok).toBe(false);
    expect(res[2]).toEqual({ ok: true, value: 3 });
  });

  it('respects the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('handles empty input', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
