import * as vscode from 'vscode';
import { FindingStore, Finding } from './findings/store';
import { FindingsTree } from './findings/tree';
import { registerDiagnostics, findRange } from './findings/diagnostics';
import { buildReport } from './findings/report';
import { runScan } from './scanner/scan';
import { raiseIssue } from './github/issues';
import { selectModelCommand } from './agents/selectModel';
import { initLog, log } from './log';

function issuesEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration('docgrity').get<string>('mode', 'report-and-issue') !==
    'report-only'
  );
}

export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  log.info(`Docgrity activated (v${context.extension.packageJSON.version})`);
  const store = new FindingStore(context.workspaceState);
  const tree = new FindingsTree(store);
  context.subscriptions.push(vscode.window.createTreeView('docgrity.findings', { treeDataProvider: tree }));
  registerDiagnostics(context, store);

  // Mode gating: in report-only mode the raise-issue surface is hidden entirely.
  const syncMode = () => {
    const enabled = issuesEnabled();
    void vscode.commands.executeCommand('setContext', 'docgrity.issuesEnabled', enabled);
    log.info(`Mode: ${enabled ? 'report-and-issue' : 'report-only'}`);
  };
  syncMode();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('docgrity.mode')) syncMode();
    })
  );

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
        const suffix = result.errors > 0 ? ` ${result.errors} assessment(s) failed — see the Docgrity output log.` : '';
        const action = await vscode.window.showInformationMessage(
          `Docgrity: ${result.findings} finding(s) across ${result.docs} docs (${result.pairs} pairs assessed).${suffix}`,
          'View findings',
          'Open report'
        );
        if (action === 'View findings') {
          await vscode.commands.executeCommand('docgrity.findings.focus');
        } else if (action === 'Open report') {
          await vscode.commands.executeCommand('docgrity.openReport');
        }
      } catch (err) {
        log.error('Scan failed', err);
        void vscode.window.showErrorMessage(`Docgrity scan failed: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('docgrity.raiseIssue', async (node?: { finding?: Finding }) => {
      // Defense in depth: the menu is hidden in report-only mode, but the
      // command could still be invoked programmatically.
      if (!issuesEnabled()) {
        void vscode.window.showInformationMessage(
          'Docgrity is in report-only mode (docgrity.mode). Switch to "report-and-issue" to raise GitHub issues.'
        );
        return;
      }
      const finding = node?.finding ?? (await pickFinding(store));
      if (!finding) return;
      try {
        await raiseIssue(finding, store);
      } catch (err) {
        log.error('Raise issue failed', err);
        void vscode.window.showErrorMessage(`Docgrity: ${(err as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('docgrity.clearFindings', () => store.clear()),

    vscode.commands.registerCommand('docgrity.openReport', async () => {
      const name = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: buildReport(store.all(), name),
      });
      await vscode.window.showTextDocument(doc, { preview: false });
      // Untitled by design — save it wherever you like (e.g. docgrity-report.md).
    }),

    vscode.commands.registerCommand('docgrity.selectModel', selectModelCommand),

    vscode.commands.registerCommand(
      'docgrity.openEvidence',
      async (relPath: string, excerpt: string) => {
        // Resolve against workspace folders directly — relPath must not be
        // treated as a glob (special characters could match the wrong file).
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
          const uri = vscode.Uri.joinPath(folder.uri, relPath);
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            const range = findRange(doc, excerpt);
            if (range) {
              editor.selection = new vscode.Selection(range.start, range.end);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
            return;
          } catch {
            // not in this folder; try the next one
          }
        }
        log.warn(`Evidence file not found in workspace: ${relPath}`);
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

export function deactivate(): void {
  // Nothing to clean up: all disposables are registered on the extension context.
}
