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
```

## What It Does

`shadow` manages the legacy TOML-backed shadow-mode CLI settings.

`tiers` prints `roles.work`'s effective model and every `tiered_execution` tier with its
declared model (`workhorse:<slot>` refs resolved, e.g. `workhorse:mid → claude-opus-5-5`).
Tiers marked `[overrides roles.work]` launch a different model than `roles.work` for planned
issues while tiered execution is on.

This command does **not** expose general-purpose `show`, `edit`, `get`, or `set`
subcommands for the YAML router config. For model routing and provider settings, use the
Settings page or edit `~/.overdeck/config.yaml` directly.

## When to Use

- Checking current shadow mode status
- Enabling or disabling global shadow mode
- Overriding shadow mode for a specific tracker

## See Also

- `pan admin migrate-config` — migrate legacy settings.json → config.yaml
- `pan admin migrate-plan-home <project-key>` — copy open issues' planning artifacts from the legacy state directory into `.pan/`
- `pan admin tracker <cmd>` — tracker-specific operations
- `pan doctor` — verify configuration is valid
