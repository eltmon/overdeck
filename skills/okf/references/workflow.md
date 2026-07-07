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

## Embeddings

Embeddings are derived from Markdown, but shareable shards are committed when their profile says `share: true`.

- Manifest: `okf-embeddings.yaml`.
- Shards: `embeddings/<profile>.okfe.jsonl`.
- Local cache: `.okf-index/`, never committed.
- Default profile: `ollama` with `nomic-embed-text`.
