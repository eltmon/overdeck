---
name: pan-skill-installer
description: Install an external skill or Claude Code plugin into Overdeck's bundled distribution so pan sync ships it to every Overdeck user
triggers:
  - install this skill for all overdeck users
  - bundle this plugin
  - distribute this skill via pan sync
  - add this plugin to overdeck
  - install skill from github
---

# Installing Skills and Plugins into Overdeck's Distribution

**This skill is for Overdeck developers only.** It covers taking an external
artifact — a skill directory, a GitHub repo, or a Claude Code plugin — and
wiring it into the overdeck repo so `pan sync` distributes it to every
Overdeck user (or to Overdeck dev machines only).

## Step 1 — Identify what you're installing

Fetch or inspect the source first. The artifact type determines the mechanism:

| Artifact | How to recognize it | Distribution mechanism |
|---|---|---|
| **Plain skill** | A directory with `SKILL.md` (plus optional scripts/references) | Copy into `sync-sources/skills/<name>/` |
| **Dev-only skill** | Same shape, but only useful on an overdeck source checkout | Copy into `sync-sources/dev-skills/<name>/` |
| **Claude Code plugin** | A repo with `.claude-plugin/marketplace.json`, installed via `/plugin install` — often has its own runtime (TypeScript, MCP servers, commands) | Add an entry to `sync-sources/plugins.json` |

A plugin can NOT be flattened into a skill: it carries slash commands and a
runtime that only Claude Code's plugin system can load. Conversely, a plain
skill should NOT go through the plugin manifest.

## Step 2a — Bundled skill (`sync-sources/skills/`)

1. Copy the skill directory (the folder containing `SKILL.md`) into
   `sync-sources/skills/<kebab-name>/`. Vendor the whole directory —
   scripts, references, templates.
2. Ensure the frontmatter has `name`, `description`, and `triggers`. Match
   the style of two neighbors before editing.
3. Skills here reach **all users on every machine** and cost catalog space in
   every session — keep the description tight.

Dev-only skills follow the same shape under `sync-sources/dev-skills/`; they
sync only when running from an overdeck source checkout (`isDevMode()`).

## Step 2b — Claude Code plugin (`sync-sources/plugins.json`)

1. Find the marketplace name and plugin name in the repo's
   `.claude-plugin/marketplace.json` (`name` at the top level is the
   marketplace; each `plugins[].name` is a plugin).
2. Append an entry to `sync-sources/plugins.json`:

   ```json
   {
     "plugin": "<pluginName>@<marketplaceName>",
     "marketplace": "<owner>/<repo>"
   }
   ```

   Example — the OpenAI Codex plugin (`openai/codex-plugin-cc` declares
   marketplace `openai-codex` with plugin `codex`):

   ```json
   { "plugin": "codex@openai-codex", "marketplace": "openai/codex-plugin-cc" }
   ```

3. Provisioning is implemented in `src/lib/claude-plugins-provision.ts` and
   runs as a `pan sync` step: for each manifest entry it checks
   `claude plugin list --json`, adds the marketplace if missing
   (`claude plugin marketplace add <source>`), then installs at user scope
   (`claude plugin install <plugin> --scope user`). It is idempotent and
   degrades to a warning when `claude` is missing or the network install
   fails — it never fails the sync.
4. Plugins install for **all users** on machines with the `claude` CLI. There
   is no dev-only plugin tier; if one is ever needed, that's a code change in
   the provisioning module, not a manifest convention.

## Step 3 — Sync, verify, commit

```bash
npm run build          # provisioning runs from dist via the pan CLI
pan sync               # look for the "Provisioning Claude Code plugins" /
                       # skills sync lines in the output
claude plugin list     # plugin installs only: confirm the id appears
```

For skills, confirm the copy landed in `~/.claude/skills/<name>/` and
`~/.agents/skills/<name>/`.

Then commit and push — bundled content ships with the package, so an
uncommitted skill or manifest entry exists only on your machine. Other users
receive it on their next `pan install` / `pan sync` after release.

## Related

- `/pan-skill-creator` — authoring a NEW skill from scratch (shapes, frontmatter, lint rules)
- `/pan-sync` — how the sync pipeline distributes bundles to each harness
- `docs/SKILLS-CONVENTION.md` — wrapper-skill naming rules and the lint that enforces them
