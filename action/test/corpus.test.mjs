/** corpus.js tests — md-only collection, TF-IDF pairing, owner inference. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectCorpus, selectCandidatePairs, githubRepoSlug } from '../src/corpus.js';

const doc = (relPath, text) => ({ relPath, text, hash: relPath });

test('selectCandidatePairs pairs similar docs, ignores unrelated ones', () => {
  const a = doc('a.md', 'deployment guide for the payments service using canary rollout and grafana dashboards '.repeat(4));
  const b = doc('b.md', 'release process for the payments service with canary rollout watched in grafana '.repeat(4));
  const c = doc('c.md', 'chocolate cake recipe flour sugar eggs butter vanilla oven baking whisk frosting '.repeat(4));
  const pairs = selectCandidatePairs([a, b, c]);
  assert.ok(pairs.some((p) => p.a.relPath === 'a.md' && p.b.relPath === 'b.md'), 'similar docs must pair');
  assert.ok(!pairs.some((p) => p.a.relPath === 'c.md' || p.b.relPath === 'c.md'), 'unrelated doc must not pair');
});

test('selectCandidatePairs strips code blocks before comparing', () => {
  const code = '```\nconst deploy = canary(grafana, rollout, payments, service);\n```';
  const a = doc('a.md', `${code} completely unrelated prose about gardening tulips soil watering sunlight`.repeat(3));
  const b = doc('b.md', `${code} astronomy telescope galaxy nebula orbit planets observation stars`.repeat(3));
  const pairs = selectCandidatePairs([a, b]);
  assert.equal(pairs.length, 0, 'shared code blocks alone must not create a pair');
});

test('selectCandidatePairs respects maxPairs cap', () => {
  const docs = Array.from({ length: 6 }, (_, i) =>
    doc(`d${i}.md`, 'payments service deployment canary rollout grafana monitoring alerts '.repeat(4))
  );
  assert.ok(selectCandidatePairs(docs, 3).length <= 3);
});

test('collectCorpus: markdown only, skips ignored dirs and trivial files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'docgrity-'));
  try {
    const big = 'This document is long enough to be included in the corpus. '.repeat(3);
    await writeFile(path.join(root, 'keep.md'), big);
    await writeFile(path.join(root, 'skip.txt'), big);
    await writeFile(path.join(root, 'tiny.md'), 'too short');
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'dep.md'), big);
    const docs = await collectCorpus(root);
    assert.deepEqual(docs.map((d) => d.relPath), ['keep.md']);
    assert.match(docs[0].hash, /^[0-9a-f]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('githubRepoSlug returns undefined outside a git repo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'docgrity-'));
  try {
    assert.equal(await githubRepoSlug(root), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
