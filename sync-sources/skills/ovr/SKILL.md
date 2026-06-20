---
name: ovr
description: "ovr <verb> <args> — short alias of /pan. Dispatches any Overdeck CLI command. Invoke bare to see the command taxonomy, or pass a full command to run it."
argument-hint: "<verb> [args] — e.g. sync, doctor, start PAN-415"
triggers:
  - ovr help
  - ovr commands
  - overdeck help
allowed-tools:
  - Bash
  - Read
---

# Overdeck CLI Umbrella — `/ovr` (alias of `/pan`)

`/ovr`, `/overdeck`, and `/pan` are the same umbrella. `pan` is the canonical
CLI verb; `ovr` and `overdeck` are short / brand aliases for it. Use whichever
you like — they dispatch identically.

## Usage

**Invoked with args** (`/ovr sync`, `/ovr start PAN-415`, `/ovr admin cloister status`) —
run the command directly with the canonical `pan` binary:

```bash
pan <args>
```

Replace `<args>` with the full command string the user gave after `/ovr`.

**Invoked bare** (`/ovr` with no args) — follow the `/pan` skill, which holds the
canonical six-bucket command taxonomy. Don't duplicate it here.
