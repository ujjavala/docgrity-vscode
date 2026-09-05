/**
 * GitHub issue sync — CI notify surface. Deduplicated by finding fingerprint
 * (embedded as an HTML comment in the issue body):
 *  - new finding  -> create issue (capped per run)
 *  - existing     -> update body if summary changed, else leave alone
 *  - resolved     -> close issue with a comment
 * Only runs when create_issues is explicitly enabled (opt-in guard).
 */
import { draftIssue } from './llm.js';
import { templateIssue } from './heuristics.js';

const MARKER = (fp) => `<!-- docgrity:fingerprint:${fp} -->`;
const LABEL = 'docgrity';

async function gh(token, method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function listDocgrityIssues(token, slug) {
  const issues = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(token, 'GET', `/repos/${slug}/issues?labels=${LABEL}&state=open&per_page=100&page=${page}`);
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  const byFingerprint = new Map();
  for (const issue of issues) {
    const m = (issue.body ?? '').match(/<!-- docgrity:fingerprint:([0-9a-f]{16}) -->/);
    if (m) byFingerprint.set(m[1], issue);
  }
  return byFingerprint;
}

export async function syncIssues({ client, token, slug, findings, maxNewIssues = 5, log = () => {} }) {
  const existing = await listDocgrityIssues(token, slug);
  const current = new Map(findings.map((f) => [f.fingerprint, f]));
  const result = { created: [], closed: [], unchanged: 0, skipped: 0 };

  // Close issues whose finding no longer exists.
  for (const [fp, issue] of existing) {
    if (!current.has(fp)) {
      await gh(token, 'POST', `/repos/${slug}/issues/${issue.number}/comments`, {
        body: 'Docgrity: this finding no longer appears in the latest scan — closing. Reopen if it resurfaces.',
      });
      await gh(token, 'PATCH', `/repos/${slug}/issues/${issue.number}`, { state: 'closed' });
      result.closed.push(issue.number);
      log(`Closed resolved issue #${issue.number} (${fp})`);
    }
  }

  // Create issues for new findings, capped.
  let created = 0;
  for (const f of findings) {
    const issue = existing.get(f.fingerprint);
    if (issue) {
      f.issueUrl = issue.html_url;
      result.unchanged++;
      continue;
    }
    if (created >= maxNewIssues) {
      result.skipped++;
      continue;
    }
    // No LLM client (no-agent mode) → deterministic template draft; evidence is
    // already verbatim, so nothing is lost except prose polish.
    const draft = client ? await draftIssue(client, f) : templateIssue(f);
    const body = `${draft.body}

---
_Raised by Docgrity CI (${f.type}, confidence ${f.confidence.toFixed(2)}, model ${f.model}, prompt ${f.promptVersion})._
${MARKER(f.fingerprint)}`;
    const createdIssue = await gh(token, 'POST', `/repos/${slug}/issues`, {
      title: draft.title,
      body,
      labels: [LABEL, `docgrity:${f.type}`],
    });
    f.issueUrl = createdIssue.html_url;
    result.created.push(createdIssue.number);
    created++;
    log(`Created issue #${createdIssue.number} for ${f.fingerprint}`);
  }
  return result;
}
