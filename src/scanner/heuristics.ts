/**
 * No-agent (heuristic) checks — pure algorithms, zero LLM calls. Mirror of
 * action/src/heuristics.js.
 *
 * Works without a model: duplicates (TF-IDF + verbatim shared blocks) and
 * open questions (explicit TODO/TBD/FIXME/??? markers).
 * Does NOT work without a model: contradictions — they need semantic
 * understanding, so they are explicitly skipped (never guessed).
 *
 * Evidence is extracted verbatim from the sources, so the standard
 * hallucination guard passes by construction. Confidence is measured
 * (overlap ratios) or fixed per deterministic marker class — never invented.
 */
import { Doc } from './corpus';

const stripFences = (text: string): string => text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ''));

const normLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

const substantive = (line: string): boolean => {
  const l = normLine(line);
  if (l.length < 40) return false;
  if (/^[#>\-*|=\s`~[\]().\d]+$/.test(l)) return false; // pure punctuation/structure
  return true;
};

interface SharedBlock {
  lines: string[];
  text: string;
  chars: number;
}

/** Consecutive runs of lines from A that also appear (normalized) in B. */
export function sharedBlocks(textA: string, textB: string): SharedBlock[] {
  const linesA = stripFences(textA).split('\n');
  const setB = new Set(
    stripFences(textB)
      .split('\n')
      .map(normLine)
      .filter((l) => l.length >= 20)
  );
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const raw of linesA) {
    const l = normLine(raw);
    if (l.length >= 20 && setB.has(l)) {
      current.push(raw.trim());
    } else if (l.length > 0 && current.length) {
      blocks.push(current);
      current = [];
    }
    // blank lines don't break a block
  }
  if (current.length) blocks.push(current);
  return blocks
    .map((lines) => ({ lines, text: lines.join('\n'), chars: lines.join(' ').length }))
    .filter((b) => b.lines.some(substantive))
    .sort((x, y) => y.chars - x.chars);
}

export interface HeuristicDuplicateOutput {
  is_duplicate: boolean;
  confidence: number;
  summary: string;
  recommended_action: string;
  evidence: { page: string; excerpt: string }[];
}

/**
 * Heuristic duplicate assessment. Flags only on *verbatim* shared content —
 * vocabulary similarity alone never fires (false-positive guard).
 */
export function heuristicDuplicate(
  a: Doc,
  b: Doc,
  similarity = 0
): { output: HeuristicDuplicateOutput; model: string; promptVersion: string } {
  const blocks = sharedBlocks(a.text, b.text);
  const sharedChars = blocks.reduce((n, bl) => n + bl.chars, 0);
  const minLen = Math.max(1, Math.min(a.text.length, b.text.length));
  const sharedRatio = Math.min(1, sharedChars / minLen);

  const hasBlock = blocks.length > 0 && blocks[0].chars >= 120;
  const is_duplicate = hasBlock && (sharedRatio >= 0.2 || similarity >= 0.6);

  const confidence = is_duplicate
    ? Math.min(0.99, Math.round((0.55 * Math.min(1, sharedRatio * 2) + 0.45 * similarity) * 100) / 100)
    : Math.round(Math.max(sharedRatio, similarity) * 100) / 100;

  return {
    output: {
      is_duplicate,
      confidence,
      summary: is_duplicate
        ? `Verbatim duplicated content between "${a.relPath}" and "${b.relPath}" — ${blocks.length} shared block(s), ~${Math.round(sharedRatio * 100)}% of the smaller doc (TF-IDF similarity ${similarity.toFixed(2)}).`
        : 'No verbatim duplication detected.',
      recommended_action: 'CONSOLIDATE',
      evidence: blocks.slice(0, 3).map((bl) => ({ page: 'A', excerpt: bl.text.slice(0, 1000) })),
    },
    model: 'heuristic (tf-idf + shared blocks)',
    promptVersion: 'heuristic-v1',
  };
}

/** Explicit unresolved-marker classes — deterministic, hence high confidence. */
const OQ_MARKERS: { re: RegExp; label: string; confidence: number; severity: 'MEDIUM' | 'HIGH' }[] = [
  { re: /\b(TODO|FIXME)\b(?!\s*:?\s*none)/, label: 'TODO/FIXME marker', confidence: 0.95, severity: 'MEDIUM' },
  { re: /\b(TBD|TBC)\b|\bto be (decided|determined|confirmed|announced)\b/i, label: 'TBD marker', confidence: 0.95, severity: 'MEDIUM' },
  { re: /\?{3,}|\[\?\]/, label: 'placeholder question marks', confidence: 0.9, severity: 'MEDIUM' },
  // Affirmative context required ("remains unresolved"), so negations like
  // "nothing unresolved" don't fire (false-positive guard).
  { re: /\bopen question\b|\b(is|are|remains?|still|left)\s+(unresolved|undecided)\b|\bnot (yet )?(decided|determined|finali[sz]ed)\b/i, label: 'explicit open-question language', confidence: 0.85, severity: 'MEDIUM' },
];

export interface HeuristicQuestion {
  question: string;
  excerpt: string;
  confidence: number;
  severity: 'MEDIUM' | 'HIGH';
}

/**
 * Heuristic open-question detection. Prose only (fenced code stripped — TODOs
 * in code samples are code concerns), one finding per line, deduplicated.
 */
export function heuristicOpenQuestions(
  doc: Doc
): { output: { questions: HeuristicQuestion[] }; model: string; promptVersion: string } {
  const lines = stripFences(doc.text).split('\n');
  const questions: HeuristicQuestion[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = normLine(raw);
    if (!line || seen.has(line)) continue;
    for (const m of OQ_MARKERS) {
      if (m.re.test(line)) {
        seen.add(line);
        questions.push({
          question: `Unresolved ${m.label}: "${line.slice(0, 200)}"`,
          excerpt: raw.trim().slice(0, 1000),
          confidence: m.confidence,
          severity: m.severity,
        });
        break; // one finding per line even if several markers match
      }
    }
  }
  return {
    output: { questions },
    model: 'heuristic (signal markers)',
    promptVersion: 'heuristic-v1',
  };
}
