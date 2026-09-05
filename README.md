# Docgrity for VS Code

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/ujjavala.docgrity?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=ujjavala.docgrity)
[![CI](https://github.com/ujjavala/docgrity-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/ujjavala/docgrity-vscode/actions/workflows/ci.yml)

**Find where your repository's docs disagree with themselves — and raise a GitHub issue to get it fixed.**

**Install:** search “Docgrity” in the Extensions view, or `code --install-extension ujjavala.docgrity`

The repo-docs sibling of the [Docgrity Confluence app](https://ujjavala.github.io/docgrity-site/).
Scoped deliberately: **markdown files only** (`**/*.md` — READMEs, ADRs, runbooks, guides).

This repo contains all three repo-docs surfaces:

| Surface | Where | Acts? |
|---|---|---|
| **VS Code extension** (this root) | interactive scans in the editor | raises issues, human-approved one at a time |
| **GitHub Action** ([action/](action/)) | CI: schedule + PRs | opt-in deduped issues, job summary, HTML report |
| **Local CLI** ([action/bin/docgrity.js](action/bin/docgrity.js)) | your terminal | **read-only** report dashboard, no actions |

See [action/README.md](action/README.md) for Action and CLI usage
(`uses: ujjavala/docgrity-vscode/action@main`).

## What it does

1. **Scan** — `Docgrity: Scan repository docs` collects your markdown files, picks
   candidate pairs locally with TF-IDF (no network), then asks the LLM to assess:
   - **Contradictions** — conflicting factual claims across two docs
   - **Duplicates** — substantially overlapping docs that should be merged
   - **Open questions** — unresolved TBD/TODO/"who owns this?" buried in docs
2. **Review** — findings appear in the Docgrity view with evidence excerpts; each
   excerpt is a click away from the exact spot in the file, and shows as a
   diagnostic squiggle. Every finding records the model + prompt version.
3. **Act** — right-click a finding → **Raise GitHub issue**. Docgrity drafts the
   issue (title, evidence, suggested next step, *potential* owner from git history),
   shows you the draft, and only creates it after you approve. The issue is labelled
   `docgrity` and `docgrity:<type>`.

## Zero cost, zero keys

- All LLM calls go through **your own GitHub Copilot subscription** via the VS Code
  Language Model API. No API keys, no servers, no telemetry.
- Issue creation uses VS Code's built-in GitHub sign-in.
- Candidate selection is local TF-IDF — the LLM only sees the top pairs.

## Choosing your model (Copilot, Claude, GPT, local llama…)

Run **`Docgrity: Select AI model`** from the command palette — it lists every model
VS Code exposes and saves your choice. Or set it manually:

| Setting | Meaning | Default |
|---|---|---|
| `docgrity.model.vendor` | `vscode.lm` vendor id (`copilot` covers Copilot + BYOK models; empty = any) | `copilot` |
| `docgrity.model.family` | preferred model family, e.g. `gpt-4o`, `claude-sonnet-4.5`, `llama3.1` (empty = first available) | `""` |

**Options, in order of simplicity:**

1. **Copilot (default)** — sign in to GitHub Copilot; nothing to configure.
2. **Claude / GPT / Gemini via Copilot** — any model enabled in Copilot's model picker
   is available; set `docgrity.model.family` (e.g. `claude-sonnet-4.5`) or use
   *Select AI model*.
3. **Local Ollama** — install [Ollama](https://ollama.com), `ollama pull llama3.1`,
   then in Copilot Chat → **Manage models** → add the Ollama model. It registers under
   the `copilot` vendor; pick it with *Select AI model*. Fully local — no doc content
   leaves your machine.
4. **Remote Ollama over a Cloudflare Tunnel** — if your model runs on another box
   (home server, GPU rig):
   ```bash
   # on the machine running Ollama
   cloudflared tunnel --url http://localhost:11434
   ```
   Point Copilot's Manage models → Ollama endpoint at the generated
   `https://….trycloudflare.com` URL. Note: quick tunnels get a **new URL on every
   restart** — re-update the endpoint each time, or create a **named tunnel** with your
   own domain for a stable URL (`cloudflared tunnel create …`). Protect a named tunnel
   with Cloudflare Access — an open LLM endpoint is abusable.

Small local models fail Docgrity's strict-JSON validation more often than hosted
ones; failed responses are rejected safely (never mis-recorded) — expect fewer
findings rather than wrong ones. 8B+ instruct models work best.

## Design principles (shared with the Forge app)

- Typed JSON outputs only — model responses are validated in code, never trusted prose.
- Every finding requires verbatim evidence, verified against the source file
  (hallucinated quotes are dropped).
- Ownership is always *potential* (last git author), never asserted.
- Nothing is posted anywhere without explicit human approval.
- Doc content is untrusted input — it cannot override agent instructions.

## Requirements

- VS Code 1.95+, an active GitHub Copilot subscription, a workspace with a GitHub
  `origin` remote (for issue creation).

## Development

```bash
npm install
npm run compile
# F5 in VS Code to launch the Extension Development Host
```

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `docgrity.include` | `**/*.md` | Docs glob (markdown only by design) |
| `docgrity.exclude` | `**/{node_modules,…}/**` | Excluded paths |
| `docgrity.maxFiles` / `docgrity.maxPairs` | 200 / 25 | Scan caps |
| `docgrity.thresholds.*` | 0.75 / 0.7 / 0.6 | Confidence gates per finding type |
