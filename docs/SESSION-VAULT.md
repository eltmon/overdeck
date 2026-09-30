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
| **Backend** | An immutable object store plus compare-and-swap refs (`src/lib/vault/store/types.ts`). Layout on both backends: `VAULT-FORMAT` marker, `objects/<id[0:2]>/<id>`, `refs/<name>`. Ref names are keyed HMACs, so the backend cannot link records to conversations. One object name is reserved rather than content-addressed: `objects/keywrap/v1`, the scrypt-wrapped vault key for the optional passphrase, written and deleted only through `putSlot`, which publishes immediately (PAN-4328). `putObjects` rejects it. `casRefs(ops)` is an all-or-nothing CAS over several distinct refs (an op without a value only asserts a version), and `casRef` is its single-op form; `discardUnpublished()` drops objects no ref write has published (PAN-4333). A hosted store (PAN-4297) must pass the shared contract suite (`tests/unit/lib/vault/store/contract.ts`), which covers both. |
| **Record** | One saved conversation: an encrypted ref value (`r/<hmac>`) holding owner, harness, title, cwd, the LOG, the VIEW pointer, segments, settlements and lineage (`SessionRecord` in `src/lib/vault/format.ts`). |
| **Chunk** | The lines one settlement added, stored as `{ v, codec: "zstd", lineHashes, lines }`, compressed and sealed with AES-256-GCM. The chunk id is `HMAC-SHA256(K_id, plaintext)[:40]` and is the associated data, so a chunk cannot be swapped under another id. |
| **LOG** | The ordered chunk ids of a record: every native line ever saved, byte for byte. |
| **VIEW** | Where a resumed session starts: the LOG position of the last compaction boundary (Claude Code `isCompactSummary`, Codex `{"type":"compacted"}`), running to the end. |
| **Settlement** | One save of a transcript: continuity check, secret scan, chunk upload, record update, CAS. Version *n* is the state after settlement *n*. Each entry may carry a `wip` field: an encrypted snapshot of the owner's uncommitted code, or why one was skipped (see [Carrying your code](#carrying-your-code)). |
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

### Key rotation and the key ring

A lost or revoked machine still holds `K`. `pan vault rotate-key`
([PAN-4333](https://github.com/eltmon/overdeck/issues/4333)) replaces `K` with a new key
`K'` so that machine can read nothing written afterwards. It can still read everything
written before: it already holds that key.

**What is re-encrypted.** Ref names are HMACs under `K_ref`, so a new key means new names.
Rotation re-seals every record ref, every machine ref and the header under `K'`. Chunks,
settlement-archive chunks and WIP parts are not re-encrypted; they keep their ids and the
key they were sealed under.

**Header fields.** The header value gains two optional fields
(`VaultHeader` in `src/lib/vault/format.ts`):

| Field | Value |
| --- | --- |
| `rotatedAt` | ISO time of the last rotation. Absent before the first one. |
| `keyRing` | The retired keys, base64 of 32 raw bytes each, newest first. Sealed under the current key like the rest of the header. |

A machine that holds the current key reads the ring from the header; a machine that holds
only a retired key cannot. `parseKeyRing` rejects any entry that is not the canonical
base64 of exactly 32 bytes.

**Ring fallback.** `openKeyring` (`src/lib/vault/keyring.ts`) loads the ring into
`VaultSubkeys.previous`. Only `decodeChunk` and `decodeWipParts` fall back through it: they
try the current sub-keys, then each retired key, and check the content id with the `K_id` of
the key that decrypted. Ref reads (`decryptRef`, `readVaultHeader`) and every encode function
use the current key only.

**Retired-ref marker.** Each old `r/` and `m/` name is overwritten with
`{ v: 1, type: "retired", at }` sealed under the retired key (`RetiredRefMarker`), not
deleted. Sync and status skip refs the current key cannot open and count them: `retired`
when a ring key opens the value, `unreadable` when no key does. A junk ref therefore never
stops a sync.

**One batch.** New-name refs, markers and the new header are written in one
`VaultStore.casRefs` call. On git that is one commit (`vault: batch`) and one push, so no
reader sees a half-rotated vault. A conflict (another machine settled in between) re-reads
every ref and retries, up to 5 times, with no delay. The dir backend cannot publish a batch
atomically; it writes the ops in the order given. The batch is therefore ordered new-name
refs, then markers, then the header. If the process dies part-way, the header is still
sealed under `K`, and running `pan vault rotate-key` again retries the batch with the same
`K'` and moves what is left.

**Crash-safe order.** `src/lib/vault/rotate.ts` does, in this order:

1. write `K'` to `${OVERDECK_HOME}/vault/key.next` (0600, atomic) before any backend write;
2. `discardUnpublished()`, then the one `casRefs` batch: the point of no return;
3. replace or remove `keywrap/v1` with `putSlot`;
4. write `K'` to `vault/key`;
5. the CLI prints the new recovery phrase;
6. the CLI removes `key.next`.

While `key.next` exists every other verb refuses (the Stop hook stays silent and exits 0).
Running `rotate-key` again resumes: if the header already opens with the key in `key.next`
the batch was committed and only steps 3 to 6 run; otherwise the batch is retried with the
same key. Every refusal of the verb (declined prompt, weak passphrase, missing flag, a key
that does not open the vault, an unreachable backend) happens before `key.next` exists.
If another machine rotates first, a `key.next` left here can no longer finish: `rotate-key`
refuses with the re-join hint, and `pan vault join` removes `key.next` when it saves the
new key.

**Write guard.** `openVault` hands every verb a `KeyGuardedStore` bound to the header
version its key opened. Every ref write carries an assert of that version in the same
`casRefs` batch. A rotation changes the header, so a machine with a retired key gets
`conflict`, the guard re-reads the header, finds it no longer opens, and throws
`VaultKeyRetiredError`. `refresh` and `putSlot` check the header the same way, so a stale
machine cannot re-wrap a retired key under a passphrase. Nothing is published under a
retired key on the git backend.

**Re-join.** `pan vault join <backend>` on a machine already configured for that backend
refreshes its clone, verifies the new key against the header, calls
`discardUnpublished()`, and replaces `vault/key`. The local index and list cache are kept:
vault ids survive a rotation, so the next save continues each owned record under its new
ref name.

**Residual window (dir backend only).** The dir backend publishes objects when
`putObjects` writes them. A stale machine that passes its header check in the milliseconds
before a rotation commits can leave one unreferenced object sealed under the retired key.
No record points at it. This cannot happen on git: such objects stay untracked in the stale
clone and `discardUnpublished()` removes them at re-join, so they are never pushed.

**Git credentials.** Rotation does not revoke write access to the remote. Revoke or rotate
the lost machine's git credentials as well.

**Upgrade first.** A client older than PAN-4333 that holds `K'` reads refs but cannot decode
chunks sealed before the rotation. Upgrade every machine before rotating.

## Passphrase unlock

A second machine can join by typing a vault passphrase instead of the 24 words
([PAN-4328](https://github.com/eltmon/overdeck/issues/4328)). The vault key `K` is wrapped
under the passphrase and stored on the backend as the reserved slot `objects/keywrap/v1`.
The passphrase is never stored anywhere, and setting or removing a passphrase does not
change `K`; only `pan vault rotate-key` does. The recovery phrase is still the root of
recovery: removing the passphrase never locks you out.

`keywrap/v1` is UTF-8 JSON with exactly these eight fields (`src/lib/vault/keywrap.ts`):

| Field | Value |
| --- | --- |
| `v` | `1` |
| `kdf` | `"scrypt"` |
| `N`, `r`, `p` | scrypt cost; written as `131072`, `8`, `1` |
| `salt` | base64 of 16 random bytes |
| `nonce` | base64 of 12 random bytes |
| `ct` | base64 of AES-256-GCM(`K`) plus its 16-byte tag (48 bytes), associated data `overdeck-vault-keywrap-v1` |

- The key-encryption key is `scrypt(normalize(passphrase), salt, 32, { N, r, p, maxmem: 256 MiB })`.
  Node's default `maxmem` (32 MiB) rejects `N = 131072, r = 8`, so `maxmem` is mandatory.
  The derivation is async `crypto.scrypt`, never `scryptSync`.
- `normalize` is NFKC, trimmed, with every whitespace run collapsed to one space. Wrap,
  unwrap and the strength check all use the normalized form.
- The blob is validated before any derivation: `N` a power of two in [2^14, 2^20],
  `1 <= r <= 16`, `1 <= p <= 4`, `128·N·r·p <= 256 MiB`, exact field sizes, no extra keys.
  A malicious backend therefore cannot make a client allocate unbounded memory. A malformed
  blob makes `join` print a warning and fall back to the recovery phrase.
- A wrong passphrase fails GCM authentication locally, so `join` reads nothing else from the
  backend and writes nothing.

**Strength.** A typed passphrase must be at least 16 characters (code points, after
normalization), must not be on a short blocklist of well-known phrases, and must use at least
6 distinct characters. The default is a generated passphrase of 6 words drawn uniformly from
the EFF long wordlist (`src/lib/vault/eff-wordlist.ts`), about 77.5 bits.

**Offline guessing.** Anyone who holds the backend bytes can guess the passphrase offline.
Each guess costs 128 MiB and one scrypt derivation, so a generated passphrase is out of
reach, but a weak typed one is not. Use a generated passphrase unless you have a reason not to.

**Backend operation.** `VaultStore.putSlot(name, bytes | null)` overwrites or deletes a
reserved slot and publishes before it resolves; last write wins. The dir backend writes
atomically or unlinks. The git backend refreshes the clone, stages only `objects/keywrap`
(pending content objects never ride along), commits `vault: keywrap` and pushes; a
non-fast-forward push is retried up to three times, and any other push failure resets the
clone and throws `VaultOfflineError`.

## Commands

```bash
pan vault setup <git-url> [--hooks] [--passphrase-file p | --generate-passphrase | --no-passphrase]
                                            # enable; prints the recovery phrase ONCE, offers passphrase unlock
pan vault join <git-url> [--phrase-file p | --passphrase-file p]
                                            # second machine: passphrase first when one is set
pan vault passphrase set [--passphrase-file p | --generate]   # turn passphrase unlock on (or change it)
pan vault passphrase remove                 # turn it off; joining needs the recovery phrase
pan vault rotate-key [--yes] [--passphrase-file p | --generate-passphrase | --no-passphrase]
                                            # after losing a device: new key, new recovery phrase printed ONCE
pan vault status [--json]
pan vault save <id|path> | --all [--since <date>] [--harness <h>]
pan vault save --hook                       # Claude Code Stop hook: stdin JSON, silent, exit 0
pan vault sync
pan vault list [--json]                     # local cache only
pan vault show <id> [--json]                # turns, assistant text, versions
pan vault resume <id>[@<version>] [--cwd <dir>] [--no-launch] [--on-drift continue|note|cancel] [--no-code] [--worktree <dir>]
pan vault exclude [path] [--origin <url>] [--session <id>]
pan vault include [path] [--origin <url>] [--session <id>]
pan vault allow-secret <id|path> <line>
pan vault allow-secret <id> --file <path>    # blocked lines of one file in the code snapshot
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
| `appended N lines` | New lines were saved; the version number follows. A code-snapshot outcome may follow (see [Carrying your code](#carrying-your-code)). |
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

**Dashboard: Continue here.** A browse copy of a conversation another machine owns has a
**Continue here** button ([PAN-4437](https://github.com/eltmon/overdeck/issues/4437)). Its
dialog reads `GET /api/vault/records/:vaultId/continue-preview`, which writes nothing, and
continues with `POST /api/vault/records/:vaultId/continue`. The target checkout is chosen in
this order: the saved `cwd` when it exists here; else the registered project whose
`github_repo` or `gitlab_repo` matches the record's git origin (case-insensitive, first
match wins); else, when the origin parses, the dialog offers **Clone and register <slug>**,
which opens the Add-project dialog in clone mode with the URL filled in; else it names
`pan vault resume <id8> --cwd <dir>`. The browser never chooses a directory. A captured code
snapshot is applied in place on a clean checkout. On a dirty checkout it goes into a new
`scratch/vault-<id8>` workspace, unless the checkout already holds that exact snapshot; a
dirty checkout that is not a registered project is refused, because no workspace can be
created for it. A placed snapshot means no drift check; otherwise the drift choices are
Continue, Continue with a note (the same first message as `--on-drift note`) and Cancel. The
continue step re-reads the record: if another machine took it over after the dialog opened,
or lost a concurrent adoption race, the dialog shows `Already continued on <label>.` and no
native file or conversation row is written. The continued conversation is a managed
conversation; Codex records adopt into that conversation's private Codex home
(`${OVERDECK_HOME}/agents/<tmuxSession>/`), not `~/.codex`. `@<version>` forks and harnesses
other than Claude Code and Codex stay CLI-only.

### Carrying your code

Resume moves the conversation, and since
[PAN-4329](https://github.com/eltmon/overdeck/issues/4329) it also moves the uncommitted
code the conversation was working on, so it works even when the origin machine is off.

**What is captured.** Every tracked and untracked file in the working tree, and every local
commit that no remote-tracking ref contains, as one git bundle
(`src/lib/vault/wip-capture.ts`). Capture builds a WIP commit from a temporary index seeded
with a copy of yours, so it never touches your index, worktree, stash or branches; it creates
and deletes one temporary `refs/overdeck/wip/<vaultId>-<pid>` ref. A checkout with nothing
uncommitted and nothing unpushed records `clean` and uploads nothing.

**What is excluded.** Files matched by `.gitignore` (unless already tracked), the
staged-versus-unstaged split (everything arrives unstaged), submodule internals, and LFS or
filter content beyond its git-clean form. Sessions outside a git checkout carry no snapshot.

**When.** Only the machine that owns the record captures. The Stop hook and `pan vault save`
capture every time (`force`); `pan vault sync` captures at most once per 5 minutes and skips
when neither HEAD nor the working tree changed. When the transcript did not grow, a forced
capture replaces the latest settlement's snapshot in place, so version numbers do not move.
The 5 most recent snapshots are kept per record; older entries are dropped from the record.

**Size cap.** A bundle larger than `wipMaxBytes` (default 50 MB) is not uploaded; the
settlement records `skipped: too-large` with its size and `save` prints
`code snapshot skipped: <size> exceeds the <cap> cap`.

**Secrets.** Before upload, the added lines of every commit the bundle carries are scanned
with the same patterns as transcripts. A hit uploads nothing, records `skipped: secret`, and
`save` prints the file and pattern (never the value) with the command to allow it:
`pan vault allow-secret <id> --file <path>`, then `pan vault save` again. The transcript
itself still saves.

**Storage.** The bundle is split into 8 MiB parts, each zstd-compressed and sealed with
AES-256-GCM under the vault key, and stored as ordinary vault objects. Snapshots are
**never pushed to your git host**: the project's origin never sees them, and the vault
backend sees only ciphertext.

**Apply.** `pan vault resume` applies the latest captured snapshot before adopting: it
fetches origin, verifies and unbundles the snapshot, checks out the branch at the saved HEAD
(creating or fast-forwarding it; a branch with commits the snapshot lacks, or one checked out
in another worktree, is left alone and HEAD is detached at the saved commit), then applies
the changes unstaged. The target checkout must be clean. A dirty checkout is never written
to: at a TTY resume offers a fresh worktree at `<cwd>-vault-<id>`; otherwise it exits 1 and
names `--worktree <dir>`, which applies into a new worktree instead. An applied snapshot
replaces the drift prompt. A skipped snapshot prints `No code snapshot: skipped (<reason>)`
and the drift prompt runs as before. `--no-code` skips the code step entirely. Resuming on
the machine that owns the record skips it too, since the code is already there.

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
| `wipMaxBytes` | 52428800 | Largest code-snapshot bundle uploaded; larger ones record `skipped: too-large`. |

`~/.overdeck/config.yaml` is not involved: the standalone CLI must not load the settings schema.

## Files

| Path | Contents |
| --- | --- |
| `${OVERDECK_HOME}/vault/key` | Vault key, 32 raw bytes, 0600. |
| `${OVERDECK_HOME}/vault/key.next` | The new key of a rotation in progress, 0600. Removed when `pan vault rotate-key` finishes. |
| `${OVERDECK_HOME}/vault/config.json` | Configuration above. |
| `${OVERDECK_HOME}/vault/git/` | Local clone of the git backend (branch `main`). |
| `${OVERDECK_HOME}/vault/index.json` | Machine-local index: owned native paths with their tails, and the list cache. Never uploaded. |
| `${OVERDECK_HOME}/vault/allowed-secrets.json` | Allowed line hashes per record. |
| `${OVERDECK_HOME}/vault/eviction-batch.json` | Pending-deletion batch and declines. |
| `${OVERDECK_HOME}/environment-id.json` | Machine identity shared with PAN-3762. |
| `${OVERDECK_HOME}/vault/git.lock`, `index.json.lock`, `allowed-secrets.json.lock`, `eviction-batch.json.lock` | Cross-process lock files (O_EXCL, reclaimed after 30 s if a holder crashed). Every `pan vault` process shares the clone, the index, the allow-list and the batch, so each read-modify-write runs under its lock. |

## Troubleshooting

- **`offline`** — the backend could not be reached. The git clone was reset to `origin/main`
  and no local commit outlived the failed push; pending objects are rewritten on the next
  attempt. Run `pan vault sync` later.
- **`diverged`** — a saved line changed or the file shrank. The vault never overwrites saved
  history. Compare `pan vault show <id>` with the native file; excluding the session and
  saving again starts a new record.
- **`error: …` in `save --all` or `sync`** — one transcript's settlement threw (for example an
  unreadable file). The other transcripts still settle; fix or exclude the named file.
- **A transcript never becomes eligible for eviction** — eviction requires that restore would
  reproduce the file byte for byte and that the LOG holds exactly this machine's lines. A file
  with blank lines or no final newline, or a record whose LOG was appended twice, is kept on disk.
- **`blocked at line N: <pattern>`** — a secret was found in a new line. Rotate the secret if
  it is real, then `pan vault allow-secret <id|path> N`, or exclude the session.
- **`Already continued on <label>`** — another machine adopted the record first. Run
  `pan vault sync` and resume again to take it over from there.
- **`code snapshot blocked: <file> (<pattern>)`** — the uncommitted code holds a secret.
  Rotate it if it is real, then run the printed `pan vault allow-secret <id> --file <file>`
  and `pan vault save`.
- **`Refusing to apply the code snapshot: … has uncommitted changes`** — resume never
  writes into a dirty checkout. Commit or move your changes, or pass `--worktree <dir>`.
- **`This code snapshot needs commits your clone does not have`** — the snapshot builds on
  commits that `git fetch origin` could not bring in. Fetch or push them, then resume again.
- **`The passphrase did not unlock this vault.`** — the passphrase does not decrypt
  `keywrap/v1`. Nothing was written. Try again, or press Enter at the prompt to use the
  recovery phrase.
- **`The recovery phrase does not match this vault. If the vault key was rotated, use the new recovery phrase or passphrase.`**
  — the words decode but do not decrypt the header. Nothing was written. Check the phrase,
  or use the phrase printed by the last `pan vault rotate-key`.
- **`The passphrase unlocked a key this vault no longer uses. …`** — the keywrap on the
  backend still wraps a retired key, because a rotation has not finished. Use the new
  recovery phrase, or run `pan vault rotate-key` again on the machine that started it.
- **`This machine's vault key was retired by a key rotation. Run: pan vault join <backend> with the new recovery phrase or passphrase.`**
  — another machine rotated the key. Nothing was written. Run `pan vault join <backend>`
  with the new phrase or passphrase; the local index is kept.
- **`This machine's vault key does not open <backend>. If the key was rotated on another machine, run: pan vault join <backend>`**
  — the local clone already shows a header this key cannot open. Re-join as above.
- **`A vault key rotation started on this machine has not finished. Run: pan vault rotate-key`**
  — `vault/key.next` exists. Run `pan vault rotate-key` again; it resumes with the same new
  key and prints the recovery phrase.
- **`Another machine kept writing to the vault. …`** — the rotation batch conflicted five
  times. Stop `pan vault` on the other machines and run `pan vault rotate-key` again.

## Module map

```
src/lib/environment-identity.ts   machine identity (shared with PAN-3762)
src/lib/vault/config.ts           vault/config.json, isVaultEnabled
src/lib/vault/identity.ts         key, recovery phrase, HKDF sub-keys
src/lib/vault/keywrap.ts          passphrase unlock: keywrap/v1 wrap/unwrap, strength, generation
src/lib/vault/eff-wordlist.ts     vendored EFF long wordlist for generated passphrases
src/lib/vault/format.ts           chunk and record wire format, ref names, key ring fallback
src/lib/vault/keyring.ts          openKeyring, KeyGuardedStore: header-verified keys, guarded writes
src/lib/vault/rotate.ts           rotateVaultKey: one-batch key rotation, key.next
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
src/lib/vault/wip-capture.ts      WIP code snapshot: temp-index commit, bundle, scan, upload
src/lib/vault/wip-apply.ts        apply a snapshot: verify, unbundle, checkout base, apply
src/lib/vault/continue-inspect.ts write-free Continue-here preview facts, driftNote
src/lib/projects/origin-match.ts  git origin -> registered project (dashboard Continue here)
src/lib/overdeck/conversation-vault-continue.ts  managed conversation row and resume launch
src/dashboard/server/services/vault-continue.ts  previewContinue, continueHere
src/cli/commands/vault/*.ts       the pan vault verbs
```

`tests/unit/lib/vault/import-graph.test.ts` fails the build if anything reachable from
these modules imports the dashboard, the terminal backends, `src/lib/overdeck/*`, Effect or
node-pty (P-14). `tests/unit/lib/vault/two-machine.e2e.test.ts` runs the whole flow across
two temp homes and scans every object in the bare repository for plaintext.

## Windows

PAN-4331 checked the continue flow (`vault join` → `list` → `resume`, with the code snapshot)
on 2026-09-29 in the `windows-smoke` workflow,
[run 36615182191](https://github.com/eltmon/overdeck/actions/runs/36615182191). The environment
was GitHub's `windows-2022` runner (Windows Server 2022 Datacenter 10.0.20348) with Git for
Windows 2.55.0 and Node 22.23, plus Ubuntu 24.04 in WSL2 on the same runner (Node 22.23,
Git 2.43). Windows 11, and continuing a conversation after dual-booting the machine that saved
it, were not verified.

- **WSL2: supported.** Join, list, resume, the materialized transcript that Claude Code picks
  up, the Claude Code launch and the code snapshot all pass with the checkout in the Linux
  filesystem (`~/w/proj`). Line endings, the exec bit and a symlink arrive as saved. A
  checkout under `/mnt/c` was not tested. The runners have no Claude credentials, so "picks
  up" means `claude --resume <id> -p ping` answers "Not logged in" for the materialized id and
  "No conversation found" for a random one; no reply was exchanged.
- **Native Windows: not supported.** `pan vault join` fails when git has `core.autocrlf=true`,
  the Git for Windows default: `<url> is neither empty nor a vault (no VAULT-FORMAT on main)`
  ([#4418](https://github.com/eltmon/overdeck/issues/4418)). The checkout converts the
  `VAULT-FORMAT` marker to CRLF, and the byte comparison in `initGitVault` rejects it. Every
  later step depends on join, so the native runs stop there.
- **Behind that blocker**, a diagnostic run that first sets `git config --global core.autocrlf
  false` got further. That configuration is not supported. In it, list, `resume --no-launch`
  and the code snapshot work, and the transcript lands in
  `%USERPROFILE%\.claude\projects\D--a--temp-w-proj\`, where Claude Code finds it. Launching
  fails: `resume` without `--no-launch` stops with `Error: spawn claude ENOENT`, because
  `defaultSpawn` runs `claude` without a shell and npm installs it as `claude.cmd`
  ([#4419](https://github.com/eltmon/overdeck/issues/4419)). `--no-launch` prints
  `cd 'D:\a\_temp\w\proj' && claude --resume <id>`, with the path in POSIX single quotes;
  running that printed command by hand was not tested.
- **Line endings, exec bit, symlinks** (diagnostic run; the native runs never applied a
  snapshot): `lf.txt` and `crlf.txt` arrived byte for byte (LF and CRLF). `run.sh` arrived as
  mode 100644, not 100755, because `core.filemode` is `false`. `link-to-lf` arrived as a real
  symlink (`core.symlinks=true` on the runner).
- **Dashboard on native Windows:** `npx @overdeck/core` starts the server and its API answers,
  but every page returns 404, because the static root is built from a URL path
  ([#4420](https://github.com/eltmon/overdeck/issues/4420)). Starting a conversation fails
  with "Terminal backend 'herdr' is selected but unavailable: … Run `pan install` … or set
  terminal.backend: tmux in ~/.overdeck/config.yaml". Whether `pan install` provides Herdr
  on Windows was not tested.

To check a fix, run the workflow again (Actions → windows-smoke → Run workflow). It also runs
on any push that changes `scripts/windows-smoke/**`. The fixture builder, the two probes and
the summarizer live in `scripts/windows-smoke/`; the step catalogue and results schema are in
`.pan/drafts/PAN-4331.md`.
