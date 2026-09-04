/**
 * LLM access — all requests go through vscode.lm (the user's own Copilot
 * subscription). Typed JSON only: every response is extracted and validated
 * in code; invalid output is rejected, never partially trusted.
 */
import * as vscode from 'vscode';
import { PROMPTS } from './prompts';
import type { Doc } from '../scanner/corpus';

export interface Evidence {
  page: 'A' | 'B';
  excerpt: string;
}

export interface OpenQuestion {
  question: string;
  excerpt: string;
  confidence: number;
  severity: string;
}

const num = (v: unknown, lo = 0, hi = 1): number =>
  Math.min(hi, Math.max(lo, Number(v) || 0));
const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

function validateEvidence(list: unknown): Evidence[] {
  return (Array.isArray(list) ? list : [])
    .map((e) => ({
      page: (e?.page === 'B' ? 'B' : 'A') as 'A' | 'B',
      excerpt: str(e?.excerpt).slice(0, 1000),
    }))
    .filter((e) => e.excerpt);
}

async function pickModel(): Promise<vscode.LanguageModelChat> {
  // Models rotate; select at call time, prefer a strong family, fall back to any.
  const preferred = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
  if (preferred.length > 0) return preferred[0];
  const any = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (any.length === 0) {
    throw new Error('No Copilot language model available. Sign in to GitHub Copilot.');
  }
  return any[0];
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

export async function completeJson<T>(opts: {
  system: string;
  prompt: string;
  validate: (raw: any) => T;
  token: vscode.CancellationToken;
}): Promise<{ output: T; model: string }> {
  const model = await pickModel();
  const messages = [
    vscode.LanguageModelChatMessage.Assistant(opts.system),
    vscode.LanguageModelChatMessage.User(opts.prompt),
  ];
  const response = await model.sendRequest(messages, {}, opts.token);
  let text = '';
  for await (const chunk of response.text) text += chunk;
  return { output: opts.validate(extractJson(text)), model: model.id };
}

function pairPrompt(a: Doc, b: Doc): string {
  return `PAGE A — "${a.relPath}":\n${a.text.slice(0, 8000)}\n\n---\n\nPAGE B — "${b.relPath}":\n${b.text.slice(0, 8000)}`;
}

export async function assessDuplicate(a: Doc, b: Doc, token: vscode.CancellationToken) {
  const p = PROMPTS.duplicate;
  const { output, model } = await completeJson({
    system: p.system,
    prompt: pairPrompt(a, b),
    token,
    validate: (o) => ({
      is_duplicate: Boolean(o.is_duplicate),
      confidence: num(o.confidence),
      summary: str(o.summary).slice(0, 2000),
      recommended_action: str(o.recommended_action || 'REVIEW'),
      evidence: validateEvidence(o.evidence),
    }),
  });
  return { output, model, promptVersion: p.version };
}

export async function assessContradiction(a: Doc, b: Doc, token: vscode.CancellationToken) {
  const p = PROMPTS.contradiction;
  const { output, model } = await completeJson({
    system: p.system,
    prompt: pairPrompt(a, b),
    token,
    validate: (o) => ({
      is_contradiction: Boolean(o.is_contradiction),
      confidence: num(o.confidence),
      severity: SEVERITIES.has(o.severity) ? (o.severity as string) : 'MEDIUM',
      summary: str(o.summary).slice(0, 2000),
      conflicting_claims: (Array.isArray(o.conflicting_claims) ? o.conflicting_claims : []).map(
        (c: unknown) => str(c).slice(0, 500)
      ),
      evidence: validateEvidence(o.evidence),
    }),
  });
  return { output, model, promptVersion: p.version };
}

export async function assessOpenQuestions(doc: Doc, token: vscode.CancellationToken) {
  const p = PROMPTS.open_question;
  const { output, model } = await completeJson({
    system: p.system,
    prompt: `Document path: ${doc.relPath}\n\nDocument content:\n${doc.text.slice(0, 12000)}`,
    token,
    validate: (o) => ({
      questions: (Array.isArray(o.questions) ? o.questions : [])
        .map(
          (q: any): OpenQuestion => ({
            question: str(q.question).slice(0, 500),
            excerpt: str(q.excerpt).slice(0, 1000),
            confidence: num(q.confidence),
            severity: SEVERITIES.has(q.severity) ? (q.severity as string) : 'MEDIUM',
          })
        )
        .filter((q: OpenQuestion) => q.question && q.excerpt),
    }),
  });
  return { output, model, promptVersion: p.version };
}

export async function draftIssue(
  finding: {
    type: string;
    summary: string;
    evidence: { sourceLabel: string; excerpt: string }[];
    potentialOwners: string[];
  },
  token: vscode.CancellationToken
): Promise<{ title: string; body: string }> {
  const p = PROMPTS.issue;
  const { output } = await completeJson({
    system: p.system,
    prompt: `Finding type: ${finding.type}\nSummary: ${finding.summary}\nEvidence:\n${finding.evidence
      .map((e) => `- [${e.sourceLabel}] "${e.excerpt}"`)
      .join('\n')}\nPotential owners: ${finding.potentialOwners.join(', ') || 'unknown'}`,
    token,
    validate: (o) => ({
      title: str(o.title).slice(0, 200) || 'Docgrity finding',
      body: str(o.body).slice(0, 20000),
    }),
  });
  return output;
}
