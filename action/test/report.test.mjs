/** report.js tests — dashboard rendering, XSS escaping, empty state. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, renderSummaryMarkdown } from '../src/report.js';

const stats = { docs: 5, pairs: 9, scannedAt: '2026-09-05T00:00:00Z' };

const finding = (over = {}) => ({
  fingerprint: 'abcd1234abcd1234',
  type: 'contradiction',
  severity: 'HIGH',
  confidence: 0.91,
  summary: 'Docs disagree on rate limits',
  detail: { conflicting_claims: ['100 rpm', '1000 rpm'] },
  evidence: [{ sourceLabel: 'a.md', excerpt: 'limited to 100 requests' }],
  files: ['a.md', 'b.md'],
  potentialOwners: ['alice'],
  model: 'gemini:test',
  promptVersion: 'v1',
  createdAt: '2026-09-05T00:00:00Z',
  ...over,
});

test('renderReport shows stat cards with correct counts', () => {
  const html = renderReport({
    findings: [finding(), finding({ type: 'duplicate', fingerprint: 'ffff0000ffff0000' })],
    stats,
  });
  assert.match(html, /Open findings/);
  assert.match(html, /<div class="num">2<\/div>/); // total
  assert.match(html, /Duplicates/);
  assert.match(html, /Contradictions/);
  assert.match(html, /Open questions/);
  assert.match(html, /class="ic/); // icons present
});

test('renderReport escapes HTML everywhere (XSS guard)', () => {
  const html = renderReport({
    findings: [
      finding({
        summary: '<script>alert(1)</script>',
        files: ['<img src=x onerror=1>.md'],
        evidence: [{ sourceLabel: '"><svg>', excerpt: '<iframe>' }],
        potentialOwners: ['<b>owner</b>'],
        detail: { conflicting_claims: ['<script>x</script>'] },
      }),
    ],
    stats,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<iframe>'));
  assert.ok(!html.includes('<b>owner</b>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderReport links files only when repoSlug present', () => {
  const withSlug = renderReport({ findings: [finding()], stats, repoSlug: 'me/repo', branch: 'main' });
  assert.match(withSlug, /https:\/\/github\.com\/me\/repo\/blob\/main\/a\.md/);
  const noSlug = renderReport({ findings: [finding()], stats });
  assert.ok(!noSlug.includes('github.com/me/repo'));
});

test('renderReport shows friendly empty state', () => {
  const html = renderReport({ findings: [], stats });
  assert.match(html, /No findings/);
  assert.match(html, /class="empty"/);
});

test('renderSummaryMarkdown escapes pipes and lists findings', () => {
  const md = renderSummaryMarkdown({ findings: [finding({ summary: 'a | b' })], stats });
  assert.match(md, /a \\\| b/);
  assert.match(md, /\| contradiction \| HIGH \| 91% \|/);
  const empty = renderSummaryMarkdown({ findings: [], stats });
  assert.match(empty, /No findings/);
});
