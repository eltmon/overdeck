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
pan vault join <git-url>           # second machine: enter the phrase
pan vault join <git-url> --phrase-file <path>
pan vault status                   # backend, this machine, owned records, last sync, machines
pan vault status --json
```

With no backend configured every verb except `setup` and `join` prints `Session Vault is off. Run: pan vault setup <git-url>` and exits 0.

The recovery phrase is the vault key. Anyone with these words can read the vault; losing every device and these words loses the vault. Store it in a password manager.

## Save and sync

```bash
pan vault save <session-id-or-path>          # settle one transcript
pan vault save --all                         # every discovered transcript
pan vault save --all --since 2026-09-01 --harness claude-code
pan vault sync                               # settle owned transcripts that grew, refresh the list
```

`save` prints one verdict per transcript: `appended N lines`, `noop`, `blocked at line N: <pattern>`, `diverged`, `excluded`, or `offline`. A blocked line names the pattern and never the value; allow it with `pan vault allow-secret <id-or-path> <line>` or exclude the session. `pan vault save --hook` is the Stop-hook mode: it reads the hook JSON from stdin, prints nothing and always exits 0.
