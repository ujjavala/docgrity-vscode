import * as vscode from 'vscode';
import { FindingStore, Finding } from './findings/store';
import { FindingsTree } from './findings/tree';
import { registerDiagnostics, findRange } from './findings/diagnostics';
import { runScan } from './scanner/scan';
import { raiseIssue } from './github/issues';

export function activate(context: vscode.ExtensionContext): void {
  const store = new FindingStore(context.workspaceState);
  const tree = new FindingsTree(store);
  context.subscriptions.push(vscode.window.createTreeView('docgrity.findings', { treeDataProvider: tree }));
  registerDiagnostics(context, store);

  context.subscriptions.push(
    vscode.commands.registerCommand('docgrity.scan', async () => {
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Docgrity scan',
            cancellable: true,
          },
          (progress, token) => runScan(store, progress, token)
        );
        void vscode.window.showInformationMessage(
          `Docgrity: ${result.findings} finding(s) across ${result.docs} docs (${result.pairs} pairs assessed).`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Docgrity scan failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('docgrity.raiseIssue', async (node?: { finding?: Finding }) => {
      const finding = node?.finding ?? (await pickFinding(store));
      if (!finding) return;
      try {
        await raiseIssue(finding, store);
      } catch (err) {
        void vscode.window.showErrorMessage(`Docgrity: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('docgrity.clearFindings', () => store.clear()),

    vscode.commands.registerCommand(
      'docgrity.openEvidence',
      async (relPath: string, excerpt: string) => {
        const uris = await vscode.workspace.findFiles(relPath, undefined, 1);
        if (uris.length === 0) return;
        const doc = await vscode.workspace.openTextDocument(uris[0]);
        const editor = await vscode.window.showTextDocument(doc);
        const range = findRange(doc, excerpt);
        if (range) {
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
      }
    )
  );
}

async function pickFinding(store: FindingStore): Promise<Finding | undefined> {
  const items = store.all().map((f) => ({
    label: `[${f.type}] ${f.summary.slice(0, 80)}`,
    description: f.files.join(', '),
    finding: f,
  }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage('Docgrity: no findings. Run a scan first.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Raise an issue for which finding?' });
  return pick?.finding;
}

export function deactivate(): void {}
