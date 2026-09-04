#!/usr/bin/env node
/**
 * Docgrity local CLI — read-only. Runs a scan and produces the HTML report
 * dashboard (findings, evidence, doc links, potential owners). Deliberately
 * cannot raise issues or take any action: local scans observe, CI acts.
 *
 * Usage:
 *   docgrity scan [--provider gemini|openai|anthropic|github-models]
 *                 [--dir .] [--out docgrity-report] [--open]
 * Keys via env: DOCGRITY_API_KEY (BYO providers) or GITHUB_TOKEN (github-models).
 */
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
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

if (args._[0] !== 'scan') {
  console.log('Usage: docgrity scan [--provider p] [--dir .] [--out docgrity-report] [--open]');
  process.exit(args._[0] ? 1 : 0);
}

const root = path.resolve(args.dir ?? '.');
const outDir = path.resolve(root, args.out ?? 'docgrity-report');
const provider = args.provider ?? (process.env.DOCGRITY_API_KEY ? 'gemini' : 'github-models');

try {
  const client = makeClient({
    provider,
    apiKey: process.env.DOCGRITY_API_KEY,
    githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  });

  console.log(`Docgrity local scan (read-only) — provider: ${provider}`);
  const { findings, stats } = await runScan(root, { client, log: (m) => console.log(`  ${m}`) });

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
