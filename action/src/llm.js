/**
 * LLM providers — typed JSON only, validated in code.
 * Default: GitHub Models (free, uses GITHUB_TOKEN — zero keys in CI).
 * BYO: gemini / openai / anthropic via api key.
 */

const num = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(v) || 0));
const str = (v) => (typeof v === 'string' ? v : String(v ?? ''));
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export function makeClient({ provider, apiKey, githubToken, model }) {
  const p = provider || 'github-models';
  if (p === 'github-models') {
    if (!githubToken) throw new Error('github-models provider requires GITHUB_TOKEN (or GH_TOKEN)');
    return openaiCompatible({
      url: 'https://models.github.ai/inference/chat/completions',
      key: githubToken,
      model: model || 'openai/gpt-4o-mini',
    });
  }
  if (p === 'openai') {
    return openaiCompatible({
      url: 'https://api.openai.com/v1/chat/completions',
      key: requireKey(apiKey, p),
      model: model || 'gpt-4o-mini',
    });
  }
  if (p === 'gemini') return gemini(requireKey(apiKey, p), model || 'gemini-3.6-flash');
  if (p === 'anthropic') return anthropic(requireKey(apiKey, p), model || 'claude-3-5-haiku-latest');
  throw new Error(`Unknown provider: ${p}`);
}

function requireKey(key, provider) {
  if (!key) throw new Error(`Provider ${provider} requires an API key`);
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retry on 429/5xx (transient rate limits and overload). */
async function llmFetch(url, init, retries = 4) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    // Rate limits are usually per-minute windows — wait longer for 429s.
    const base = res.status === 429 ? 15000 * (attempt + 1) : 2000 * 2 ** attempt;
    await sleep(Math.max(retryAfter * 1000, base));
  }
}

function openaiCompatible({ url, key, model }) {
  return {
    model,
    async complete(system, prompt) {
      const res = await llmFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
        }),
      });
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}

function gemini(key, model) {
  return {
    model,
    async complete(system, prompt) {
      const res = await llmFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0 },
          }),
        }
      );
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    },
  };
}

function anthropic(key, model) {
  return {
    model,
    async complete(system, prompt) {
      const res = await llmFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      return (data.content ?? []).map((b) => b.text ?? '').join('');
    },
  };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

async function completeJson(client, system, prompt, validate) {
  const text = await client.complete(system, prompt);
  return { output: validate(extractJson(text)), model: client.model };
}

const validateEvidence = (list) =>
  (Array.isArray(list) ? list : [])
    .map((e) => ({ page: e?.page === 'B' ? 'B' : 'A', excerpt: str(e?.excerpt).slice(0, 1000) }))
    .filter((e) => e.excerpt);

import { PROMPTS } from './prompts.js';

const pairPrompt = (a, b) =>
  `PAGE A — "${a.relPath}":\n${a.text.slice(0, 8000)}\n\n---\n\nPAGE B — "${b.relPath}":\n${b.text.slice(0, 8000)}`;

export async function assessDuplicate(client, a, b) {
  const p = PROMPTS.duplicate;
  const r = await completeJson(client, p.system, pairPrompt(a, b), (o) => ({
    is_duplicate: Boolean(o.is_duplicate),
    confidence: num(o.confidence),
    summary: str(o.summary).slice(0, 2000),
    recommended_action: str(o.recommended_action || 'REVIEW'),
    evidence: validateEvidence(o.evidence),
  }));
  return { ...r, promptVersion: p.version };
}

export async function assessContradiction(client, a, b) {
  const p = PROMPTS.contradiction;
  const r = await completeJson(client, p.system, pairPrompt(a, b), (o) => ({
    is_contradiction: Boolean(o.is_contradiction),
    confidence: num(o.confidence),
    severity: SEVERITIES.has(o.severity) ? o.severity : 'MEDIUM',
    summary: str(o.summary).slice(0, 2000),
    conflicting_claims: (Array.isArray(o.conflicting_claims) ? o.conflicting_claims : []).map((c) =>
      str(c).slice(0, 500)
    ),
    evidence: validateEvidence(o.evidence),
  }));
  return { ...r, promptVersion: p.version };
}

export async function assessOpenQuestions(client, doc) {
  const p = PROMPTS.open_question;
  const r = await completeJson(
    client,
    p.system,
    `Document path: ${doc.relPath}\n\nDocument content:\n${doc.text.slice(0, 12000)}`,
    (o) => ({
      questions: (Array.isArray(o.questions) ? o.questions : [])
        .map((q) => ({
          question: str(q.question).slice(0, 500),
          excerpt: str(q.excerpt).slice(0, 1000),
          confidence: num(q.confidence),
          severity: SEVERITIES.has(q.severity) ? q.severity : 'MEDIUM',
        }))
        .filter((q) => q.question && q.excerpt),
    })
  );
  return { ...r, promptVersion: p.version };
}

export async function draftIssue(client, finding) {
  const p = PROMPTS.issue;
  const r = await completeJson(
    client,
    p.system,
    `Finding type: ${finding.type}\nSummary: ${finding.summary}\nEvidence:\n${finding.evidence
      .map((e) => `- [${e.sourceLabel}] "${e.excerpt}"`)
      .join('\n')}\nPotential owners: ${finding.potentialOwners.join(', ') || 'unknown'}`,
    (o) => ({
      title: str(o.title).slice(0, 200) || 'Docgrity finding',
      body: str(o.body).slice(0, 20000),
    })
  );
  return r.output;
}
