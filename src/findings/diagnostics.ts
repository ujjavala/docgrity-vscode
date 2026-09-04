/**
 * Diagnostics — surface evidence excerpts as squiggles on the markdown files
 * (the extension's equivalent of Confluence inline visibility).
 */
import * as vscode from 'vscode';
import { Finding, FindingStore } from './store';

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  CRITICAL: vscode.DiagnosticSeverity.Error,
  HIGH: vscode.DiagnosticSeverity.Error,
  MEDIUM: vscode.DiagnosticSeverity.Warning,
  LOW: vscode.DiagnosticSeverity.Information,
};

export function registerDiagnostics(
  context: vscode.ExtensionContext,
  store: FindingStore
): void {
  const collection = vscode.languages.createDiagnosticCollection('docgrity');
  context.subscriptions.push(collection);

  const refresh = async () => {
    collection.clear();
    const byFile = new Map<string, { finding: Finding; excerpt: string }[]>();
    for (const f of store.all()) {
      for (const e of f.evidence) {
        const list = byFile.get(e.sourceLabel) ?? [];
        list.push({ finding: f, excerpt: e.excerpt });
        byFile.set(e.sourceLabel, list);
      }
    }
    for (const [relPath, entries] of byFile) {
      const uris = await vscode.workspace.findFiles(relPath, undefined, 1);
      if (uris.length === 0) continue;
      const doc = await vscode.workspace.openTextDocument(uris[0]);
      const diagnostics: vscode.Diagnostic[] = [];
      for (const { finding, excerpt } of entries) {
        const range = findRange(doc, excerpt);
        if (!range) continue;
        const d = new vscode.Diagnostic(
          range,
          `Docgrity ${finding.type}: ${finding.summary}`,
          SEVERITY[finding.severity] ?? vscode.DiagnosticSeverity.Warning
        );
        d.source = 'docgrity';
        diagnostics.push(d);
      }
      collection.set(uris[0], diagnostics);
    }
  };

  store.onDidChange(refresh);
  void refresh();
}

export function findRange(doc: vscode.TextDocument, excerpt: string): vscode.Range | undefined {
  const needle = excerpt.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!needle) return undefined;
  const text = doc.getText();
  const flat = text.replace(/\s+/g, ' ');
  const flatIdx = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (flatIdx === -1) return undefined;
  // Map flattened index back to the original text approximately: walk both.
  let orig = 0;
  let flatPos = 0;
  while (flatPos < flatIdx && orig < text.length) {
    if (/\s/.test(text[orig])) {
      while (orig < text.length && /\s/.test(text[orig])) orig++;
      flatPos++;
    } else {
      orig++;
      flatPos++;
    }
  }
  const start = doc.positionAt(orig);
  const end = doc.positionAt(Math.min(orig + needle.length, text.length));
  return new vscode.Range(start, end);
}
