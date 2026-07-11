# okf-embeddings v0.1

`okf-embeddings` is a portable extension for sharing embedding metadata and vector shards with an OKF bundle. Markdown remains the source of truth. Vectors are derived data, but committed shards avoid repeated compute and API spend.

## Artifacts

| Artifact | Location | Committed | Purpose |
| --- | --- | --- | --- |
| Manifest | `okf-embeddings.yaml` | yes | Defines profiles, chunking, hashing, and shard location. |
| Vector shard | `embeddings/<profile>.okfe.jsonl` | yes when `share: true` | Shares reusable vectors keyed by concept hash. |
| Local index | `.okf-index/` | no | Rebuildable SQLite cache for FTS5 and vector search. |

## Manifest Schema

```yaml
okf_embeddings_version: "0.1"
default_profile: local

profiles:
  local:
    provider: ollama
    model: nomic-embed-text
    dim: 768
    endpoint: http://localhost:11434
    share: true
  # cloud:
  #   provider: openai
  #   model: text-embedding-3-small
  #   dim: 1536
  #   share: false

chunking:
  strategy: concept
  max_tokens: 512

hash: sha256
vectors_dir: embeddings
```

Required top-level keys:

- `okf_embeddings_version`: extension version. v0.1 uses whole-concept chunks.
- `default_profile`: profile name used when no profile flag is provided.
- `profiles`: map of profile names to provider config.
- `chunking.strategy`: `concept` in v0.1.
- `chunking.max_tokens`: maximum concept text sent to the embedding provider.
- `hash`: `sha256`.
- `vectors_dir`: shard directory, usually `embeddings`.

Profile keys:

- `provider`: `ollama`, `openai`, `voyage`, or `custom`.
- `model`: provider model name.
- `dim`: vector dimension.
- `endpoint`: required for Ollama and custom OpenAI-compatible providers.
- `share`: whether to commit this profile's shard.

## Shard Line Format

Each shard is JSONL. One line represents one chunk:

```json
{"id":"tables/orders#0","concept":"tables/orders","hash":"sha256:9f2c...","dim":768,"v":[0.0123,-0.0456]}
```

Fields:

- `id`: stable chunk ID, `<concept>#<chunk-index>`.
- `concept`: concept ID without `.md`.
- `hash`: normalized content hash for staleness checks.
- `dim`: vector dimension.
- `v`: L2-normalized vector values.

## Sorting And Normalization Rules

- Lines are sorted by `id` for stable diffs.
- Vectors are L2-normalized.
- Vector values are written with 6-decimal precision.
- Readers must ignore hash-mismatched lines.
- Writers replace stale lines in place and preserve unchanged lines byte-for-byte where possible.
- The normalized content hash is SHA-256 over frontmatter minus `timestamp`, plus body, with LF line endings and trailing whitespace stripped.

## Frontmatter Footprint

Do not store vectors in frontmatter. The only embedding-related concept frontmatter key is:

```yaml
x_embed: exclude
```

Consumers should preserve this unknown extension key under OKF's extension rule.

## Retrieval

The preferred search order is:

1. Hybrid BM25 + vector search with reciprocal rank fusion.
2. BM25-only search.
3. Index-guided reading from `index.md`.

The local `.okf-index/` cache may use SQLite FTS5, sqlite-vec, or a BLOB cosine fallback. It is derived and should not be committed.

## Succession

`okf_embeddings_version` controls compatibility. v0.1 reserves section-level chunking for a future minor version. If the OKF ecosystem standardizes embedding metadata later, bundles should migrate by adding the new standard metadata and retaining or transforming v0.1 shards until consumers no longer need them.
