---
name: overdeck
description: "overdeck <verb> <args> — alias of /pan. Dispatches any Overdeck CLI command. Invoke bare to see the command taxonomy, or pass a full command to run it."
argument-hint: "<verb> [args] — e.g. sync, doctor, start PAN-415"
triggers:
  - overdeck help
  - overdeck commands
  - what can overdeck do
allowed-tools:
  - Bash
  - Read
---

# Overdeck CLI Umbrella — `/overdeck` (alias of `/pan`)

`/overdeck`, `/ovr`, and `/pan` are the same umbrella. `pan` is the canonical
CLI verb; `overdeck` and `ovr` are brand / short aliases for it. Use whichever
you like — they dispatch identically.

## Usage

**Invoked with args** (`/overdeck sync`, `/overdeck start PAN-415`, `/overdeck admin cloister status`) —
run the command directly with the canonical `pan` binary:

```bash
pan <args>
```

Replace `<args>` with the full command string the user gave after `/overdeck`.

**Invoked bare** (`/overdeck` with no args) — follow the `/pan` skill, which holds
the canonical six-bucket command taxonomy. Don't duplicate it here.
