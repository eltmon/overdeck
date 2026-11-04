# Overdeck integrations

Plugins that connect outside chat agents and bots to Overdeck through the
Overdeck MCP server. Each platform directory is its own package with its
own README, version, changelog and tests. All of them are MIT licensed
(see [LICENSE](LICENSE)).

| Directory | Platform | Plugin format |
| --- | --- | --- |
| `hermes/` | Hermes Agent | Python package with `plugin.yaml` |
| `openclaw/` | OpenClaw | npm package with `openclaw.plugin.json` |
| `grok-build/` | Grok Build, xAI's local coding agent | `.grok-plugin/plugin.json` and `.mcp.json` |
| `grok-bot/` | Grok Bot and the xAI API | `.cursor-plugin/plugin.json` and a remote `mcp.json` |
| `shared/` | all of them | the shared skill and its sync script |

## The shared skill

Every plugin bundles the same `overdeck` skill: what Overdeck is, the tool
groups, and the safety rules a bot must follow. The source is
[`shared/SKILL.md`](shared/SKILL.md). Edit only that file, then run this
from the repository root:

```bash
node integrations/shared/sync-skill.mjs
```

It writes the copy at `<platform>/skills/overdeck/SKILL.md` for each
platform. Never edit a copy by hand. `node integrations/shared/sync-skill.mjs --check`
writes nothing and exits 1 when a copy differs from the source or is
missing; `tests/unit/integrations/sync-skill.test.ts` runs that check in
CI.

Keep the skill's frontmatter to single-line `name` and `description`
keys, because OpenClaw's parser reads single-line keys only, and keep the
file under 100 lines and 6,000 bytes, because every bot loads it into its
context.

## Publishing

Nothing in this directory is published automatically. Publishing a
package to PyPI, npm or a plugin catalog is a separate step the operator
approves (PAN-4927, decision D-5). Each package's `PUBLISHING.md` gives
its steps.
