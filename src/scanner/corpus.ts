/**
 * Corpus collection — markdown files only, by design. No code files, no
 * config: the extension's scope is repository documentation.
 */
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';

export interface Doc {
  uri: vscode.Uri;
  relPath: string;
  text: string;
  hash: string;
}

export async function collectCorpus(): Promise<Doc[]> {
  const cfg = vscode.workspace.getConfiguration('docgrity');
  const include = cfg.get<string>('include', '**/*.md');
  const exclude = cfg.get<string>('exclude', '**/{node_modules,dist,out,build,.git,vendor}/**');
  const maxFiles = cfg.get<number>('maxFiles', 200);

  const uris = await vscode.workspace.findFiles(include, exclude, maxFiles);
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
