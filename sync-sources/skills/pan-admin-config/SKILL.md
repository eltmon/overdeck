---
name: pan-admin-config
description: "pan admin config <cmd> — view and edit Panopticon project configuration"
triggers:
  - pan admin config
  - panopticon config
  - configure panopticon
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
```

## What It Does

Manages the legacy TOML-backed shadow-mode CLI settings.

This command does **not** currently expose general-purpose `show`, `edit`, `get`, or `set`
subcommands for the YAML router config. For model routing and provider settings, use the
Settings page or edit `~/.panopticon/config.yaml` directly.

## When to Use

- Checking current shadow mode status
- Enabling or disabling global shadow mode
- Overriding shadow mode for a specific tracker

## See Also

- `pan admin migrate-config` — migrate legacy settings.json → config.yaml
- `pan admin tracker <cmd>` — tracker-specific operations
- `pan doctor` — verify configuration is valid
