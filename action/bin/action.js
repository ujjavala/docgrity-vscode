/**
 * GitHub Action entrypoint. Reads inputs from env (INPUT_*), runs the scan,
 * writes the job summary + HTML report, and (opt-in) syncs deduplicated issues.
 */
import { mkdir, writeFile, appendFile } from 'fs/promises';
import path from 'path';
import { makeClient } from '../src/llm.js';
import { runScan } from '../src/scan.js';
import { renderReport, renderSummaryMarkdown } from '../src/report.js';
import { syncIssues } from '../src/issues.js';

const input = (name, fallback = '') =>
  (process.env[`INPUT_${name.toUpperCase()}`] ?? fallback).toString().trim() || fallback;

const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
const token = process.env.GITHUB_TOKEN ?? process.env.INPUT_GITHUB_TOKEN ?? '';
const slug = process.env.GITHUB_REPOSITORY ?? '';
const branch = (process.env.GITHUB_REF_NAME ?? 'main').replace(/^refs\/heads\//, '');

try {
  const client = makeClient({
    provider: input('provider', 'github-models'),
    apiKey: input('api_key'),
    githubToken: token,
  });

  console.log(`Docgrity scan on ${slug} (${branch})`);
  const { findings, stats } = await runScan(root, { client, log: (m) => console.log(m) });

  // Opt-in issue sync (deduped by fingerprint, capped, auto-close resolved).
  let issueResult = null;
  if (input('create_issues', 'false') === 'true') {
    if (!token) throw new Error('create_issues requires GITHUB_TOKEN with issues: write');
    issueResult = await syncIssues({
      client,
      token,
      slug,
      findings,
      maxNewIssues: Number(input('max_new_issues', '5')) || 5,
      log: (m) => console.log(m),
    });
  }

  // Static HTML report + raw findings.
  const outDir = path.resolve(root, input('out_dir', 'docgrity-report'));
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.html'), renderReport({ findings, stats, repoSlug: slug, branch }));
  await writeFile(path.join(outDir, 'findings.json'), JSON.stringify({ findings, stats }, null, 2));

  // Job summary.
  if (process.env.GITHUB_STEP_SUMMARY) {
    let summary = renderSummaryMarkdown({ findings, stats });
    if (issueResult) {
      summary += `\n\nIssues: ${issueResult.created.length} created, ${issueResult.closed.length} closed, ${issueResult.unchanged} unchanged${issueResult.skipped ? `, ${issueResult.skipped} skipped (cap)` : ''}.`;
    }
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }

  // Outputs.
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `findings=${findings.length}\nreport_dir=${outDir}\n`
    );
  }

  console.log(`Done: ${findings.length} finding(s). Report in ${outDir}`);
} catch (err) {
  console.error(`::error::Docgrity scan failed: ${err.message}`);
  process.exit(1);
}
