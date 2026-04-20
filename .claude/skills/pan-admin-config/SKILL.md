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
pan admin config show              # Print current config
pan admin config edit              # Open config in editor
pan admin config get <key>         # Get a specific value
pan admin config set <key> <val>   # Set a value
```

## What It Does

Views and edits the Panopticon `config.yaml` file that controls project settings,
tracker integrations, workspace defaults, and agent behavior.

## When to Use

- Connecting a new issue tracker
- Adjusting workspace settings
- Viewing current configuration

## See Also

- `pan admin migrate-config` — migrate legacy settings.json → config.yaml
- `pan admin tracker <cmd>` — tracker-specific operations
- `pan doctor` — verify configuration is valid
