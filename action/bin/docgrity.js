#!/usr/bin/env node
/**
 * Docgrity local CLI — read-only. Runs a scan and produces the HTML report
 * dashboard (findings, evidence, doc links, potential owners). Deliberately
 * cannot raise issues or take any action: local scans observe, CI acts.
 *
 * Usage:
 *   docgrity scan [--provider gemini|openai|anthropic|github-models] [--model m]
 *                 [--dir .] [--out docgrity-report] [--open]
 * Keys via env: DOCGRITY_API_KEY (BYO providers) or GITHUB_TOKEN (github-models).
 */
import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { makeClient } from '../src/llm.js';
import { runScan } from '../src/scan.js';
import { renderReport } from '../src/report.js';
import { githubRepoSlug, defaultBranch } from '../src/corpus.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
      else args[key] = true;
    } else args._.push(argv[i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const HELP = `docgrity — doc-integrity scans for repository markdown (read-only)

Finds contradictions, duplicates, and open questions across your repo's
markdown docs, and writes an HTML report + findings.json. The CLI never
posts anything anywhere — it is report-only by design.

Usage:
  docgrity scan [options]

Options:
  --dir <path>            Directory to scan (default: .)
  --out <path>            Report output directory (default: docgrity-report)
  --open                  Open the HTML report when done

  --checks <list>         Comma-separated checks to run (default: all)
                          duplicates, contradictions, open-questions
  --max-files <n>         Max markdown files to scan (default: 200)
  --max-pairs <n>         Max document pairs to assess (default: 25)
  --threshold-duplicate <0..1>       Min confidence, duplicates (default: 0.75)
  --threshold-contradiction <0..1>   Min confidence, contradictions (default: 0.7)
  --threshold-open-question <0..1>   Min confidence, open questions (default: 0.6)

  --provider <p>          none | ollama | gemini | openai | anthropic | github-models
                          (default: auto — see below)
                          none = no-agent mode: pure algorithms, zero LLM calls.
                          Detects duplicates (verbatim shared blocks + TF-IDF)
                          and open questions (TODO/TBD/FIXME/???… markers).
                          Contradictions REQUIRE an AI model and are skipped.
  --model <m>             Model name (provider-specific default otherwise)
  --endpoint <url>        Ollama endpoint (default: http://localhost:11434,
                          or DOCGRITY_OLLAMA_URL; supports tunnelled remotes)

  --version, -v           Print installed version (and latest on npm)
  --help, -h              Show this help

Environment:
  DOCGRITY_API_KEY        API key for gemini / openai / anthropic
  DOCGRITY_OLLAMA_URL     Default Ollama endpoint
  GITHUB_TOKEN / GH_TOKEN Token for the github-models provider

Provider auto-detection (when --provider is omitted):
  DOCGRITY_API_KEY set → gemini; else GITHUB_TOKEN set → github-models;
  else → ollama (local, fully private).

Examples:
  docgrity scan --open
  docgrity scan --provider none              # no-agent: no model, no keys, instant
  docgrity scan --checks contradictions
  docgrity scan --checks duplicates,open-questions --max-pairs 10
  docgrity scan --provider ollama --model llama3.1:8b
  docgrity scan --provider gemini            # DOCGRITY_API_KEY=...
  docgrity scan --dir ./docs --out /tmp/report --threshold-contradiction 0.8

Docs: https://ujjavala.github.io/docgrity-vscode-site/
`;

async function localVersion() {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  return JSON.parse(await readFile(pkgPath, 'utf8')).version;
}

async function latestVersion() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch('https://registry.npmjs.org/docgrity/latest', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return undefined;
    return (await res.json()).version;
  } catch {
    return undefined;
  }
}

if (args.help || args.h || args._[0] === 'help') {
  console.log(HELP);
  process.exit(0);
}

if (args.version || args.v) {
  const installed = await localVersion();
  const latest = await latestVersion();
  console.log(`docgrity ${installed}`);
  if (latest && latest !== installed) {
    console.log(`Latest on npm: ${latest} — update with: npm i -g docgrity`);
  } else if (latest) {
    console.log('Up to date.');
  }
  process.exit(0);
}

if (args._[0] !== 'scan') {
  console.log(HELP);
  process.exit(args._[0] ? 1 : 0);
}

const CHECK_NAMES = { duplicates: 'duplicates', contradictions: 'contradictions', 'open-questions': 'openQuestions' };
function parseChecks(value) {
  if (!value || value === true) return { duplicates: true, contradictions: true, openQuestions: true };
  const checks = { duplicates: false, contradictions: false, openQuestions: false };
  for (const name of String(value).split(',').map((s) => s.trim()).filter(Boolean)) {
    const key = CHECK_NAMES[name];
    if (!key) {
      console.error(`docgrity: unknown check "${name}" (valid: ${Object.keys(CHECK_NAMES).join(', ')})`);
      process.exit(1);
    }
    checks[key] = true;
  }
  return checks;
}

const numArg = (v, fallback) => (v === undefined || v === true ? fallback : Number(v));

const root = path.resolve(args.dir ?? '.');
const outDir = path.resolve(root, args.out ?? 'docgrity-report');
const provider =
  args.provider ??
  (process.env.DOCGRITY_API_KEY ? 'gemini' : process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? 'github-models' : 'ollama');
const checks = parseChecks(args.checks);

try {
  const client =
    provider === 'none'
      ? null
      : makeClient({
          provider,
          apiKey: process.env.DOCGRITY_API_KEY,
          githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
          model: args.model,
          endpoint: args.endpoint,
        });

  const enabled = Object.entries(checks).filter(([, on]) => on).map(([k]) => k).join(', ');
  console.log(`Docgrity local scan (read-only) — provider: ${provider}${provider === 'none' ? ' (no-agent, heuristics only)' : ''}; checks: ${enabled}`);
  if (provider === 'none' && checks.contradictions) {
    console.log('  Note: contradiction detection needs AI intelligence — it will be skipped. Use an LLM provider to enable it.');
  }
  const { findings, stats } = await runScan(root, {
    client,
    checks,
    maxFiles: numArg(args['max-files'], 200),
    maxPairs: numArg(args['max-pairs'], 25),
    thresholds: {
      duplicate: numArg(args['threshold-duplicate'], 0.75),
      contradiction: numArg(args['threshold-contradiction'], 0.7),
      openQuestion: numArg(args['threshold-open-question'], 0.6),
    },
    log: (m) => console.log(`  ${m}`),
  });

  const slug = await githubRepoSlug(root);
  const branch = slug ? await defaultBranch(root) : undefined;
  const html = renderReport({ findings, stats, repoSlug: slug, branch });

  await mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'index.html');
  await writeFile(reportPath, html);
  await writeFile(path.join(outDir, 'findings.json'), JSON.stringify({ findings, stats }, null, 2));

  console.log(`\n${findings.length} finding(s) across ${stats.docs} docs.`);
  console.log(`Report: ${reportPath}`);
  console.log('Note: local scans are read-only — review owners and evidence in the report; issues are only raised by CI (opt-in).');

  if (args.open) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [reportPath]);
} catch (err) {
  console.error(`docgrity: ${err.message}`);
  process.exit(1);
}
