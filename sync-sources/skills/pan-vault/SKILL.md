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
