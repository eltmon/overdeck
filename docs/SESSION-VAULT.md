# Session Vault

Session Vault gives agent conversations versioned, encrypted, off-machine storage and
lets another machine continue them. It ships as the `pan vault` command group
([PAN-2609](https://github.com/eltmon/overdeck/issues/2609)); the PRD is
`.pan/drafts/pan-2609.md`. Everything here also works standalone: `npm install -g
@overdeck/core` with no `pan install`, no dashboard, no Herdr and no registered
projects (NFR-7). `pan vault` sends no telemetry (P-12).

## Model

| Term | Meaning |
| --- | --- |
| **Vault** | One user's encrypted store of conversations, keyed by one 32-byte vault key. Lives in a git remote the user owns (`pan vault setup <git-url>`); a `dir:<path>` backend exists for tests and NAS mounts. |
| **Backend** | An immutable object store plus compare-and-swap refs (`src/lib/vault/store/types.ts`). Layout on both backends: `VAULT-FORMAT` marker, `objects/<id[0:2]>/<id>`, `refs/<name>`. Ref names are keyed HMACs, so the backend cannot link records to conversations. |
| **Record** | One saved conversation: an encrypted ref value (`r/<hmac>`) holding owner, harness, title, cwd, the LOG, the VIEW pointer, segments, settlements and lineage (`SessionRecord` in `src/lib/vault/format.ts`). |
| **Chunk** | The lines one settlement added, stored as `{ v, codec: "zstd", lineHashes, lines }`, compressed and sealed with AES-256-GCM. The chunk id is `HMAC-SHA256(K_id, plaintext)[:40]` and is the associated data, so a chunk cannot be swapped under another id. |
| **LOG** | The ordered chunk ids of a record: every native line ever saved, byte for byte. |
| **VIEW** | Where a resumed session starts: the LOG position of the last compaction boundary (Claude Code `isCompactSummary`, Codex `{"type":"compacted"}`), running to the end. |
| **Settlement** | One save of a transcript: continuity check, secret scan, chunk upload, record update, CAS. Version *n* is the state after settlement *n*. |
| **Owner** | The machine whose native file the record follows. Only the owner appends; another machine takes over by **adoption**. |
| **Adoption** | `pan vault resume` on another machine: a CAS that adds a segment for the new machine, then materializes the VIEW into a fresh native session file. Two machines racing get exactly one owner; the loser sees `Already continued on <label>`. |
| **Segment** | One owner period in a record: `{ environmentId, nativeSessionId, logStart, prefix, tail }`. The prefix describes the lines an adopter materialized; the tail is the last 16 line hashes of the native file as settled. |
| **Machine identity** | `${OVERDECK_HOME}/environment-id.json`, shared with PAN-3762: `{ v, environmentId, label, createdAt }`, created once, never re-minted. |

## Encryption and the key

- The vault key `K` is 32 random bytes at `${OVERDECK_HOME}/vault/key` (mode 0600).
- The recovery phrase is the BIP-39 encoding of `K` (24 words = 256 bits + 8-bit checksum),
  not a seed derivation. `pan vault join` proves the phrase by decrypting the header ref.
- Sub-keys via HKDF-SHA256: `K_enc` (AES-256-GCM), `K_id` (chunk ids), `K_ref` (ref names).
- Every object and ref value is encrypted before it reaches the backend; a private GitHub repo
  holding plaintext transcripts would be one leaked token away from every secret an agent
  ever printed (D-3).

**Key loss.** Anyone with the 24 words can read the vault. Losing every device and the
recovery phrase loses the vault: there is no server-side recovery, by design.

## Commands

```bash
pan vault setup <git-url> [--hooks]        # enable; prints the recovery phrase ONCE
pan vault join <git-url> [--phrase-file p]  # second machine
pan vault status [--json]
pan vault save <id|path> | --all [--since <date>] [--harness <h>]
pan vault save --hook                       # Claude Code Stop hook: stdin JSON, silent, exit 0
pan vault sync
pan vault list [--json]                     # local cache only
pan vault show <id> [--json]                # turns, assistant text, versions
pan vault resume <id>[@<version>] [--cwd <dir>] [--no-launch] [--on-drift continue|note|cancel]
pan vault exclude [path] [--origin <url>] [--session <id>]
pan vault include [path] [--origin <url>] [--session <id>]
pan vault allow-secret <id|path> <line>
pan vault evict [--review] [--confirm <fingerprint>] [--decline <vaultId>] [--reoffer <vaultId>] [--clear]
pan vault restore <id> [--to <path>]
```

With no backend configured, every verb except `setup` and `join` prints
`Session Vault is off. Run: pan vault setup <git-url>` and exits 0.

### Save and sync

`save` settles the named transcript (session id, id prefix or path) or, with `--all`, every
transcript the harness discovery roots find (`~/.claude/projects`, `~/.codex/sessions`, …),
optionally filtered by `--since` and `--harness`. Each settlement prints one verdict:

| Verdict | Meaning |
| --- | --- |
| `appended N lines` | New lines were saved; the version number follows. |
| `noop` | Nothing new since the last settlement. |
| `blocked at line N: <pattern>` | The secret scan hit; nothing was written. Allow the line or exclude the session. |
| `diverged` | A saved line changed or the file shrank; nothing was written. |
| `excluded` | The session matches an exclusion. |
| `offline` | The backend is unreachable; the local index did not advance. |

`sync` settles every owned transcript that grew, registers this machine, pulls every record
ref and refreshes the list cache. `pan vault setup --hooks` registers one Claude Code `Stop`
hook that runs `pan vault save --hook` after every turn.

### Resume, versions and drift

`resume <id>` compares the target directory's git state (origin, HEAD, branch, dirty
counts) with the state saved at the last settlement. On a difference it asks on a TTY:
continue, continue with a note injected as the first message, or cancel. `--on-drift`
answers non-interactively; a non-TTY run without it cancels and writes nothing.
`resume <id>@<n>` first forks a new record whose history is the parent's through version
*n* (the parent is never written), then materializes that.

Claude Code and Codex resume natively: the VIEW is written as a new session file with only
the `sessionId` (and, when the cwd changed, `cwd`) values rewritten, and `claude --resume
<id>` or `codex resume <id>` is launched in the target directory (`--no-launch` prints the
command). Codex indexes the rollout from its sessions directory itself; the vault never
writes a Codex SQLite file (checkpoint outcome 2026-09-28: `opened`). Other harnesses get a
markdown seed digest at `<cwd>/.overdeck-vault-seed-<vaultId>.md`.

### Exclusions and secrets

A conversation is excluded when its cwd is under an `exclude.paths` entry (whole path
segments, so `/a/b` does not cover `/a/bc`), its git origin is in `exclude.origins`, or its
session id or vaultId is in `exclude.sessions`. Excluding a saved session replaces its record
with a tombstone `{ v, type: "session", vaultId, tombstone: true }`; chunk objects stay in the
backend's history as ciphertext.

The secret scan uses the blocking subset of `src/lib/secret-redaction.ts`: API keys, GitHub
and Slack tokens, AWS access keys, JWTs, database URLs, basic-auth URLs and PEM private keys.
`FOO=bar` and `token: x` shapes stay redaction-only because they appear in ordinary shell
output. `pan vault allow-secret <id|path> <line>` stores the line's hash in
`${OVERDECK_HOME}/vault/allowed-secrets.json` so that line never blocks again.

### Eviction (opt-in, confirmation required)

Nothing deletes a transcript automatically (NFR-10, decision D-7). With `vault.evict`
set to `true` in `${OVERDECK_HOME}/vault/config.json`, each sync adds eligible transcripts to
a pending-deletion batch (`${OVERDECK_HOME}/vault/eviction-batch.json`). Eligible means: every
settleable line is in the vault, the covering chunk reads back from the backend and its line
hashes match the file, and the file has been quiet for `liveQuietMinutes` (default 30).

1. `pan vault evict --review` (the default) prints each path, harness, title, size and
   verification status, the total, and a **fingerprint**. It deletes nothing.
2. `pan vault evict --confirm <fingerprint>` re-runs the checks on every entry immediately
   before deleting it through `src/lib/cloister/transcript-deletion-door.ts`. If the batch
   changed since the review, it deletes nothing and prints the new fingerprint. Entries whose
   file grew or moved are kept with a reason.
3. `--decline <vaultId>` keeps a transcript out of future batches until `--reoffer`;
   `--clear` empties the batch without deleting or declining anything.
4. `pan vault restore <id>` rebuilds an evicted transcript byte for byte at its original
   path (or `--to <path>`); it refuses to overwrite an existing file.

## Configuration

`${OVERDECK_HOME}/vault/config.json` (mode 0600):

| Key | Default | Meaning |
| --- | --- | --- |
| `backend` | absent | Git remote URL (or `dir:<path>`). Absent means the vault is off. |
| `exclude` | `{ paths: [], origins: [], sessions: [] }` | Exclusions. |
| `syncIntervalSec` | 300 | Sync loop interval (Overdeck mode). |
| `debounceSec` | 30 | Settle this long after the last transcript growth (Overdeck mode). |
| `evict` | `false` | Maintain the pending-deletion batch. |
| `liveQuietMinutes` | 30 | A transcript modified more recently is live and never eligible. |
| `maxChunkBytes` | 67108864 | Split larger appends into several chunks. |

`~/.overdeck/config.yaml` is not involved: the standalone CLI must not load the settings schema.

## Files

| Path | Contents |
| --- | --- |
| `${OVERDECK_HOME}/vault/key` | Vault key, 32 raw bytes, 0600. |
| `${OVERDECK_HOME}/vault/config.json` | Configuration above. |
| `${OVERDECK_HOME}/vault/git/` | Local clone of the git backend (branch `main`). |
| `${OVERDECK_HOME}/vault/index.json` | Machine-local index: owned native paths with their tails, and the list cache. Never uploaded. |
| `${OVERDECK_HOME}/vault/allowed-secrets.json` | Allowed line hashes per record. |
| `${OVERDECK_HOME}/vault/eviction-batch.json` | Pending-deletion batch and declines. |
| `${OVERDECK_HOME}/environment-id.json` | Machine identity shared with PAN-3762. |

## Troubleshooting

- **`offline`** — the backend could not be reached. The git clone was reset to `origin/main`
  and no local commit outlived the failed push; pending objects are rewritten on the next
  attempt. Run `pan vault sync` later.
- **`diverged`** — a saved line changed or the file shrank. The vault never overwrites saved
  history. Compare `pan vault show <id>` with the native file; excluding the session and
  saving again starts a new record.
- **`blocked at line N: <pattern>`** — a secret was found in a new line. Rotate the secret if
  it is real, then `pan vault allow-secret <id|path> N`, or exclude the session.
- **`Already continued on <label>`** — another machine adopted the record first. Run
  `pan vault sync` and resume again to take it over from there.
- **`The recovery phrase does not match this vault.`** — the words decode but do not
  decrypt the header. Nothing was written; check the phrase and try again.

## Module map

```
src/lib/environment-identity.ts   machine identity (shared with PAN-3762)
src/lib/vault/config.ts           vault/config.json, isVaultEnabled
src/lib/vault/identity.ts         key, recovery phrase, HKDF sub-keys
src/lib/vault/format.ts           chunk and record wire format, ref names
src/lib/vault/continuity.ts       line hashes, noop/append/diverged
src/lib/vault/turns.ts            human-turn filter (FR-18)
src/lib/vault/secrets.ts          pre-settlement secret scan and allow list
src/lib/vault/cwd-state.ts        bounded git summary and drift comparison
src/lib/vault/store/{types,dir,git}.ts   VaultStore contract and backends
src/lib/vault/local-index.ts      owned tails and list cache
src/lib/vault/exclude.ts          exclusions
src/lib/vault/settle.ts           one settlement
src/lib/vault/sync.ts             sync cycle and backoff loop
src/lib/vault/materialize.ts      VIEW -> native file (Claude Code, Codex), restore
src/lib/vault/adopt.ts            adoption by CAS, version forks
src/lib/vault/seed.ts             seeded digest for harnesses without native resume
src/lib/vault/evict.ts            pending-deletion batch and confirmation
src/cli/commands/vault/*.ts       the pan vault verbs
```

`tests/unit/lib/vault/import-graph.test.ts` fails the build if anything reachable from
these modules imports the dashboard, the terminal backends, `src/lib/overdeck/*`, Effect or
node-pty (P-14). `tests/unit/lib/vault/two-machine.e2e.test.ts` runs the whole flow across
two temp homes and scans every object in the bare repository for plaintext.
