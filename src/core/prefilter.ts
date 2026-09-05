/**
 * Cheap heuristic gates that decide whether a document is worth an LLM call.
 * These mirror the signals the open-question prompt looks for, so skipping
 * documents with no signals loses essentially no recall while avoiding the
 * most expensive step (an LLM round-trip) for the common clean-doc case.
 */

const MARKERS =
  /\b(?:TODO|TBD|TBC|FIXME|to be (?:decided|determined|confirmed)|open question|needs? (?:input|decision|review)|undecided|unresolved)\b/i;
const PLACEHOLDERS = /\?{2,}|<add here>|\[(?:placeholder|fill ?in|xxx)\]/i;

/** Lines ending in "?" outside fenced code blocks. */
function hasQuestionLine(text: string): boolean {
  let inFence = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && t.endsWith('?')) return true;
  }
  return false;
}

export function hasOpenQuestionSignals(text: string): boolean {
  return MARKERS.test(text) || PLACEHOLDERS.test(text) || hasQuestionLine(text);
}

/**
 * Run an async mapper over items with bounded concurrency, preserving order.
 * Errors are returned per-item rather than thrown, so one failure never
 * aborts the batch.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: Error }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: Error }> = new Array(
    items.length
  );
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err as Error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
