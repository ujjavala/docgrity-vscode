/**
 * LLM access — all requests go through vscode.lm (the user's own Copilot
 * subscription). Typed JSON only: every response is extracted and validated
 * in code; invalid output is rejected, never partially trusted.
 */
import * as vscode from 'vscode';
import { PROMPTS } from './prompts';
import type { Doc } from '../scanner/corpus';
import { log } from '../log';
import {
  extractJson,
  num,
  str,
  validateEvidence,
  SEVERITIES,
} from '../core/json';

export type { Evidence } from '../core/json';

export interface OpenQuestion {
  question: string;
  excerpt: string;
  confidence: number;
  severity: string;
}

async function pickModel(): Promise<vscode.LanguageModelChat> {
  // Models rotate; select at call time. Vendor/family are configurable so any
  // vscode.lm provider works — Copilot, or local models (e.g. Ollama/llama via
  // Copilot's "Manage models" BYOK, or a local-provider extension's vendor).
  const cfg = vscode.workspace.getConfiguration('docgrity');
  const vendor = cfg.get<string>('model.vendor', 'copilot');
  const family = cfg.get<string>('model.family', '');

  if (family) {
    const preferred = await vscode.lm.selectChatModels({ vendor, family });
    if (preferred.length > 0) return preferred[0];
  }
  const any = await vscode.lm.selectChatModels(vendor ? { vendor } : {});
  if (any.length === 0) {
    throw new Error(
      `No language model available for vendor "${vendor || 'any'}". Sign in to GitHub Copilot, ` +
        'or set docgrity.model.vendor/family to a locally provided model (e.g. Ollama).'
    );
  }
  log.debug(`Model selected: ${any[0].id} (vendor=${vendor || 'any'}, no family match)`);
  return any[0];
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
  const started = Date.now();
  const response = await model.sendRequest(messages, {}, opts.token);
  let text = '';
  for await (const chunk of response.text) text += chunk;
  try {
    const output = opts.validate(extractJson(text));
    log.trace(`LLM response validated (model=${model.id}, ${Date.now() - started}ms)`);
    return { output, model: model.id };
  } catch (err) {
    log.warn(`LLM response rejected (model=${model.id}): ${(err as Error).message}`);
    throw err;
  }
}

function pairPrompt(a: Doc, b: Doc): string {
  return `PAGE A — "${a.relPath}":\n${a.text.slice(0, 8000)}\n\n---\n\nPAGE B — "${b.relPath}":\n${b.text.slice(0, 8000)}`;
}

function validateDuplicate(o: any) {
  return {
    is_duplicate: Boolean(o.is_duplicate),
    confidence: num(o.confidence),
    summary: str(o.summary).slice(0, 2000),
    recommended_action: str(o.recommended_action || 'REVIEW'),
    evidence: validateEvidence(o.evidence),
  };
}

function validateContradiction(o: any) {
  return {
    is_contradiction: Boolean(o.is_contradiction),
    confidence: num(o.confidence),
    severity: SEVERITIES.has(o.severity) ? (o.severity as string) : 'MEDIUM',
    summary: str(o.summary).slice(0, 2000),
    conflicting_claims: (Array.isArray(o.conflicting_claims) ? o.conflicting_claims : []).map(
      (c: unknown) => str(c).slice(0, 500)
    ),
    evidence: validateEvidence(o.evidence),
  };
}

/**
 * Combined duplicate + contradiction assessment in a single LLM call — the
 * model reads the same two documents once instead of twice, halving pair
 * latency and token cost with the same rules and output contracts.
 */
export async function assessPair(a: Doc, b: Doc, token: vscode.CancellationToken) {
  const p = PROMPTS.pair;
  const { output, model } = await completeJson({
    system: p.system,
    prompt: pairPrompt(a, b),
    token,
    validate: (o) => ({
      duplicate: validateDuplicate(o.duplicate ?? {}),
      contradiction: validateContradiction(o.contradiction ?? {}),
    }),
  });
  return { output, model, promptVersion: p.version };
}

export async function assessDuplicate(a: Doc, b: Doc, token: vscode.CancellationToken) {
  const p = PROMPTS.duplicate;
  const { output, model } = await completeJson({
    system: p.system,
    prompt: pairPrompt(a, b),
    token,
    validate: validateDuplicate,
  });
  return { output, model, promptVersion: p.version };
}

export async function assessContradiction(a: Doc, b: Doc, token: vscode.CancellationToken) {
  const p = PROMPTS.contradiction;
  const { output, model } = await completeJson({
    system: p.system,
    prompt: pairPrompt(a, b),
    token,
    validate: validateContradiction,
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
