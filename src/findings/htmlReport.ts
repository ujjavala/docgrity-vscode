/**
 * Interactive HTML dashboard report, rendered in a webview. Same design as the
 * CLI/Action report: clickable stat widgets, severity filters, expandable rows,
 * owner tags and doc paths. Doc paths open the file in the editor via message
 * passing (webviews cannot open files directly).
 */
import { Finding } from './store';

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const TYPE_LABELS: Record<string, string> = {
  contradiction: 'Contradictions',
  duplicate: 'Duplicates',
  open_question: 'Open questions',
};

/* Inline SVG icons (24px grid, 2px stroke) — zero dependencies. */
const ICONS: Record<string, string> = {
  findings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></svg>',
  duplicate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  contradiction:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  open_question:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 5-6"/></svg>',
};

const icon = (name: string): string =>
  `<span class="ic" aria-hidden="true">${ICONS[name] ?? ''}</span>`;

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function findingRows(f: Finding, type: string, i: number): string {
  const rowId = `${type}-${i}`;
  const fileLinks = f.files
    .map(
      (p) =>
        `<a class="docpath" href="#" data-open="${esc(p)}" data-excerpt="${esc(
          f.evidence.find((e) => e.sourceLabel === p)?.excerpt ?? ''
        )}">${esc(p)}</a>`
    )
    .join('');
  const owners = f.potentialOwners.length
    ? f.potentialOwners
        .map((o) => {
          const initials = o
            .trim()
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
          return `<span class="owner"><span class="avatar">${esc(initials)}</span>${esc(o)}</span>`;
        })
        .join(' ')
    : '<span class="owner"><span class="avatar">?</span>unknown</span>';
  const action = esc((f.detail?.recommended_action as string) ?? 'REVIEW');
  const rawClaims = f.detail?.conflicting_claims;
  const claims =
    Array.isArray(rawClaims) && rawClaims.length
      ? `<ul>${rawClaims.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      : '';
  return `<tr class="frow" data-sev="${esc(f.severity)}" data-detail="detail-${rowId}">
    <td><span class="chev">▶</span>${esc(f.summary)}</td>
    <td><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span></td>
    <td>${(f.confidence * 100).toFixed(0)}%</td>
    <td>${fileLinks}</td>
    <td>${owners}</td>
    <td><span class="action">${action}</span></td>
  </tr>
  <tr class="detail" id="detail-${rowId}"><td colspan="6">
    ${claims}
    ${f.evidence
      .map(
        (e) =>
          `<blockquote>${esc(e.excerpt)}<span class="src"><a href="#" data-open="${esc(
            e.sourceLabel
          )}" data-excerpt="${esc(e.excerpt)}">${esc(e.sourceLabel)}</a></span></blockquote>`
      )
      .join('')}
    ${f.issueUrl ? `<div class="fine"><a href="${esc(f.issueUrl)}">View raised issue</a></div>` : ''}
    <div class="fine">model ${esc(f.model)} · prompt ${esc(f.promptVersion)} · ${esc(f.createdAt)}</div>
  </td></tr>`;
}

export function buildHtmlReport(
  findings: Finding[],
  workspaceName: string,
  webview: { cspSource: string }
): string {
  const nonce = Array.from({ length: 24 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))
  ).join('');

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.type] = (counts[f.type] ?? 0) + 1;

  const sections = Object.entries(TYPE_LABELS)
    .map(([type, label]) => {
      const items = findings
        .filter((f) => f.type === type)
        .sort(
          (a, b) =>
            (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || b.confidence - a.confidence
        );
      return `
  <section class="type-section" id="section-${type}" ${items.length === 0 ? 'hidden' : ''}>
    <h2>${icon(type)} ${esc(label)} <span class="count">${items.length}</span></h2>
    <div class="filters">Filter severity:
      ${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
        .map((s) => `<button class="sevbtn" data-type="${type}" data-sev="${s}">${s}</button>`)
        .join(' ')}
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th>Finding</th><th>Severity</th><th>Confidence</th><th>Docs</th><th>Potential owner</th><th>Action</th>
        </tr></thead>
        <tbody>
          ${items.map((f, i) => findingRows(f, type, i)).join('\n')}
        </tbody>
      </table>
    </div>
  </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Docgrity report</title>
<style nonce="${nonce}">
  :root { --blue:#1558bc; --blue-dark:#0d3d8a; --teal:#16a394; --muted:#5b6470; --bg:#f4f6fa; --card:#fff; --border:#e3e8ef;
          --crit:#c62828; --high:#e65100; --med:#a07d00; --low:#5b6470;
          --good:#1d7a3e; --good-bg:#e8f6ed; --warn-bg:#fdecea; --dup-bg:#fff4e0; --oq-bg:#eef3fd; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:var(--bg); color:#1a2230; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px 60px; }
  .hero { background:linear-gradient(120deg, var(--blue-dark), var(--blue) 60%, var(--teal)); color:#fff;
          margin: 0 -20px; padding: 26px 28px 24px; }
  .hero h1 { font-size: 1.35rem; margin: 0 0 4px; font-weight: 700; }
  .hero .meta { color: rgba(255,255,255,.85); font-size: .85rem; }
  .ic { display:inline-flex; width:20px; height:20px; vertical-align:-4px; }
  .ic svg { width:100%; height:100%; }
  .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin: -20px 0 24px; }
  .stat { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:13px 15px;
          box-shadow: 0 2px 8px rgba(16,30,54,.06); display:flex; align-items:flex-start; justify-content:space-between;
          cursor:pointer; text-align:left; font:inherit; color:inherit; transition: box-shadow .15s, transform .15s; }
  .stat:hover { box-shadow: 0 4px 14px rgba(16,30,54,.14); transform: translateY(-1px); }
  .stat.active { outline: 2px solid var(--blue); }
  .stat .label { color:var(--muted); font-size:.8rem; font-weight:600; }
  .stat .num { font-size:1.6rem; font-weight:800; line-height:1.15; }
  .stat .sub { color:var(--blue); font-size:.74rem; font-weight:600; }
  .badge { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex:none; }
  .badge .ic { width:21px; height:21px; }
  .badge.findings { background:#e7eefb; color:var(--blue); }
  .badge.duplicate { background:var(--dup-bg); color:var(--high); }
  .badge.contradiction { background:var(--warn-bg); color:var(--crit); }
  .badge.open_question { background:var(--oq-bg); color:var(--blue); }
  .badge.ok { background:var(--good-bg); color:var(--good); }
  h2 { font-size: 1.08rem; margin: 30px 0 10px; display:flex; align-items:center; gap:8px; }
  h2 .ic { color:var(--muted); }
  .count { background:#e7eefb; color:var(--blue); font-size:.76rem; font-weight:700; border-radius:999px; padding:1px 10px; }
  .filters { color:var(--muted); font-size:.83rem; margin-bottom:10px; }
  .sevbtn { font:inherit; font-size:.73rem; font-weight:700; letter-spacing:.03em; padding:3px 12px; margin-left:4px;
            border:1px solid var(--border); border-radius:8px; background:var(--card); color:#1a2230; cursor:pointer; }
  .sevbtn.on { border-color: var(--blue); background:#e7eefb; color: var(--blue); }
  .tablewrap { background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden;
               box-shadow: 0 1px 4px rgba(16,30,54,.05); }
  table { width:100%; border-collapse: collapse; font-size:.88rem; }
  th { text-align:left; color:var(--muted); font-size:.76rem; font-weight:600; padding:10px 14px;
       border-bottom:1px solid var(--border); }
  td { padding:11px 14px; border-bottom:1px solid var(--border); vertical-align:top; }
  tr.frow { cursor:pointer; }
  tr.frow:hover { background:#f7f9fc; }
  tr:last-child td { border-bottom:none; }
  .sev { display:inline-block; font-size:.7rem; font-weight:700; letter-spacing:.04em; padding:2px 8px;
         border-radius:999px; color:#fff; }
  .sev.CRITICAL{background:var(--crit)} .sev.HIGH{background:var(--high)} .sev.MEDIUM{background:var(--med)} .sev.LOW{background:var(--low)}
  .docpath { font-family: ui-monospace, monospace; font-size:.78rem; display:block; color:var(--blue); text-decoration:none; }
  .owner { display:inline-flex; align-items:center; gap:5px; background:#eef3fd; color:var(--blue-dark);
           border-radius:999px; padding:2px 10px 2px 4px; font-size:.78rem; font-weight:600; margin:1px 2px 1px 0; }
  .avatar { width:20px; height:20px; border-radius:50%; background:var(--blue); color:#fff; display:inline-flex;
            align-items:center; justify-content:center; font-size:.64rem; font-weight:700; flex:none; }
  .action { font-size:.76rem; font-weight:700; color:var(--muted); letter-spacing:.03em; }
  tr.detail { display:none; background:#fafbfd; }
  tr.detail.open { display:table-row; }
  blockquote { margin: 8px 0; padding: 8px 12px; border-left: 3px solid var(--teal); background:#f0faf8;
               font-size:.86rem; border-radius: 0 8px 8px 0; }
  blockquote .src { display:block; color:var(--muted); font-size:.76rem; font-family: ui-monospace, monospace; margin-top:4px; }
  blockquote .src a { color:var(--blue); text-decoration:none; }
  .fine { color:var(--muted); font-size:.74rem; margin-top:6px; }
  .empty { background:var(--good-bg); border:1px solid #cdebd8; color:var(--good); border-radius:12px;
           padding:18px 20px; display:flex; align-items:center; gap:10px; font-weight:600; }
  .chev { color:var(--muted); font-size:.72rem; margin-right:6px; display:inline-block; transition: transform .15s; }
  tr.frow.open .chev { transform: rotate(90deg); }
  footer { margin-top:38px; color:var(--muted); font-size:.78rem; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>Docgrity — documentation-integrity report</h1>
    <div class="meta">${esc(workspaceName)} · generated ${esc(new Date().toISOString())} · ${findings.length} finding(s)</div>
  </div>
  <div class="stats">
    <button class="stat" data-target="all"><div><div class="label">Open findings</div><div class="num">${findings.length}</div><div class="sub">view all</div></div><div class="badge ${findings.length ? 'findings' : 'ok'}">${icon(findings.length ? 'findings' : 'check')}</div></button>
    <button class="stat" data-target="duplicate"><div><div class="label">Duplicates</div><div class="num">${counts.duplicate ?? 0}</div><div class="sub">view duplicates</div></div><div class="badge duplicate">${icon('duplicate')}</div></button>
    <button class="stat" data-target="contradiction"><div><div class="label">Contradictions</div><div class="num">${counts.contradiction ?? 0}</div><div class="sub">view contradictions</div></div><div class="badge contradiction">${icon('contradiction')}</div></button>
    <button class="stat" data-target="open_question"><div><div class="label">Open questions</div><div class="num">${counts.open_question ?? 0}</div><div class="sub">view questions</div></div><div class="badge open_question">${icon('open_question')}</div></button>
  </div>
  ${findings.length === 0 ? `<div class="empty">${icon('check')} No findings — your docs agree with themselves. Run <strong>Docgrity: Scan repository docs</strong> to (re)scan.</div>` : sections}
  <footer>Ownership is inferred from git history and is always <em>potential</em>, never asserted. Click a doc path to open it in the editor.</footer>
</div>
<script nonce="${nonce}">
(function () {
  var vscode = acquireVsCodeApi();

  // Doc-path links -> open the file (at the evidence excerpt) in the editor.
  document.querySelectorAll('a[data-open]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      vscode.postMessage({ type: 'open', path: a.getAttribute('data-open'), excerpt: a.getAttribute('data-excerpt') || '' });
    });
  });

  // Widget click -> show that type's rows (or all), scroll to it.
  var stats = document.querySelectorAll('.stat');
  stats.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-target');
      stats.forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.type-section').forEach(function (sec) {
        var type = sec.id.replace('section-', '');
        var has = sec.querySelector('tbody tr');
        sec.hidden = !has || (target !== 'all' && type !== target);
      });
      var first = document.querySelector('.type-section:not([hidden])');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Row click -> expand/collapse evidence detail.
  document.querySelectorAll('tr.frow').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      row.classList.toggle('open');
      var detail = document.getElementById(row.getAttribute('data-detail'));
      if (detail) detail.classList.toggle('open');
    });
  });

  // Severity filter buttons (toggle; none active = show all).
  document.querySelectorAll('.sevbtn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.classList.toggle('on');
      var type = btn.getAttribute('data-type');
      var active = Array.prototype.map.call(
        document.querySelectorAll('.sevbtn.on[data-type="' + type + '"]'),
        function (b) { return b.getAttribute('data-sev'); }
      );
      document.querySelectorAll('#section-' + type + ' tr.frow').forEach(function (row) {
        var show = active.length === 0 || active.indexOf(row.getAttribute('data-sev')) !== -1;
        row.style.display = show ? '' : 'none';
        if (!show) {
          row.classList.remove('open');
          var d = document.getElementById(row.getAttribute('data-detail'));
          if (d) d.classList.remove('open');
        }
      });
    });
  });
})();
</script>
</body>
</html>`;
}
