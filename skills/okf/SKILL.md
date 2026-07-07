---
name: okf
description: Maintain a project knowledge wiki in Open Knowledge Format with /okf init, author, convert, sync, study, retro, extract, validate, lint, and embed.
triggers:
  - /okf
  - okf
  - Open Knowledge Format
  - knowledge wiki
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# OKF Knowledge Wiki

Use this skill when the user asks to create, maintain, validate, search, or update a project knowledge bundle in Open Knowledge Format (OKF).

The bundle is the source of truth. Keep changes small, cited, and PR-gated. Deterministic scripts validate conformance; LLM passes may suggest or draft knowledge, but they never replace the gate.

## Command Table

| Command | Purpose | Primary references |
| --- | --- | --- |
| `/okf init` | Create or connect a project knowledge bundle. | `references/workflow.md`, `references/spec.md` |
| `/okf author "<topic>"` | Write or refresh one focused concept. | `templates/concept.md`, `references/taxonomy.md` |
| `/okf convert <path>` | Convert existing docs into OKF concepts without deleting originals. | `references/conversion.md` |
| `/okf sync [--topic "<focus>"]` | Update concepts from code or documentation changes. | `references/workflow.md` |
| `/okf study "<focus>"` | Pre-feature pass that documents current behavior for a topic. | `references/workflow.md`, `references/taxonomy.md` |
| `/okf retro` | Post-implementation pass that captures what would have helped. | `references/workflow.md` |
| `/okf extract "<query>" [--budget <tokens>]` | Return ranked, token-budgeted, cited concepts for prompt use. | `references/spec.md` |
| `/okf validate [--strict]` | Run the deterministic conformance gate. | `references/conformance.md` |
| `/okf lint` | Run advisory semantic patrol for stale or weak knowledge. | `references/conformance.md` |
| `/okf embed [--profile <name>]` | Update shareable embedding shards and rebuild the local index. | `references/workflow.md` |

## Guardrails

- Resolve the bundle first. Prefer `.okf.yml` in the code repository; if absent, ask the user to run `/okf init`.
- Keep the skill portable: require only git, gh, Python 3, PyYAML, and optional embedding providers. Do not require Overdeck.
- Never import or call Overdeck code from scripts under this skill. Documentation may describe Overdeck integration, but the portable core has no Overdeck dependency.
- Treat `index.md` and `log.md` as reserved files, not concepts.
- Preserve unknown frontmatter keys when editing concepts.
- Use deterministic validation for pass/fail decisions. `/okf lint` is advisory only.
- Never put vectors in Markdown frontmatter. The only embedding frontmatter key is optional `x_embed: exclude`.

## Reading Rules

When answering from a bundle or preparing prompt context:

1. read `index.md` first.
2. load only relevant concepts.
3. answer only from loaded concepts.
4. cite concept IDs for every project-specific claim.
5. never invent missing knowledge. If the bundle does not contain the answer, say what is missing and suggest `/okf study "<focus>"` or `/okf author "<topic>"`.

## Model Selection

For `/okf study`, `/okf retro`, `/okf sync`, and `/okf author`, honor `--model <model>` using this ladder:

1. Use the current harness natively when it can serve the requested model.
2. Use a vendor CLI already on `PATH`, such as `codex exec -m <model> ...` or `gemini -p ... -m <model>`, after checking auth.
3. Use an installed bridge plugin command when available.
4. Use an available MCP bridge tool when available.
5. If none can serve the model, stop with a hard error that names the requested model, the bridge that would serve it, the install command, and the auth step. Never silently substitute another model.

## `/okf init`

Create a knowledge bundle and pointer file.

- Default target: a peer repo named `<project>-knowledge`.
- Overrides: `--dir <path>` for any external directory, or `--local <subdir>` for an in-repo bundle.
- Seed `index.md`, `log.md`, starter concepts, CI conformance workflow, and the default embedding manifest.
- Add one discovery line to local agent instructions so future agents can find the bundle.

## `/okf author "<topic>"`

Write or update one concept for one idea.

- Infer a concept type from `references/taxonomy.md`, then confirm when user input is ambiguous.
- Use `templates/concept.md`.
- Add relative or bundle-root links only when they point to real concepts or clearly planned knowledge.
- Regenerate indexes and logs, then validate.

## `/okf convert <path>`

Convert existing docs into OKF without destructive edits.

- Start with a dry-run conversion plan.
- Add frontmatter before renaming files.
- Never delete a README or source document.
- Preserve citations and convert wiki-style links where possible.

## `/okf sync [--topic "<focus>"]`

Update the bundle from code or documentation diffs.

- Derive the change range from the last `log.md` entry, PR base, or user-specified diff.
- Use `--topic` to restrict by tags, concept IDs, and search results.
- Update affected concepts, append dated log entries, regenerate indexes, and validate.

## `/okf study "<focus>"`

Document what the current codebase does before a feature starts.

- Search the codebase for the focus.
- Create or refresh concepts that describe current behavior, invariants, and important decisions.
- Cite files, tests, docs, or commands used as evidence.
- Open or prepare a knowledge-repo PR rather than mutating protected branches directly.

## `/okf retro`

Capture knowledge after implementation.

- Review the diff and available session context.
- Ask: what would have made this work easier if documented before the session?
- File those answers as focused concepts with citations.
- With Overdeck present, observations may be used as input; without Overdeck, use the diff and transcript context.

## `/okf extract "<query>" [--budget <tokens>]`

Return compact prompt context.

- Rank by hybrid BM25 + vector search when indexes and shards exist.
- Fall back to BM25-only, then index-guided reading.
- Respect the token budget.
- Include concept IDs and citations in the output.

## `/okf validate [--strict]`

Run deterministic checks.

- Exit 0 when the bundle is conformant.
- Exit 1 for lint-only findings when not strict.
- Exit 2 for conformance errors.
- See `references/conformance.md` for the code vocabulary.

## `/okf lint`

Run advisory semantic patrol.

- Look for contradictions, stale concepts, orphaned links, missing citations, and oversized concepts.
- Report suggestions; do not block merges or CI solely on LLM judgment.

## `/okf embed [--profile <name>]`

Refresh embeddings.

- Read `okf-embeddings.yaml` from the bundle root.
- Re-embed only concepts whose normalized content hash changed.
- Write sorted JSONL shards under `embeddings/`.
- Rebuild the local `.okf-index/` cache, which is derived and gitignored.
