---
name: pan-models
description: "pan models preset <cmd> — preview, apply and undo eval-backed provider model presets"
triggers:
  - pan models preset
  - model preset
  - apply anthropic defaults
  - apply openai defaults
allowed-tools:
  - Bash
  - Read
---

# pan models preset

Run the command now:

```bash
pan models preset <subcommand>
```

## Usage

```
pan models preset list [--json]
pan models preset show <id> [--json]
pan models preset apply <id> [--dry-run] [--yes] [--json]
pan models preset undo [--json]
```

Preset ids: `anthropic`, `anthropic-cost-saver` (pilot), `openai` (research-backed).

## What It Does

A preset sets every model and effort setting (workhorse slots, roles, review lanes,
existing tiers, the default conversation model and background AI models) to one
provider's lineup. It writes explicit values into `~/.overdeck/config.yaml` **once**,
editing only the settings that change; comments, `$VAR` key references and other keys
keep their text. A preset never auto-applies, including when a newer preset version ships.

- `list` shows each preset's version, evidence, what was last applied, and whether an update is available.
- `show` prints the per-setting diff against your config (before → after), the settings the preset will not set and why, and notes.
- `apply` prints the diff and asks to confirm. `--yes` skips the prompt; `--dry-run` writes nothing.
  A plan blocked by missing credentials, a missing harness CLI or a harness-policy check exits 1 and prints the reason.
- `undo` restores the values the last apply replaced. A setting changed since the apply is left as is.

`--json` on `show` and `apply --dry-run` prints the same plan object that the dashboard's
`GET /api/model-presets/<id>/plan` returns.

## When to Use

- Adopting the eval-backed Anthropic or research-backed OpenAI lineup in one step
- Previewing what a new preset version would change
- Reverting a preset apply

## See Also

- Settings → Model Routing: the same presets as buttons, with an Undo action
- `configuration/model-presets.mdx` — each preset's values and the evidence behind them
- `pan admin config tiers` — effective model per tier
