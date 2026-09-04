/**
 * GitHub issue creation — the notify surface for this extension (the Forge
 * app's equivalent of a Confluence comment). Uses VS Code's built-in GitHub
 * authentication; requires explicit human approval before anything is posted.
 */
import * as vscode from 'vscode';
import { Finding, FindingStore } from '../findings/store';
import { draftIssue } from '../agents/assess';
import { githubRepoSlug } from './owners';

export async function raiseIssue(finding: Finding, store: FindingStore): Promise<void> {
  if (finding.issueUrl) {
    const open = 'Open existing issue';
    const pick = await vscode.window.showInformationMessage(
      'An issue was already raised for this finding.',
      open
    );
    if (pick === open) void vscode.env.openExternal(vscode.Uri.parse(finding.issueUrl));
    return;
  }

  const slug = await githubRepoSlug();
  if (!slug) {
    void vscode.window.showErrorMessage(
      'Docgrity: no GitHub origin remote found in this workspace.'
    );
    return;
  }

  const draft = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Docgrity: drafting issue…' },
    (_p, token) =>
      draftIssue(
        {
          type: finding.type,
          summary: finding.summary,
          evidence: finding.evidence,
          potentialOwners: finding.potentialOwners,
        },
        token
      )
  );

  // Human approval gate: show the draft before anything leaves the editor.
  const preview = await vscode.window.showInformationMessage(
    `Raise GitHub issue on ${slug}?\n\n${draft.title}`,
    { modal: true, detail: draft.body.slice(0, 1500) },
    'Create issue'
  );
  if (preview !== 'Create issue') return;

  const session = await vscode.authentication.getSession('github', ['repo'], {
    createIfNone: true,
  });

  const res = await fetch(`https://api.github.com/repos/${slug}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title: draft.title,
      body: `${draft.body}\n\n---\n_Raised by Docgrity (${finding.type}, confidence ${finding.confidence.toFixed(2)}, model ${finding.model}, prompt ${finding.promptVersion})._`,
      labels: ['docgrity', `docgrity:${finding.type}`],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    void vscode.window.showErrorMessage(
      `Docgrity: GitHub issue creation failed (${res.status}). ${text.slice(0, 200)}`
    );
    return;
  }

  const issue = (await res.json()) as { html_url: string; number: number };
  await store.update({ ...finding, issueUrl: issue.html_url });
  const open = `Open #${issue.number}`;
  const pick = await vscode.window.showInformationMessage(
    `Docgrity: issue #${issue.number} created on ${slug}.`,
    open
  );
  if (pick === open) void vscode.env.openExternal(vscode.Uri.parse(issue.html_url));
}
