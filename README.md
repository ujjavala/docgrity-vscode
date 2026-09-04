# Docgrity for VS Code

**Find where your repository's docs disagree with themselves — and raise a GitHub issue to get it fixed.**

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
