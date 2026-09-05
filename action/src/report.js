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
    <h2>${icon(type)} ${esc(label)} <span class="count">${items.length}</span></h2>
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
  :root { --blue:#1558bc; --blue-dark:#0d3d8a; --teal:#16a394; --muted:#5b6470; --bg:#f4f6fa; --card:#fff; --border:#e3e8ef;
          --crit:#c62828; --high:#e65100; --med:#a07d00; --low:#5b6470;
          --good:#1d7a3e; --good-bg:#e8f6ed; --warn-bg:#fdecea; --dup-bg:#fff4e0; --oq-bg:#eef3fd; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:var(--bg); color:#1a2230; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 0 20px 60px; }
  .hero { background:linear-gradient(120deg, var(--blue-dark), var(--blue) 60%, var(--teal)); color:#fff;
          margin: 0 -20px; padding: 30px 28px 26px; }
  .hero h1 { font-size: 1.5rem; margin: 0 0 4px; font-weight: 700; }
  .hero .meta { color: rgba(255,255,255,.85); font-size: .87rem; }
  .ic { display:inline-flex; width:20px; height:20px; vertical-align:-4px; }
  .ic svg { width:100%; height:100%; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:14px; margin: -22px 0 26px; }
  .stat { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:14px 16px;
          box-shadow: 0 2px 8px rgba(16,30,54,.06); display:flex; align-items:flex-start; justify-content:space-between; }
  .stat .label { color:var(--muted); font-size:.82rem; font-weight:600; }
  .stat .num { font-size:1.75rem; font-weight:800; line-height:1.15; }
  .stat .sub { color:var(--muted); font-size:.76rem; }
  .badge { width:38px; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:none; }
  .badge .ic { width:22px; height:22px; }
  .badge.findings { background:#e7eefb; color:var(--blue); }
  .badge.duplicate { background:var(--dup-bg); color:var(--high); }
  .badge.contradiction { background:var(--warn-bg); color:var(--crit); }
  .badge.open_question { background:var(--oq-bg); color:var(--blue); }
  .badge.ok { background:var(--good-bg); color:var(--good); }
  h2 { font-size: 1.12rem; margin: 32px 0 12px; display:flex; align-items:center; gap:8px; }
  h2 .ic { color:var(--muted); }
  .count { background:#e7eefb; color:var(--blue); font-size:.78rem; font-weight:700; border-radius:999px; padding:1px 10px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px 18px; margin-bottom:14px;
          box-shadow: 0 1px 4px rgba(16,30,54,.05); }
  .sev { display:inline-block; font-size:.72rem; font-weight:700; letter-spacing:.04em; padding:2px 8px;
         border-radius:999px; color:#fff; vertical-align: middle; margin-right:8px; }
  .sev.CRITICAL{background:var(--crit)} .sev.HIGH{background:var(--high)} .sev.MEDIUM{background:var(--med)} .sev.LOW{background:var(--low)}
  .conf { color:var(--muted); font-size:.82rem; }
  .summary { margin: 8px 0 10px; font-weight:600; }
  .files { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .files .ic { width:16px; height:16px; color:var(--muted); }
  .files a, .files span.f { font-family: ui-monospace, monospace; font-size:.85rem; color:var(--blue); }
  blockquote { margin: 8px 0; padding: 8px 12px; border-left: 3px solid var(--teal); background:#f0faf8;
               font-size:.88rem; border-radius: 0 8px 8px 0; }
  blockquote .src { display:block; color:var(--muted); font-size:.78rem; font-family: ui-monospace, monospace; margin-top:4px; }
  .owners { font-size:.85rem; color:var(--muted); margin-top:8px; display:flex; align-items:center; gap:6px; }
  .owners .ic { width:16px; height:16px; }
  .owners b { color:#1a2230; font-weight:600; }
  .fine { color:var(--muted); font-size:.75rem; margin-top:6px; }
  .empty { background:var(--good-bg); border:1px solid #cdebd8; color:var(--good); border-radius:12px;
           padding:18px 20px; display:flex; align-items:center; gap:10px; font-weight:600; }
  footer { margin-top:40px; color:var(--muted); font-size:.8rem; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>Docgrity — documentation-integrity report</h1>
    <div class="meta">${esc(repoSlug ?? 'local scan')} · scanned ${esc(stats.scannedAt)} · ${stats.docs} markdown docs · ${stats.pairs} pairs assessed</div>
  </div>
  <div class="stats">
    <div class="stat"><div><div class="label">Open findings</div><div class="num">${findings.length}</div><div class="sub">${stats.docs} docs scanned</div></div><div class="badge ${findings.length ? 'findings' : 'ok'}">${icon(findings.length ? 'findings' : 'check')}</div></div>
    <div class="stat"><div><div class="label">Duplicates</div><div class="num">${counts.duplicate ?? 0}</div><div class="sub">overlapping docs</div></div><div class="badge duplicate">${icon('duplicate')}</div></div>
    <div class="stat"><div><div class="label">Contradictions</div><div class="num">${counts.contradiction ?? 0}</div><div class="sub">conflicting claims</div></div><div class="badge contradiction">${icon('contradiction')}</div></div>
    <div class="stat"><div><div class="label">Open questions</div><div class="num">${counts.open_question ?? 0}</div><div class="sub">unresolved decisions</div></div><div class="badge open_question">${icon('open_question')}</div></div>
  </div>
  ${findings.length === 0 ? `<div class="empty">${icon('check')} No findings — your docs agree with themselves.</div>` : sections}
  <footer>Read-only report. Ownership is inferred from git history and is always <em>potential</em>, never asserted.
  Generated by Docgrity.</footer>
</div>
</body>
</html>`;

  function findingCard(f, docUrlFn) {
    const fileLinks = f.files
      .map((p) => {
        const url = docUrlFn(p);
        return url ? `<a href="${esc(url)}" rel="noopener">${esc(p)}</a>` : `<span class="f">${esc(p)}</span>`;
      })
      .join(' · ');
    const claims = Array.isArray(f.detail?.conflicting_claims)
      ? `<ul>${f.detail.conflicting_claims.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      : '';
    return `<div class="card">
      <span class="sev ${esc(f.severity)}">${esc(f.severity)}</span>
      <span class="conf">confidence ${(f.confidence * 100).toFixed(0)}%${f.issueUrl ? ` · <a href="${esc(f.issueUrl)}" rel="noopener">issue</a>` : ''}</span>
      <div class="summary">${esc(f.summary)}</div>
      <div class="files">${icon('docs')} ${fileLinks}</div>
      ${claims}
      ${f.evidence
        .map((e) => `<blockquote>${esc(e.excerpt)}<span class="src">${esc(e.sourceLabel)}</span></blockquote>`)
        .join('')}
      <div class="owners">${icon('owner')} Potential owner(s): <b>${esc(f.potentialOwners.join(', ') || 'unknown')}</b></div>
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
