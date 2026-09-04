/**
 * Findings tree view — type -> finding -> evidence excerpts.
 */
import * as vscode from 'vscode';
import { Finding, FindingStore } from './store';

type Node =
  | { kind: 'type'; type: string; label: string }
  | { kind: 'finding'; finding: Finding }
  | { kind: 'evidence'; finding: Finding; index: number };

const TYPE_LABELS: Record<string, string> = {
  contradiction: 'Contradictions',
  duplicate: 'Duplicates',
  open_question: 'Open questions',
};

export class FindingsTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: FindingStore) {
    store.onDidChange(() => this.emitter.fire(undefined));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'type') {
      const count = this.store.all().filter((f) => f.type === node.type).length;
      const item = new vscode.TreeItem(
        `${node.label} (${count})`,
        vscode.TreeItemCollapsibleState.Expanded
      );
      return item;
    }
    if (node.kind === 'finding') {
      const f = node.finding;
      const item = new vscode.TreeItem(f.summary, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'finding';
      item.description = `${f.severity} · ${(f.confidence * 100).toFixed(0)}%${f.issueUrl ? ' · issue raised' : ''}`;
      item.tooltip = new vscode.MarkdownString(
        `**${f.type}** — ${f.summary}\n\nFiles: ${f.files.join(', ')}\n\nPotential owner(s): ${
          f.potentialOwners.join(', ') || 'unknown'
        }\n\n_model ${f.model}, prompt ${f.promptVersion}_`
      );
      item.iconPath = new vscode.ThemeIcon(
        f.type === 'contradiction' ? 'warning' : f.type === 'duplicate' ? 'copy' : 'question'
      );
      return item;
    }
    const e = node.finding.evidence[node.index];
    const item = new vscode.TreeItem(
      `${e.sourceLabel}: “${e.excerpt.slice(0, 80)}…”`,
      vscode.TreeItemCollapsibleState.None
    );
    item.command = {
      command: 'docgrity.openEvidence',
      title: 'Open evidence',
      arguments: [e.sourceLabel, e.excerpt],
    };
    item.iconPath = new vscode.ThemeIcon('quote');
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return Object.entries(TYPE_LABELS)
        .filter(([type]) => this.store.all().some((f) => f.type === type))
        .map(([type, label]) => ({ kind: 'type', type, label }));
    }
    if (node.kind === 'type') {
      return this.store
        .all()
        .filter((f) => f.type === node.type)
        .map((finding) => ({ kind: 'finding', finding }));
    }
    if (node.kind === 'finding') {
      return node.finding.evidence.map((_e, index) => ({
        kind: 'evidence',
        finding: node.finding,
        index,
      }));
    }
    return [];
  }
}
