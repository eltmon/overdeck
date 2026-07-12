# Docs RAG Operations

Docs RAG is Overdeck's prompt-time documentation retriever. It builds a local
SQLite index from Overdeck documentation, queries that index for relevant
snippets, and injects a bounded `<overdeck-docs>` block into prompt hook context
when a user prompt mentions Overdeck concepts.

## Corpus Sources

The default corpus is configured under `docs.corpus` in `config.yaml`.

- `docs/**/*.md` from the Overdeck checkout, excluding PRDs by default.
- Skill files from `skills/*/SKILL.md` and distributed skill sources.
- Bundled rules from `sync-sources/rules/*.md`.
- Project-level `CLAUDE.md`.
- PRDs from `docs/prds/{active,planned}` only when PRD indexing is enabled.

Corpus files are split by markdown headings and capped by
`docs.corpus.maxChunkTokens`.

## Index Paths

There are two docs index paths:

- Dist artifact: `DEFAULT_DOCS_INDEX_PATH`, currently
  `<packageRoot>/dist/docs-index.sqlite`. `scripts/build-docs-index.mjs` writes
  this artifact during the build path.
- Live index: `getDocsIndexPath()`, currently
  `~/.overdeck/docs/index.sqlite`. Runtime query and prompt injection read this
  path.

`scripts/build-docs-index.mjs` builds the dist artifact and then copies it to
the live index path. `pan docs reindex` builds in-process directly to the live
index path.

## Build And Refresh

`npm run build` runs the post-CLI build hook that invokes
`scripts/build-docs-index.mjs`, unless docs index generation is skipped. The
script requires the built library at `dist/index.js`, builds the dist artifact,
and materializes the live index path.

Run `pan docs reindex` to refresh the live index manually from the current
checkout. This path does not spawn the build script; it calls the docs index
builder directly and writes `~/.overdeck/docs/index.sqlite`.

Set `SKIP_DOCS_INDEX=1` to skip index generation in build environments that
must not spend time or network on embedding/index work, such as CI, release, or
workspace builds covered by PAN-1659 and PAN-1678 constraints.

## Consumption

The CLI query path is:

```bash
pan docs query "how does pan start work?"
```

By default it reads the live index path. If the live index is missing, the CLI
prints a stderr hint telling the operator to run `pan docs reindex` while
preserving the empty stdout result contract.

The hook injection flow is:

1. Claude Code `UserPromptSubmit` calls `POST /api/memory/inject`.
2. The route computes the existing fast advisory context.
3. `buildDocsInjectionContext` evaluates the docs gate, queries the live index,
   records budget and telemetry on a hit, and formats a `<overdeck-docs>` block.
4. The route appends that block to the returned `context`.
5. The hook prints the returned context to stdout for the harness to inject.

Docs injection is intentionally only in the fast route path. The fire-and-forget
memory path does not call docs RAG, which prevents double budget consumption and
duplicate telemetry.

## Configuration

Docs settings live under `docs.*` in `config.yaml`; defaults are in
`src/lib/config-yaml/defaults.ts`.

- `docs.enabled` turns the docs system on or off.
- `docs.promptInjectionEnabled` controls prompt-time injection.
- `docs.cliEnabled` controls CLI availability.
- `docs.trigger.regexes` and `docs.trigger.caseSensitive` decide which prompts
  are eligible for injection.
- `docs.corpus.*` selects source families and chunk size.
- `docs.budget.injectionRate`, `turnWindow`, `maxTokensPerInjection`, and
  `maxChunksPerInjection` bound prompt-time injection.
- `docs.embedding.provider`, `model`, and `dimensions` control index embeddings.
- `docs.classifier.*` is reserved for classifier-backed gating.

## Enable And Disable Scopes

Use the CLI controls to disable or re-enable docs injection:

```bash
pan docs disable --scope session --reason "too noisy"
pan docs enable --scope session
pan docs disable --scope project
pan docs disable --scope global
```

Scope precedence is session, then project, then global. Disable state is stored
under `~/.overdeck/docs/disable-state.json`.

## Telemetry

Prompt-safe telemetry is appended to `~/.overdeck/docs/telemetry.jsonl`.
Telemetry records counts and gate metadata, but not the full user prompt.
Budget state lives at `~/.overdeck/docs/budget-state.json`.

## Troubleshooting

If `pan docs query` returns an empty result and prints a missing-index hint, run:

```bash
pan docs reindex
```

If prompt injection is unexpectedly absent, check in order:

1. The live index exists at `~/.overdeck/docs/index.sqlite`.
2. `docs.enabled` and `docs.promptInjectionEnabled` are true.
3. The prompt matches `docs.trigger.regexes`.
4. The session, project, or global scope is not disabled.
5. The budget window has not been exhausted.
