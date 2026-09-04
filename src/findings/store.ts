/**
 * Findings model and persistence (workspaceState). Every finding carries
 * evidence, the model + prompt version that produced it, and potential-owner
 * labels only (never asserted ownership).
 */
import * as vscode from 'vscode';

export interface FindingEvidence {
  sourceLabel: string; // repo-relative file path
  excerpt: string;
}

export interface Finding {
  id: string;
  type: 'duplicate' | 'contradiction' | 'open_question';
  severity: string;
  confidence: number;
  summary: string;
  detail?: Record<string, unknown>;
  evidence: FindingEvidence[];
  files: string[]; // repo-relative paths involved
  potentialOwners: string[]; // git authors, labelled potential
  model: string;
  promptVersion: string;
  createdAt: string;
  issueUrl?: string;
}

const KEY = 'docgrity.findings';

export class FindingStore {
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChange.event;

  constructor(private readonly state: vscode.Memento) {}

  all(): Finding[] {
    return this.state.get<Finding[]>(KEY, []);
  }

  get(id: string): Finding | undefined {
    return this.all().find((f) => f.id === id);
  }

  async replaceAll(findings: Finding[]): Promise<void> {
    await this.state.update(KEY, findings);
    this.onChange.fire();
  }

  async update(finding: Finding): Promise<void> {
    const next = this.all().map((f) => (f.id === finding.id ? finding : f));
    await this.state.update(KEY, next);
    this.onChange.fire();
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
    this.onChange.fire();
  }
}
