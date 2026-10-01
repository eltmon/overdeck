---
name: pan-vault
description: "pan vault <verb> — Session Vault: encrypted off-machine storage and cross-machine resume for agent conversations"
triggers:
  - pan vault
  - session vault
  - vault setup
  - resume on another machine
allowed-tools:
  - Bash
---

# pan vault

Session Vault stores agent transcripts, encrypted, in a git remote the user owns, and lets another machine continue a conversation. Nothing is stored anywhere Overdeck controls, `pan vault` sends no telemetry, and no transcript is ever deleted without an explicit confirmation.

## Enable and join

```bash
pan vault setup <git-url>          # enable; prints the 24-word recovery phrase ONCE
pan vault setup <git-url> --hooks  # also register the Claude Code Stop hook (saves after each turn)
pan vault setup <git-url> --generate-passphrase        # also turn on passphrase unlock with a generated 6-word passphrase
pan vault setup <git-url> --passphrase-file <path>     # also turn on passphrase unlock with the passphrase in this file
pan vault setup <git-url> --no-passphrase              # do not offer passphrase unlock
pan vault join <git-url>           # second machine: the vault passphrase if one is set, else the phrase
pan vault join <git-url> --phrase-file <path>
pan vault join <git-url> --passphrase-file <path>
pan vault status                   # backend, this machine, owned records, last sync, machines
pan vault status --json
```

With no backend configured every verb except `setup` and `join` prints `Session Vault is off. Run: pan vault setup <git-url>` and exits 0.

After printing the recovery phrase, setup on a TTY offers passphrase unlock with a suggested passphrase (Enter accepts it, `skip` declines); a non-TTY run without a flag prints a hint to run `pan vault passphrase set` later. A `--passphrase-file` shorter than 16 characters is refused before anything is created.

The recovery phrase is the vault key. Anyone with these words can read the vault; losing every device and these words loses the vault. Store it in a password manager.

## Passphrase unlock

```bash
pan vault passphrase set                          # prompt for a passphrase (16+ characters); Enter generates one
pan vault passphrase set --generate               # generate a 6-word passphrase and print it once
pan vault passphrase set --passphrase-file <path> # read the passphrase from a file
pan vault passphrase remove                       # turn passphrase unlock off; joining needs the recovery phrase again
```

When a passphrase is set, `pan vault join` asks for it first; press Enter to use the recovery phrase instead. A wrong passphrase prints `The passphrase did not unlock this vault.` and writes nothing. `set` stores the vault key wrapped under the passphrase on the backend, so a new machine can join by typing the passphrase instead of the 24 words. The passphrase itself is never stored, and setting or removing a passphrase does not change the vault key, so the recovery phrase keeps working.

## Key rotation (lost device)

```bash
pan vault rotate-key --yes                          # rotate without the confirmation prompt
pan vault rotate-key --passphrase-file <path>       # re-wrap passphrase unlock under the new key with the passphrase in this file
pan vault rotate-key --generate-passphrase          # re-wrap passphrase unlock under the new key with a generated 6-word passphrase
pan vault rotate-key --no-passphrase                # turn passphrase unlock off
```

A lost or revoked machine still holds the vault key. `rotate-key` replaces the key: it re-encrypts every record, every machine entry and the header under a new key and prints a NEW 24-word recovery phrase once. The lost machine can still read what was saved before the rotation and nothing saved after it. Every other machine then refuses to write with `This machine's vault key was retired by a key rotation.` and must run `pan vault join <git-url>` with the new recovery phrase or passphrase. On a TTY the verb asks for confirmation; off a TTY it needs `--yes`, and a vault that has a passphrase needs one of the three passphrase flags. If a rotation is interrupted, other verbs print `A vault key rotation started on this machine has not finished.`; run `pan vault rotate-key` again to finish it. Upgrade Overdeck on every machine before rotating.

## Save and sync

```bash
pan vault save <session-id-or-path>          # settle one transcript
pan vault save --all                         # every discovered transcript
pan vault save --all --since 2026-09-01 --harness claude-code
pan vault sync                               # settle owned transcripts that grew, refresh the list
```

`save` prints one verdict per transcript: `appended N lines`, `noop`, `blocked at line N: <pattern>`, `diverged`, `excluded`, or `offline`. A blocked line names the pattern and never the value; allow it with `pan vault allow-secret <id-or-path> <line>` or exclude the session. `pan vault save --hook` is the Stop-hook mode: it reads the hook JSON from stdin, prints nothing and always exits 0.

## Browse and resume

```bash
pan vault list                      # from the local cache; works offline
pan vault list --json
pan vault show <id>                 # human turns, assistant text and versions, read-only
pan vault resume <id>               # adopt the conversation here and launch the harness
pan vault resume <id>@3             # fork at version 3 first
pan vault resume <id> --cwd <dir> --no-launch
pan vault resume <id> --on-drift note
pan vault resume <id> --no-code             # conversation only; skip the code snapshot
pan vault resume <id> --worktree <dir>      # apply the code snapshot into a new git worktree
```

`resume` compares the target directory's git state with the saved state. On a difference it asks on a TTY; `--on-drift continue|note|cancel` answers non-interactively and a non-TTY run without the flag cancels. Claude Code and Codex resume natively; other harnesses get a seed digest file in the target directory.

Each save also captures an encrypted snapshot of the uncommitted code (tracked and untracked files plus unpushed commits; ignored files excluded; 50 MB cap; never pushed to the git host). `resume` applies the latest one before continuing: the target checkout must be clean, or pass `--worktree <dir>`; changes arrive unstaged. A secret in the code blocks only the snapshot; `save` names the file and pattern.

## Exclusions and secrets

```bash
pan vault exclude /work/secret-proj
pan vault exclude --origin git@github.com:org/private.git
pan vault exclude --session <id>    # tombstones an already-saved record
pan vault include /work/secret-proj
pan vault allow-secret <id-or-path> <line>
pan vault allow-secret <id> --file <path>   # blocked lines of one file in the code snapshot
```

## Eviction (opt-in, confirmation required)

```bash
pan vault evict                       # review: paths, sizes, status, total, fingerprint; deletes nothing
pan vault evict --confirm <fingerprint>
pan vault evict --decline <vaultId>
pan vault evict --reoffer <vaultId>
pan vault evict --clear
pan vault restore <id>                # rebuild an evicted transcript byte for byte
pan vault restore <id> --to <path>
```

Eviction only runs when `vault.evict` is `true` in `~/.overdeck/vault/config.json`. Even then, transcripts wait in a pending-deletion batch until `--confirm` with the fingerprint printed by the review; anything that changed since the review is skipped.

## In the dashboard

With the dashboard running, conversations it started are saved 30 seconds after they go quiet and synced every 5 minutes; no hook is needed.

Settings → Session Vault shows backend, last sync, blocked lines with the `pan vault allow-secret` command, machines, and the pending-deletion batch, which can be confirmed there.

Conversations another machine owns (Claude Code and Codex) appear read-only, marked "from `<machine>`"; **Continue here** adopts one on this machine (same rules as `pan vault resume`).

Setup, join and unlock are CLI-only; dashboard support is PAN-4446.

Settings → Anywhere's status card reports the vault as Not set up, Locked on this machine, Key rotation unfinished, or Ready.
