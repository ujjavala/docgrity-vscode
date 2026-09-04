/**
 * Candidate pair selection — local TF-IDF cosine similarity. Deterministic and
 * free: the LLM is only used for pairwise assessment of the top-scoring pairs.
 * (vscode.lm has no embeddings API; TF-IDF is sufficient at repo-docs scale.)
 */
import type { Doc } from './corpus';

export interface CandidatePair {
  a: Doc;
  b: Doc;
  similarity: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ') // ignore fenced code blocks
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

export function selectCandidatePairs(docs: Doc[], maxPairs: number): CandidatePair[] {
  const termFreqs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });

  const docFreq = new Map<string, number>();
  for (const tf of termFreqs) {
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = (term: string) => Math.log(1 + n / (docFreq.get(term) ?? 1));

  const vectors = termFreqs.map((tf) => {
    const v = new Map<string, number>();
    let norm = 0;
    for (const [term, f] of tf) {
      const w = f * idf(term);
      v.set(term, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  });

  const pairs: CandidatePair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [small, large] =
        vectors[i].v.size <= vectors[j].v.size ? [vectors[i], vectors[j]] : [vectors[j], vectors[i]];
      let dot = 0;
      for (const [term, w] of small.v) {
        const w2 = large.v.get(term);
        if (w2) dot += w * w2;
      }
      const sim = dot / (vectors[i].norm * vectors[j].norm);
      if (sim > 0.15) pairs.push({ a: docs[i], b: docs[j], similarity: sim });
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity).slice(0, maxPairs);
}
