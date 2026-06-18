## Problem

The per-issue auto-merge toggle ([PAN-1692](https://github.com/eltmon/overdeck/issues/1692)) has a **"default"** state — "follow the project default." But there is no per-project default to follow. The only default that exists is a **single global** app-setting, `flywheel.require_uat_before_merge` (one toggle on the Flywheel page for the whole instance).

## Ask

Add a **per-project** auto-merge / UAT default, so e.g. project A can auto-merge by default while project B holds for UAT by default. The per-issue toggle's **"default"** state then resolves against *that project's* default rather than a single global switch.

### Resolution order (proposed)

`per-issue autoMerge (true/false)` → overrides `per-project default` → overrides `global flywheel.require_uat_before_merge`.

- `autoMerge === true` → auto-merge (overrides everything below).
- `autoMerge === false` → hold for UAT (overrides everything below).
- `autoMerge === undefined` → use the project default; if the project has none, fall back to the global setting.

## Where it lives

The per-project default setting belongs in the project-settings section ([PAN-1693](https://github.com/eltmon/overdeck/issues/1693)). Relates to [PAN-1691](https://github.com/eltmon/overdeck/issues/1691) (merge train) and [PAN-1692](https://github.com/eltmon/overdeck/issues/1692) (toggle UI).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
