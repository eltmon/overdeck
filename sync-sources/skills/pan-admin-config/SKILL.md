---
name: pan-admin-config
description: "pan admin config <cmd> — view and edit Overdeck project configuration"
triggers:
  - pan admin config
  - overdeck config
  - configure overdeck
  - edit config
allowed-tools:
  - Bash
  - Read
---

# pan admin config

Run the command now:

```bash
pan admin config <subcommand>
```

## Usage

```
pan admin config shadow --status
pan admin config shadow --enable
pan admin config shadow --disable
pan admin config shadow --tracker github --enable
pan admin config tiers
pan admin config set resources.quality_gate_slots 3
pan admin config set agents.rtk.enabled false
```

## What It Does

`shadow` manages the legacy TOML-backed shadow-mode CLI settings.

`tiers` prints `roles.work`'s effective model and every `tiered_execution` tier with its
declared model (`workhorse:<slot>` refs resolved, e.g. `workhorse:mid → claude-opus-5-5`).
Tiers marked `[overrides roles.work]` launch a different model than `roles.work` for planned
issues while tiered execution is on.

`set <key> <value>` writes one value into `~/.overdeck/config.yaml` and keeps comments and every
other block. The key is dotted snake_case exactly as the file nests it
(`resources.quality_gate_slots`); the value is parsed as YAML, so `3` is a number, `true` a
boolean and `[a, b]` a list. The config is loaded again after the write; if the value makes it
invalid, the previous file is restored and the error is printed. Settings → Anywhere → Machines →
**Compare settings** prints this command for each value that differs from a linked machine.

## When to Use

- Checking current shadow mode status
- Enabling or disabling global shadow mode
- Overriding shadow mode for a specific tracker

## See Also

- `pan admin migrate-config` — migrate legacy settings.json → config.yaml
- `pan admin migrate-plan-home <project-key>` — copy open issues' planning artifacts from the legacy state directory into `.pan/`
- `pan admin tracker <cmd>` — tracker-specific operations
- `pan doctor` — verify configuration is valid
