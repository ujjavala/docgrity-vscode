/**
 * Pure JSON extraction/validation helpers for LLM output. No vscode imports —
 * unit-testable in isolation. Every model response passes through these; any
 * invalid output is rejected, never partially trusted.
 */

export interface Evidence {
  page: 'A' | 'B';
  excerpt: string;
}

export const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export const num = (v: unknown, lo = 0, hi = 1): number =>
  Math.min(hi, Math.max(lo, Number(v) || 0));

export const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
};

export function validateEvidence(list: unknown): Evidence[] {
  return (Array.isArray(list) ? list : [])
    .map((e: any) => ({
      page: (e?.page === 'B' ? 'B' : 'A') as 'A' | 'B',
      excerpt: str(e?.excerpt).slice(0, 1000),
    }))
    .filter((e) => e.excerpt);
}

/**
 * Extract the first balanced top-level JSON object from model output.
 * Handles prose or code fences around the JSON and trailing text after it.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object in model output');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON object in model output');
}
