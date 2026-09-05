/**
 * Static HTML report — the read-only dashboard. Shows findings, evidence,
 * doc links and potential owners. Deliberately no action buttons: local and
 * published reports are for observing and routing, not acting.
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const TYPE_LABELS = {
  contradiction: 'Contradictions',
  duplicate: 'Duplicates',
  open_question: 'Open questions',
};

/* Inline SVG icons in the Atlassian Design System style (24px grid, 2px
 * stroke, rounded caps) — inlined so the report has zero dependencies and
 * works offline / as a CI artifact. */
const ICONS = {
  findings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></svg>',
  duplicate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  contradiction:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  open_question:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  docs:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  owner:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 5-6"/></svg>',
};

const icon = (name, cls = '') => `<span class="ic ${cls}" aria-hidden="true">${ICONS[name] ?? ''}</span>`;

const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function renderReport({ findings, stats, repoSlug, branch }) {
  const docUrl = (relPath) =>
    repoSlug ? `https://github.com/${repoSlug}/blob/${branch || 'main'}/${relPath}` : null;

  const counts = {};
  for (const f of findings) counts[f.type] = (counts[f.type] ?? 0) + 1;

  const sections = Object.entries(TYPE_LABELS)
    .map(([type, label]) => {
      const items = findings
        .filter((f) => f.type === type)
        .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || b.confidence - a.confidence);
      if (items.length === 0) return '';
      return `
  <section>
    <h2>${esc(label)} <span class="count">${items.length}</span></h2>
    ${items.map((f) => findingCard(f, docUrl)).join('\n')}
  </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Docgrity report</title>
<style>
  :root { --blue:#1558bc; --teal:#16a394; --muted:#5b6470; --bg:#f7f9fc; --card:#fff; --border:#e3e8ef;
          --crit:#c62828; --high:#e65100; --med:#a07d00; --low:#5b6470; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:var(--bg); color:#1a2230; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 60px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; } h1 span { color: var(--blue); }
  .meta { color: var(--muted); font-size: .88rem; margin-bottom: 24px; }
  .totals { display:flex; gap:12px; margin: 18px 0 8px; flex-wrap: wrap; }
  .total { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:10px 18px; }
  .total b { font-size:1.3rem; display:block; color:var(--blue); }
  h2 { font-size: 1.15rem; margin: 30px 0 12px; } .count { color:var(--muted); font-weight:400; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px 18px; margin-bottom:14px; }
  .sev { display:inline-block; font-size:.72rem; font-weight:700; letter-spacing:.04em; padding:2px 8px;
         border-radius:999px; color:#fff; vertical-align: middle; margin-right:8px; }
  .sev.CRITICAL{background:var(--crit)} .sev.HIGH{background:var(--high)} .sev.MEDIUM{background:var(--med)} .sev.LOW{background:var(--low)}
  .conf { color:var(--muted); font-size:.82rem; }
  .summary { margin: 8px 0 10px; }
  .files a, .files span { font-family: ui-monospace, monospace; font-size:.85rem; color:var(--blue); }
  blockquote { margin: 8px 0; padding: 8px 12px; border-left: 3px solid var(--teal); background:#f0faf8;
               font-size:.88rem; border-radius: 0 8px 8px 0; }
  blockquote .src { display:block; color:var(--muted); font-size:.78rem; font-family: ui-monospace, monospace; margin-top:4px; }
  .owners { font-size:.85rem; color:var(--muted); margin-top:8px; }
  .owners b { color:#1a2230; font-weight:600; }
  .fine { color:var(--muted); font-size:.75rem; margin-top:6px; }
  footer { margin-top:40px; color:var(--muted); font-size:.8rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1><span>Docgrity</span> documentation-integrity report</h1>
  <div class="meta">${esc(repoSlug ?? 'local scan')} · scanned ${esc(stats.scannedAt)} · ${stats.docs} markdown docs · ${stats.pairs} pairs assessed</div>
  <div class="totals">
    ${Object.entries(TYPE_LABELS)
      .map(([t, l]) => `<div class="total"><b>${counts[t] ?? 0}</b>${esc(l)}</div>`)
      .join('')}
  </div>
  ${findings.length === 0 ? '<p>No findings — your docs agree with themselves. 🎉</p>' : sections}
  <footer>Read-only report. Ownership is inferred from git history and is always <em>potential</em>, never asserted.
  Generated by Docgrity.</footer>
</div>
</body>
</html>`;

  function findingCard(f, docUrlFn) {
    const fileLinks = f.files
      .map((p) => {
        const url = docUrlFn(p);
        return url ? `<a href="${esc(url)}" rel="noopener">${esc(p)}</a>` : `<span>${esc(p)}</span>`;
      })
      .join(' · ');
    const claims = Array.isArray(f.detail?.conflicting_claims)
      ? `<ul>${f.detail.conflicting_claims.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      : '';
    return `<div class="card">
      <span class="sev ${esc(f.severity)}">${esc(f.severity)}</span>
      <span class="conf">confidence ${(f.confidence * 100).toFixed(0)}%${f.issueUrl ? ` · <a href="${esc(f.issueUrl)}" rel="noopener">issue</a>` : ''}</span>
      <div class="summary">${esc(f.summary)}</div>
      <div class="files">${fileLinks}</div>
      ${claims}
      ${f.evidence
        .map((e) => `<blockquote>${esc(e.excerpt)}<span class="src">${esc(e.sourceLabel)}</span></blockquote>`)
        .join('')}
      <div class="owners">Potential owner(s): <b>${esc(f.potentialOwners.join(', ') || 'unknown')}</b></div>
      <div class="fine">fingerprint ${esc(f.fingerprint)} · model ${esc(f.model)} · prompt ${esc(f.promptVersion)}</div>
    </div>`;
  }
}

export function renderSummaryMarkdown({ findings, stats }) {
  const lines = [
    '## Docgrity doc-integrity scan',
    '',
    `Scanned **${stats.docs}** markdown docs (${stats.pairs} candidate pairs) at ${stats.scannedAt}.`,
    '',
  ];
  if (findings.length === 0) {
    lines.push('No findings — docs agree with themselves.');
    return lines.join('\n');
  }
  lines.push('| Type | Severity | Confidence | Summary | Files |', '|---|---|---|---|---|');
  for (const f of findings) {
    lines.push(
      `| ${f.type} | ${f.severity} | ${(f.confidence * 100).toFixed(0)}% | ${f.summary.replace(/\|/g, '\\|').slice(0, 120)} | ${f.files.join('<br>')} |`
    );
  }
  return lines.join('\n');
}
