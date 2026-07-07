# OKF Workflow

The default workflow is PR-gated. Agents prepare knowledge changes on branches; humans or CI merge after deterministic validation.

## Bundle Discovery

Resolution order:

1. Project-specific configuration, when provided by the host system.
2. `.okf.yml` at the code repository root.
3. A clear error telling the user to run `/okf init`.

Minimal pointer:

```yaml
bundle: ../example-knowledge
remote: git@github.com:example/example-knowledge.git
```

## Branches And Gates

- Keep the knowledge bundle in its own repo by default.
- Run `validate.py --strict` in CI.
- Use CODEOWNERS or repository branch protection when available.
- Generated `index.md` and `log.md` sections should be marker-delimited once regeneration scripts exist.

## Loop Timing

- `study`: before planning or implementing a feature.
- `sync`: during normal maintenance or before a knowledge PR.
- `retro`: after implementation or merge.
- `extract`: before prompt augmentation or handoff.

## Sync Pass

`/okf sync [--topic "<focus>"]` is the diff-driven maintenance loop.

1. Resolve the bundle and create a new branch in the knowledge repo.
2. Determine the code/doc change range from the latest relevant `log.md` entry, the PR base, or an explicit user-provided diff.
3. Map changes to concepts by path references, tags, concept IDs, links, and `search.py` results.
4. If `--topic "<focus>"` is present, keep only concepts matching the focus by tag or search. Concepts outside that set must remain byte-identical.
5. Update affected concepts with cited evidence.
6. Append exactly one dated `log.md` entry for the sync pass.
7. Run `reindex.py` so marker-delimited `index.md` sections reflect the updated concepts.
8. Run `validate.py --strict`.
9. Open a knowledge PR with `gh pr create`.

Sync never pushes directly to the default branch. A failed validation run blocks the PR until the bundle is fixed.

## Embeddings

Embeddings are derived from Markdown, but shareable shards are committed when their profile says `share: true`.

- Manifest: `okf-embeddings.yaml`.
- Shards: `embeddings/<profile>.okfe.jsonl`.
- Local cache: `.okf-index/`, never committed.
- Default profile: `ollama` with `nomic-embed-text`.
