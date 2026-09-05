/**
 * Hallucination guard — pure, unit-testable. Evidence excerpts returned by the
 * model must actually appear (whitespace-insensitively) in the source texts.
 */
export function verifyExcerpts(
  excerpts: { excerpt: string }[],
  sourceTexts: string[]
): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const haystacks = sourceTexts.map(norm);
  return excerpts.every((e) => {
    const needle = norm(e.excerpt).slice(0, 200);
    return needle.length > 0 && haystacks.some((h) => h.includes(needle));
  });
}
