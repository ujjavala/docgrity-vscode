/**
 * No-agent (heuristic) checks — pure algorithms, zero LLM calls.
 *
 * What works without a model:
 *   - duplicates: TF-IDF similarity + verbatim shared-block detection
 *   - open questions: explicit unresolved markers (TODO/TBD/FIXME/???/…)
 * What does NOT work without a model:
 *   - contradictions: require semantic understanding — explicitly skipped,
 *     and the report says so, rather than emitting noisy guesses.
 *
 * Evidence is verbatim by construction (extracted from the source text), so
 * the same hallucination guard in scan.js passes trivially. Confidence for
 * duplicates is derived from measured overlap; for open questions the
 * markers are deterministic, so confidence is fixed high per marker class.
 */

const stripFences = (text) => text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ''));

const normLine = (s) => s.replace(/\s+/g, ' ').trim();

/** Lines substantive enough to count as shared content (not markdown noise). */
const substantive = (line) => {
  const l = normLine(line);
  if (l.length < 40) return false;
  if (/^[#>\-*|=\s`~[\]().\d]+$/.test(l)) return false; // pure punctuation/structure
  return true;
};

/**
 * Find consecutive runs of lines from A that also appear (normalized) in B.
 * Returns blocks sorted by length desc.
 */
export function sharedBlocks(textA, textB) {
  const linesA = stripFences(textA).split('\n');
  const setB = new Set(stripFences(textB).split('\n').map(normLine).filter((l) => l.length >= 20));
  const blocks = [];
  let current = [];
  for (const raw of linesA) {
    const l = normLine(raw);
    if (l.length >= 20 && setB.has(l)) {
      current.push(raw.trim());
    } else if (l.length > 0) {
      if (current.length) blocks.push(current), (current = []);
    }
    // blank lines don't break a block
  }
  if (current.length) blocks.push(current);
  return blocks
    .map((lines) => ({ lines, text: lines.join('\n'), chars: lines.join(' ').length }))
    .filter((b) => b.lines.some(substantive))
    .sort((x, y) => y.chars - x.chars);
}

/**
 * Heuristic duplicate assessment. `similarity` is the TF-IDF cosine from
 * candidate selection. Flags only when there is *verbatim* shared content —
 * vocabulary similarity alone is not enough (false-positive guard).
 */
export function heuristicDuplicate(a, b, similarity = 0) {
  const blocks = sharedBlocks(a.text, b.text);
  const sharedChars = blocks.reduce((n, bl) => n + bl.chars, 0);
  const minLen = Math.max(1, Math.min(a.text.length, b.text.length));
  const sharedRatio = Math.min(1, sharedChars / minLen);

  // Require a meaningful verbatim block; similarity alone never fires.
  const hasBlock = blocks.length > 0 && blocks[0].chars >= 120;
  const is_duplicate = hasBlock && (sharedRatio >= 0.2 || similarity >= 0.6);

  // Confidence is measured, not guessed: verbatim overlap dominates.
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
const OQ_MARKERS = [
  { re: /\b(TODO|FIXME)\b(?!\s*:?\s*none)/, label: 'TODO/FIXME marker', confidence: 0.95, severity: 'MEDIUM' },
  { re: /\b(TBD|TBC)\b|\bto be (decided|determined|confirmed|announced)\b/i, label: 'TBD marker', confidence: 0.95, severity: 'MEDIUM' },
  { re: /\?{3,}|\[\?\]/, label: 'placeholder question marks', confidence: 0.9, severity: 'MEDIUM' },
  // Affirmative context required ("remains unresolved"), so negations like
  // "nothing unresolved" don't fire (false-positive guard).
  { re: /\bopen question\b|\b(is|are|remains?|still|left)\s+(unresolved|undecided)\b|\bnot (yet )?(decided|determined|finali[sz]ed)\b/i, label: 'explicit open-question language', confidence: 0.85, severity: 'MEDIUM' },
];

/**
 * Heuristic open-question detection. Scans prose only (fenced code stripped —
 * TODOs inside code samples are code concerns, not doc integrity), one
 * finding per line, deduplicated.
 */
export function heuristicOpenQuestions(doc) {
  const lines = stripFences(doc.text).split('\n');
  const questions = [];
  const seen = new Set();
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

/** Template-based issue draft — used when no LLM client is available. */
export function templateIssue(finding) {
  const title = `[docgrity] ${finding.type.replace('_', ' ')}: ${finding.summary.slice(0, 140)}`;
  const body = [
    `**Type:** ${finding.type}  `,
    `**Severity:** ${finding.severity} · **Confidence:** ${finding.confidence}  `,
    `**Docs:** ${finding.files.map((f) => `\`${f}\``).join(', ')}  `,
    `**Potential owner(s):** ${finding.potentialOwners.join(', ') || 'unknown'} *(from git history — potential, not asserted)*`,
    '',
    '### Evidence',
    ...finding.evidence.map((e) => `> ${e.excerpt.replace(/\n/g, '\n> ')}\n> — \`${e.sourceLabel}\``),
    '',
    `_Detected by Docgrity in no-agent (heuristic) mode — evidence is verbatim from the docs._`,
  ].join('\n');
  return { title: title.slice(0, 200), body: body.slice(0, 20000) };
}
