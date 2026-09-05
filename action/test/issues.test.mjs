/** issues.js tests — dedupe by fingerprint, close resolved, cap creation.
 * GitHub API is mocked via global fetch; the LLM client is a stub. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { syncIssues } from '../src/issues.js';

const SLUG = 'me/repo';
const MARKER = (fp) => `<!-- docgrity:fingerprint:${fp} -->`;

const stubClient = {
  model: 'stub',
  async complete() {
    return JSON.stringify({ title: 'Drafted title', body: 'Drafted body' });
  },
};

const finding = (fp, over = {}) => ({
  fingerprint: fp,
  type: 'duplicate',
  severity: 'MEDIUM',
  confidence: 0.8,
  summary: 'dup',
  evidence: [{ sourceLabel: 'a.md', excerpt: 'x' }],
  files: ['a.md'],
  potentialOwners: [],
  model: 'stub',
  promptVersion: 'v1',
  ...over,
});

let calls;
let openIssues;

beforeEach(() => {
  calls = [];
  openIssues = [];
  let nextNumber = 100;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const u = new URL(url);
    calls.push({ method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
    assert.match(init.headers.Authorization, /^Bearer /, 'token must be a bearer header');
    if (method === 'GET') return { ok: true, status: 200, json: async () => openIssues };
    if (method === 'POST' && u.pathname.endsWith('/issues')) {
      const n = nextNumber++;
      return { ok: true, status: 201, json: async () => ({ number: n, html_url: `https://github.com/${SLUG}/issues/${n}` }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
});

test('creates issues for new findings with fingerprint marker and labels', async () => {
  const f = finding('aaaaaaaaaaaaaaaa');
  const result = await syncIssues({ client: stubClient, token: 't', slug: SLUG, findings: [f] });
  assert.equal(result.created.length, 1);
  const create = calls.find((c) => c.method === 'POST' && c.path === `/repos/${SLUG}/issues`);
  assert.ok(create.body.body.includes(MARKER('aaaaaaaaaaaaaaaa')), 'marker must be embedded');
  assert.deepEqual(create.body.labels, ['docgrity', 'docgrity:duplicate']);
  assert.ok(f.issueUrl, 'finding gets its issue url');
});

test('dedupes: existing fingerprint means no new issue', async () => {
  openIssues = [{ number: 7, html_url: 'u', body: `text ${MARKER('bbbbbbbbbbbbbbbb')}` }];
  const result = await syncIssues({
    client: stubClient,
    token: 't',
    slug: SLUG,
    findings: [finding('bbbbbbbbbbbbbbbb')],
  });
  assert.equal(result.created.length, 0);
  assert.equal(result.unchanged, 1);
  assert.ok(!calls.some((c) => c.method === 'POST' && c.path === `/repos/${SLUG}/issues`));
});

test('closes issues whose finding is resolved', async () => {
  openIssues = [{ number: 9, html_url: 'u', body: MARKER('cccccccccccccccc') }];
  const result = await syncIssues({ client: stubClient, token: 't', slug: SLUG, findings: [] });
  assert.deepEqual(result.closed, [9]);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, { state: 'closed' });
  assert.ok(calls.some((c) => c.path.endsWith('/9/comments')), 'closing comment posted');
});

test('caps new issues per run', async () => {
  const findings = ['1111111111111111', '2222222222222222', '3333333333333333'].map(finding);
  const result = await syncIssues({ client: stubClient, token: 't', slug: SLUG, findings, maxNewIssues: 2 });
  assert.equal(result.created.length, 2);
  assert.equal(result.skipped, 1);
});
