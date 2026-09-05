/**
 * Corpus collection — markdown files only, by design. No code files, no
 * config: the extension's scope is repository documentation.
 */
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { filterGitIgnored } from '../github/owners';
import { log } from '../log';

export interface Doc {
  uri: vscode.Uri;
  relPath: string;
  text: string;
  hash: string;
}

/** Always excluded, regardless of what docgrity.exclude is set to. */
const HARD_EXCLUDE = '**/{node_modules,bower_components,dist,out,build,.git,vendor,coverage,.venv,venv}/**';

export async function collectCorpus(): Promise<Doc[]> {
  const cfg = vscode.workspace.getConfiguration('docgrity');
  const include = cfg.get<string>('include', '**/*.md');
  const userExclude = cfg.get<string>('exclude', '');
  const maxFiles = cfg.get<number>('maxFiles', 200);

  const exclude = userExclude ? `{${HARD_EXCLUDE},${userExclude}}` : HARD_EXCLUDE;
  let uris = await vscode.workspace.findFiles(include, exclude, maxFiles);

  // Respect .gitignore: findFiles only honours settings-based excludes, so
  // batch-check the candidates against git and drop anything ignored.
  uris = await dropGitIgnored(uris);

  const docs: Doc[] = [];
  for (const uri of uris) {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    if (text.trim().length < 80) continue; // skip trivial files
    docs.push({
      uri,
      relPath: vscode.workspace.asRelativePath(uri),
      text,
      hash: crypto.createHash('sha256').update(text).digest('hex'),
    });
  }
  return docs;
}

async function dropGitIgnored(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
  // Group by workspace folder so each repo's own .gitignore applies.
  const byFolder = new Map<string, { uri: vscode.Uri; rel: string }[]>();
  const passthrough: vscode.Uri[] = [];
  for (const uri of uris) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || uri.scheme !== 'file') {
      passthrough.push(uri);
      continue;
    }
    const root = folder.uri.fsPath;
    const list = byFolder.get(root) ?? [];
    list.push({ uri, rel: path.relative(root, uri.fsPath) });
    byFolder.set(root, list);
  }

  const kept: vscode.Uri[] = [...passthrough];
  for (const [root, entries] of byFolder) {
    const ignored = await filterGitIgnored(root, entries.map((e) => e.rel));
    const dropped = entries.filter((e) => ignored.has(e.rel));
    if (dropped.length > 0) {
      log.info(`Skipping ${dropped.length} git-ignored file(s) in ${root}`);
    }
    kept.push(...entries.filter((e) => !ignored.has(e.rel)).map((e) => e.uri));
  }
  return kept;
}
