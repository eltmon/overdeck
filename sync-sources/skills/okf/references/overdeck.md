# Overdeck Integration Contract

The OKF skill is portable. It may detect Overdeck and use it as feedstock, but the core scripts and workflow must not import Overdeck code.

## Detection

Overdeck is available only when:

1. `pan` is on `PATH`.
2. `pan` responds successfully to a lightweight command such as `pan --help` or a specific read command.

Detection is by command execution, never by Python or TypeScript imports.

## Optional OpenKnowledge MCP Registration

The dashboard viewer and `pan knowledge open` never register an MCP server. Their unattended initialization always uses `ok init --no-mcp --no-skills`, so opening the viewer cannot change an editor or agent configuration.

MCP registration is a separate, explicit operator action. From the resolved knowledge-bundle root, run:

```bash
ok init --mcp --no-skills --scope user
```

Use `--scope project` for repository-local configuration, or `--scope both` for both locations. OpenKnowledge v0.34 writes the supported native formats:

| Client | User scope | Project scope |
| --- | --- | --- |
| Claude Code | `~/.claude.json` | `.mcp.json` |
| Codex | `~/.codex/config.toml` | `.codex/config.toml` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |

OpenKnowledge registers only clients it detects. Start or install the intended client, then rerun the explicit command if its config root was previously absent. Review the reported paths before restarting the client; registration is opt-in and Overdeck never performs it automatically.

`/okf init` and `ok init` are different commands: `/okf init` creates or connects an OKF knowledge bundle, while the upstream `ok init` command scaffolds OpenKnowledge's local `.ok/` runtime files and optionally registers MCP clients.

## Retro Feedstock

When Overdeck is detected, `/okf retro` may mine observations for the issue:

```bash
pan memory search --issue <issue-id> "<focus or recent decisions>" --json
```

Observation records are evidence. Concepts created from them must cite the recorded decision, observation text, issue ID, or transcript reference used as source material.

When Overdeck is not detected, `/okf retro` falls back to:

- `git diff` for the implemented change.
- Current transcript or session notes available to the agent.
- Existing bundle concepts found through `/okf extract`.

The fallback path must still create validating concepts and must not require `pan`.

## PR Boundary

Retro writes to a knowledge-repo branch and opens a PR. It does not push directly to the default branch. Before opening the PR, run:

```bash
python3 <okf-skill-dir>/scripts/reindex.py --bundle <bundle> --log-entry "<entry>"
python3 <okf-skill-dir>/scripts/validate.py --bundle <bundle> --strict
```

If validation fails, fix the bundle first.
