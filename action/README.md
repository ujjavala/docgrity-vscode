# Docgrity Action & CLI

**Continuous doc-integrity for your repo's markdown: contradictions, duplicates and open
questions — as a GitHub Action (with deduplicated issues) and a read-only local CLI.**

Part of the Docgrity family:

| Surface | Job | Acts? |
|---|---|---|
| [Confluence app](https://ujjavala.github.io/docgrity-site/) | wiki integrity | comments (human-approved) |
| VS Code extension | interactive repo-doc scans | raises issues (human-approved) |
| **This Action** | continuous CI enforcement | issues (opt-in, deduped, capped) + report |
| **This CLI** | local observation | **read-only** — report dashboard only |

## GitHub Action

```yaml
- uses: ujjavala/docgrity-vscode/action@main
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    provider: github-models   # free — uses GITHUB_TOKEN, no API key
    create_issues: 'true'     # opt-in; default false
    max_new_issues: 5
```

Full example with weekly schedule, PR trigger and Pages report publishing:
[examples/docgrity.yml](examples/docgrity.yml).

What it does per run:

1. Collects markdown docs (`**/*.md`, capped), selects candidate pairs locally (TF-IDF),
   assesses with the LLM using versioned prompts and typed-JSON validation, verifies
   every evidence excerpt verbatim against the source (hallucination guard).
2. Writes a **job summary** table and a **static HTML report** (`docgrity-report/`)
   with evidence, links to docs on GitHub, and *potential* owners from git history.
3. **Opt-in** (`create_issues: true`): syncs GitHub issues **deduplicated by a stable
   finding fingerprint** — new findings create issues (capped per run), unchanged ones
   are left alone, resolved ones are auto-closed with a comment. Labels: `docgrity`,
   `docgrity:<type>`.

### Providers

| provider | key | cost |
|---|---|---|
| `github-models` (default) | none — uses `GITHUB_TOKEN` with `models: read` | free |
| `gemini` / `openai` / `anthropic` | `api_key` input (use a repo secret) | your key |

## Local CLI (read-only)

```bash
npx github:ujjavala/docgrity-vscode scan --open
# or with a BYO key:
DOCGRITY_API_KEY=... npx github:ujjavala/docgrity-vscode scan --provider gemini --open
```

Runs the same scan locally and opens the **report dashboard**: findings, evidence,
doc links and potential owners. **The CLI never raises issues or takes any action** —
by design, local scans observe; only CI (explicitly opted in) acts.

## Design principles (shared across all Docgrity surfaces)

- Typed JSON outputs only; model responses validated in code.
- Every finding requires verbatim evidence, verified against the source file.
- Ownership is always *potential* (last git author), never asserted.
- Action-taking is opt-in, capped, and auditable (issue trailer records model +
  prompt version + fingerprint).
- Doc content is untrusted input — it cannot override agent instructions.
- Zero dependencies; plain Node 20+ ESM.
