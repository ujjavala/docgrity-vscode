/**
 * Corpus + candidate selection — markdown files only; local TF-IDF for pair
 * selection so the LLM only assesses top candidates. Zero dependencies.
 */
import { readdir, readFile } from 'fs/promises';
import { execFile } from 'child_process';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_IGNORES = new Set([
  'node_modules', 'dist', 'out', 'build', 'vendor', '.git', '.docgrity', 'docgrity-report',
]);

export async function collectCorpus(root, { maxFiles = 200 } = {}) {
  const files = [];
  await walk(root, root, files, maxFiles);
  const docs = [];
  for (const abs of files) {
    const text = await readFile(abs, 'utf8');
    if (text.trim().length < 80) continue;
    docs.push({
      relPath: path.relative(root, abs).split(path.sep).join('/'),
      text,
      hash: crypto.createHash('sha256').update(text).digest('hex'),
    });
  }
  return docs;
}

async function walk(root, dir, acc, maxFiles) {
  if (acc.length >= maxFiles) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.length >= maxFiles) return;
    if (e.name.startsWith('.') || DEFAULT_IGNORES.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(root, p, acc, maxFiles);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) acc.push(p);
  }
}

const tokenize = (text) =>
  text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

export function selectCandidatePairs(docs, maxPairs = 25) {
  const termFreqs = docs.map((d) => {
    const tf = new Map();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const docFreq = new Map();
  for (const tf of termFreqs) for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  const n = docs.length;
  const idf = (term) => Math.log(1 + n / (docFreq.get(term) ?? 1));
  const vectors = termFreqs.map((tf) => {
    const v = new Map();
    let norm = 0;
    for (const [term, f] of tf) {
      const w = f * idf(term);
      v.set(term, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) || 1 };
  });
  const pairs = [];
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

const git = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10000 }, (err, stdout) => resolve(err ? '' : stdout.trim()));
  });

/** Potential owner = last git author, always labelled potential. */
export async function potentialOwner(root, relPath) {
  return (await git(['log', '-1', '--format=%an', '--', relPath], root)) || undefined;
}

export async function githubRepoSlug(root) {
  const url = await git(['remote', 'get-url', 'origin'], root);
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

export async function defaultBranch(root) {
  const ref = await git(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], root);
  return ref ? ref.replace(/^origin\//, '') : 'main';
}
