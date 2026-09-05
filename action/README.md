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
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}   # for issue creation
  with:
    provider: anthropic       # or openai / gemini / ollama
    api_key: ${{ secrets.DOCGRITY_API_KEY }}
    create_issues: 'true'     # opt-in; default false
    max_new_issues: 5
```

> **Note:** GitHub Models (`provider: github-models`) is being retired by GitHub —
> runs may fail with HTTP 410 (`github_models_retirement`). Use a BYO-key provider
> (`anthropic` / `openai` / `gemini`) or `ollama` instead. Copilot models are **not**
> available here: Copilot has no API outside the editor — only the VS Code extension
> can use it.

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
| `anthropic` / `openai` / `gemini` | `api_key` input (use a repo secret) — defaults: `claude-3-5-haiku-latest`, `gpt-4o-mini`, `gemini-flash` | your key |
| `ollama` (CLI default) | none — local or tunnelled endpoint | free, fully private |
| `none` (no-agent mode) | none — zero LLM calls | free, instant, fully offline |
| `github-models` | none — uses `GITHUB_TOKEN` with `models: read` | **being retired by GitHub** (HTTP 410) — switch to a provider above |

### No-agent mode (`provider: none`)

Pure algorithms, no model, no keys, no network:

| Check | How | Notes |
|---|---|---|
| **Duplicates** | verbatim shared-block detection + TF-IDF similarity | catches copy-paste duplication; paraphrased duplication needs AI |
| **Open questions** | explicit markers (`TODO`, `TBD`, `FIXME`, `???`, "open question"…) | deterministic — high confidence; subtle unanswered questions need AI |
| **Contradictions** | ❌ **requires AI intelligence** (semantic understanding) — skipped, and the report says so | never guessed at heuristically |

Confidence is *measured*, not guessed: duplicate confidence comes from the
actual verbatim-overlap ratio; marker-based open questions score 0.85–0.95.
Tuned for precision — paraphrased text, shared code samples and boilerplate
headings never fire. Evidence is verbatim by construction. Findings carry
`method: heuristic`, and issue drafts use a deterministic template.

Great as a zero-setup PR pre-check (heuristics on every PR, full AI scan weekly)
or when no key/model is available.

## Local CLI (read-only)

```bash
npm i -g docgrity
docgrity scan --open
```

or without installing: `npx docgrity scan --open` (from a repo checkout:
`npx github:ujjavala/docgrity-vscode scan --open`).

Runs the same scan locally and opens the **report dashboard**: findings, evidence,
doc links and potential owners. **The CLI never raises issues or takes any action** —
by design, local scans observe; only CI (explicitly opted in) acts.

```
Usage: docgrity scan [options]

  --dir <path>            Directory to scan (default: .)
  --out <path>            Report output directory (default: docgrity-report)
  --open                  Open the HTML report when done

  --checks <list>         duplicates, contradictions, open-questions — any combination
  --max-files <n>         Max markdown files (default: 200)
  --max-pairs <n>         Max document pairs (default: 25)
  --threshold-duplicate / --threshold-contradiction / --threshold-open-question <0..1>

  --provider <p>          none | ollama | gemini | openai | anthropic | github-models
                          (none = no-agent mode: algorithms only, contradictions skipped)
  --model <m>             Model name
  --endpoint <url>        Ollama endpoint (default http://localhost:11434)

  --version, -v           Installed version + latest on npm
  --help, -h              Full help
```

Provider auto-detection: `DOCGRITY_API_KEY` set → `gemini`; else `GITHUB_TOKEN` →
`github-models` (retiring — pass `--provider` explicitly); else → `ollama` (local,
fully private — nothing leaves your machine).

Examples:

```bash
docgrity scan --provider none --open                      # no-agent: no model, no keys
docgrity scan --checks contradictions                     # one check only
docgrity scan --checks duplicates,open-questions --max-pairs 10
docgrity scan --provider ollama --model llama3.1:8b       # fully local
DOCGRITY_API_KEY=... docgrity scan --provider gemini --open
```

## Design principles (shared across all Docgrity surfaces)

- Typed JSON outputs only; model responses validated in code.
- Every finding requires verbatim evidence, verified against the source file.
- Ownership is always *potential* (last git author), never asserted.
- Action-taking is opt-in, capped, and auditable (issue trailer records model +
  prompt version + fingerprint).
- Doc content is untrusted input — it cannot override agent instructions.
- Zero dependencies; plain Node 20+ ESM.
