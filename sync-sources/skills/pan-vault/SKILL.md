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
pan vault join <git-url>           # second machine: enter the phrase
pan vault join <git-url> --phrase-file <path>
pan vault status                   # backend, this machine, owned records, last sync, machines
pan vault status --json
```

With no backend configured every verb except `setup` and `join` prints `Session Vault is off. Run: pan vault setup <git-url>` and exits 0.

The recovery phrase is the vault key. Anyone with these words can read the vault; losing every device and these words loses the vault. Store it in a password manager.

## Passphrase unlock

```bash
pan vault passphrase set                          # prompt for a passphrase (16+ characters); Enter generates one
pan vault passphrase set --generate               # generate a 6-word passphrase and print it once
pan vault passphrase set --passphrase-file <path> # read the passphrase from a file
pan vault passphrase remove                       # turn passphrase unlock off; joining needs the recovery phrase again
```

`set` stores the vault key wrapped under the passphrase on the backend, so a new machine can join by typing the passphrase instead of the 24 words. The passphrase itself is never stored, and the vault key never changes, so the recovery phrase keeps working.

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
```

`resume` compares the target directory's git state with the saved state. On a difference it asks on a TTY; `--on-drift continue|note|cancel` answers non-interactively and a non-TTY run without the flag cancels. Claude Code and Codex resume natively; other harnesses get a seed digest file in the target directory.

## Exclusions and secrets

```bash
pan vault exclude /work/secret-proj
pan vault exclude --origin git@github.com:org/private.git
pan vault exclude --session <id>    # tombstones an already-saved record
pan vault include /work/secret-proj
pan vault allow-secret <id-or-path> <line>
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
