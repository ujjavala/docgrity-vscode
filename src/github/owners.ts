/**
 * Potential-owner inference — last git author of the file, always labelled
 * *potential* (mirrors the Forge app's inferred-ownership rule).
 */
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { parseGithubSlug } from '../core/slug';

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

/**
 * Filter out paths that are git-ignored in the given repo root. Uses a single
 * `git check-ignore --stdin` batch call; on any git error (not a repo, git
 * missing) all paths are kept.
 */
export async function filterGitIgnored(root: string, relPaths: string[]): Promise<Set<string>> {
  if (relPaths.length === 0) return new Set();
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['check-ignore', '--stdin', '-z'],
      { cwd: root, timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        // Exit code 1 = nothing ignored (not an error); other errors → empty set.
        const code = (err as { code?: number | string } | null)?.code;
        if (err && code !== 1) {
          resolve(new Set());
          return;
        }
        resolve(new Set(stdout.split('\0').filter(Boolean)));
      }
    );
    child.stdin?.end(relPaths.join('\0'));
  });
}

export async function potentialOwner(uri: vscode.Uri): Promise<string | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder || uri.scheme !== 'file') return undefined;
  const out = await git(
    ['log', '-1', '--format=%an', '--', path.relative(folder.uri.fsPath, uri.fsPath)],
    folder.uri.fsPath
  );
  return out || undefined;
}

/** Derive owner/repo from the origin remote, if it's a GitHub remote. */
export async function githubRepoSlug(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  const url = await git(['remote', 'get-url', 'origin'], folder.uri.fsPath);
  return parseGithubSlug(url);
}
