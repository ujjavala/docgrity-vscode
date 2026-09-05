import { describe, it, expect } from 'vitest';
import { extractJson, num, str, validateEvidence } from '../src/core/json';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in prose and code fences', () => {
    const text = 'Sure! Here is the result:\n```json\n{"is_duplicate": true, "confidence": 0.9}\n```\nLet me know.';
    expect(extractJson(text)).toEqual({ is_duplicate: true, confidence: 0.9 });
  });

  it('handles nested objects and braces inside strings', () => {
    const text = 'prefix {"summary": "uses {braces} and \\"quotes\\"", "detail": {"x": 1}} suffix {ignored}';
    expect(extractJson(text)).toEqual({
      summary: 'uses {braces} and "quotes"',
      detail: { x: 1 },
    });
  });

  it('throws when there is no JSON object', () => {
    expect(() => extractJson('no json here')).toThrow(/No JSON object/);
  });

  it('throws on unbalanced JSON', () => {
    expect(() => extractJson('{"a": 1')).toThrow(/Unbalanced/);
  });
});

describe('num', () => {
  it('clamps to [0,1] by default', () => {
    expect(num(2)).toBe(1);
    expect(num(-1)).toBe(0);
    expect(num(0.5)).toBe(0.5);
  });

  it('coerces non-numbers to 0', () => {
    expect(num('not a number')).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num(null)).toBe(0);
  });

  it('accepts numeric strings', () => {
    expect(num('0.7')).toBe(0.7);
  });
});

describe('str', () => {
  it('passes strings through', () => {
    expect(str('hello')).toBe('hello');
  });

  it('coerces null/undefined to empty string', () => {
    expect(str(null)).toBe('');
    expect(str(undefined)).toBe('');
  });

  it('stringifies other values', () => {
    expect(str(42)).toBe('42');
  });
});

describe('validateEvidence', () => {
  it('normalises page to A unless explicitly B', () => {
    const out = validateEvidence([
      { page: 'B', excerpt: 'x' },
      { page: 'C', excerpt: 'y' },
      { excerpt: 'z' },
    ]);
    expect(out.map((e) => e.page)).toEqual(['B', 'A', 'A']);
  });

  it('drops entries with empty excerpts', () => {
    expect(validateEvidence([{ page: 'A', excerpt: '' }, { page: 'A' }])).toEqual([]);
  });

  it('truncates excerpts to 1000 chars', () => {
    const out = validateEvidence([{ page: 'A', excerpt: 'a'.repeat(2000) }]);
    expect(out[0].excerpt).toHaveLength(1000);
  });

  it('tolerates non-array input', () => {
    expect(validateEvidence(null)).toEqual([]);
    expect(validateEvidence('nope')).toEqual([]);
  });
});
