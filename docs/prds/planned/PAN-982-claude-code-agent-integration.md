# PAN-982: Claude Code `--agent` Integration for Agent Lifecycle

**Status:** Planned
**Author:** planning-agent (claude-opus-4-6)
**Date:** 2026-05-07
**Claude Code Version:** 2.1.121+

## Executive Summary

Claude Code v2.1.117+ introduced a built-in agent definition system: `.claude/agents/<name>.md` files with YAML frontmatter specifying model, tools, permissions, hooks, and MCP servers. The `--agent <name>` CLI flag starts Claude with that agent's full config. This PRD evaluates how Panopticon can leverage this system to simplify agent lifecycle management, and proposes a phased migration that replaces parts of `launcher-generator.ts` while preserving what Claude Code's agent system cannot handle.

## Research Findings

### Empirical Tests (2026-05-07)

| Test | Result |
|------|--------|
| `--agent <name>` with `--print` | Works. Agent's model/tools/permissions applied. |
| `--agent` + `--model` override | `--model` CLI flag **overrides** frontmatter `model:`. Verified: `--agent codebase-explorer` (haiku) + `--model opus` → ran on `claude-opus-4-7`. |
| `--agent` + `--resume` | **Works.** Resumed session adopts new agent's config. Started with `codebase-explorer` (haiku), resumed with `planning-agent` (sonnet) → actually ran on `claude-sonnet-4-6`. |
| `--agents <json>` inline | **Works.** Accepts `--agents '{"name":{"description":"...","model":"haiku","tools":[...],"permissionMode":"plan"}}'` + `--agent name`. Same fields as markdown frontmatter. |
| `--agent` + `--name` | Works. Named session created with agent config applied. |
| `--agent` + `--session-id` | Works. Can assign specific UUID to agent session. |
| `claude agents` listing | Plain text only. No `--json` or `--output-format` flag. Shows project agents + built-in agents with name/model. |
| `claude agents` JSON output | **Not supported.** `--json`, `--output`, `--output-format` all rejected. |

### Agent Definition Format (Full Spec)

File: `.claude/agents/<name>.md` (project) or `~/.claude/agents/<name>.md` (user)

```yaml
---
name: work-agent                    # unique identifier
description: Implementation agent   # when to delegate (for Agent tool)
model: sonnet                       # sonnet|opus|haiku|inherit|full-model-id
tools:                              # allowlist (if set, disallowedTools ignored)
  - Read
  - Edit
  - Bash
  - Agent
disallowedTools:                    # denylist (only if tools: absent)
  - WebSearch
permissionMode: bypassPermissions   # default|acceptEdits|auto|dontAsk|bypassPermissions|plan
maxTurns: 100                       # max agentic turns
hooks:                              # per-agent hooks (PreToolUse, PostToolUse, Stop ONLY)
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
mcpServers:                         # per-agent MCP servers
  myServer:
    command: "node"
    args: ["server.js"]
initialPrompt: "..."                # auto-submitted as first turn
effort: high                        # low|medium|high|xhigh|max
isolation: worktree                 # git worktree isolation
color: blue                         # display color
---

Agent system prompt (markdown body)...
```

### What `--agent` Can Replace in Panopticon

| Current Mechanism | Replacement | Notes |
|---|---|---|
| `--model <model>` in baseCommand | `model:` frontmatter | CLI `--model` overrides, so non-Anthropic models can still be forced |
| `--dangerously-skip-permissions --permission-mode bypassPermissions` | `permissionMode: bypassPermissions` | Direct replacement |
| Tool restrictions (implicit: all tools) | `tools:` / `disallowedTools:` | Review agent can be locked to read-only tools |
| Agent type documentation (ad-hoc prompt sections) | Markdown body = system prompt | Agent identity baked into definition |
| `--session-id <uuid>` in launcher | `--session-id` still needed but cleaner alongside `--agent` | No change |

### What `--agent` CANNOT Replace (Launcher Still Required)

| Mechanism | Why It Can't Move to `--agent` |
|---|---|
| Provider env injection (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) | `model:` frontmatter only supports Anthropic models. Non-Anthropic routing (Kimi, OpenAI CLIProxy, OpenRouter) requires env var injection. |
| `unset PROVIDER_ENV_UNSETS` | Stale parent env must be scrubbed before re-export. No frontmatter mechanism for this. |
| `PANOPTICON_AGENT_ID` / `PANOPTICON_ISSUE_ID` / `PANOPTICON_SESSION_TYPE` | Read by hooks (heartbeat, cost recorder, stop-hook). No frontmatter mechanism for custom env vars. |
| `TERM` / `COLORTERM` / `LANG` / `LC_ALL` | Terminal env setup. Not agent-specific. |
| `unset TMUX TMUX_PANE STY` | Prevents nested tmux warnings. Shell hygiene. |
| mkcert CA trust (`NODE_EXTRA_CA_CERTS`) | TLS setup for `pan.localhost`. |
| Keep-alive loop (`while true; do sleep 60; done`) | Planning agent stays alive after Claude exits. No frontmatter equivalent. |
| `script -qfaec` wrapper | Specialist dispatch capture. Shell-level wrapping. |
| Caveman exports | Compressed-output mode via env vars. |
| `CI=1` export | Claude Code non-interactive mode flag. |
| `GIT_SEQUENCE_EDITOR=false` | Block interactive rebase. |

### Hook Event Coverage Gap

Claude Code's per-agent `hooks:` frontmatter supports **only 3 events**:
- `PreToolUse`
- `PostToolUse`
- `Stop`

Panopticon's global `~/.claude/settings.json` registers hooks for **8 events**:
- `PreToolUse` ← can move to per-agent
- `PostToolUse` ← can move to per-agent
- `Stop` ← can move to per-agent
- `SessionStart` ← CANNOT move (not supported in frontmatter)
- `UserPromptSubmit` ← CANNOT move
- `PreCompact` ← CANNOT move
- `PostCompact` ← CANNOT move
- `Notification` ← CANNOT move
- `PermissionRequest` ← CANNOT move

**Consequence:** The `PANOPTICON_SESSION_TYPE` env-var-gating pattern in global hooks cannot be fully eliminated. Hooks for SessionStart, UserPromptSubmit, PreCompact, PostCompact, Notification, and PermissionRequest must remain global with env-var dispatch.

### Agent Teams: Out of Scope

Claude Code Agent Teams (shared task lists, teammate coordination) is **explicitly out of scope** for this PRD:

- Experimental feature, disabled by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
- No session resumption with in-process teammates
- One team per session, no nested teams, no leadership transfer
- File-locked task list reinvents what beads + tmux message delivery already do reliably
- Shutdown can be slow and task status can lag

Panopticon's tmux-based lifecycle + beads task tracking + sendKeysAsync message delivery is strictly more capable and battle-tested.

### `claude agents` Has No JSON Output

The `claude agents` subcommand outputs plain text only:
```
8 active agents

Project agents:
  codebase-explorer · haiku
  health-monitor · haiku
  planning-agent · sonnet
  triage-agent · haiku

Built-in agents:
  Explore · haiku
  general-purpose · inherit
  Plan · inherit
  statusline-setup · sonnet
```

Dashboard integration that needs to list configured agents must read `.claude/agents/*.md` files directly and parse YAML frontmatter, rather than relying on CLI output.

## Architecture: Three Injection Paths

Claude Code supports three ways to provide agent definitions:

### 1. Filesystem: `.claude/agents/<name>.md`
- Checked into repo → all workspace worktrees inherit
- Discoverable by `claude agents` listing
- Subagents (via `Agent` tool) auto-discover these
- **Best for**: Panopticon pipeline roles that are stable across issues

### 2. CLI JSON: `--agents '{"name":{...}}'`
- Injected at spawn time, no filesystem footprint
- Accepts same fields as markdown frontmatter
- **Best for**: Dynamic per-spawn overrides (e.g., injecting issue-specific context as `initialPrompt`)
- **Risk**: Shell quoting complexity for JSON with nested objects

### 3. Hybrid: Filesystem base + CLI `--model` override
- Base agent definition in `.claude/agents/`, model overridden at spawn
- `--model` flag supersedes frontmatter `model:`
- **Best for**: Same agent role with different models (e.g., work-agent at sonnet vs opus based on difficulty)

**Recommended approach:** Use filesystem definitions (path 1) as the base, with `--model` overrides (path 3) for dynamic model selection. Reserve `--agents` JSON injection (path 2) for edge cases where filesystem definitions don't fit.

## Proposed Agent Definitions

### Panopticon Pipeline Agents (NEW files)

These are distinct from the existing `.claude/agents/` subagent definitions (codebase-explorer, planning-agent, triage-agent, health-monitor) which are for Claude Code's `Agent` tool. Pipeline agents drive Panopticon's lifecycle.

| File | Role | Model | Permission Mode | Key Tools |
|------|------|-------|-----------------|-----------|
| `pan-work-agent.md` | Implementation | `sonnet` (default, overridden by `--model`) | `bypassPermissions` | All |
| `pan-planning-agent.md` | Discovery & vBRIEF | `sonnet` (default) | `bypassPermissions` | All |
| `pan-review-agent.md` | Code review | `opus` (default) | `plan` | Read, Grep, Glob, Bash (read-only) |
| `pan-test-agent.md` | Test execution | `sonnet` | `bypassPermissions` | All (needs Bash for test runs) |
| `pan-inspect-agent.md` | Per-bead spec verification | `sonnet` | `plan` | Read, Grep, Glob, Bash |
| `pan-uat-agent.md` | Browser verification | `sonnet` | `bypassPermissions` | All + Playwright MCP |
| `pan-merge-agent.md` | PR merge & cleanup | `sonnet` | `bypassPermissions` | All |

**Naming convention:** `pan-` prefix to distinguish Panopticon pipeline agents from Claude Code subagent definitions. Prevents confusion in `claude agents` listing.

### Example: `pan-work-agent.md`

```yaml
---
name: pan-work-agent
description: Panopticon implementation agent — autonomous coding with full tool access
model: sonnet
permissionMode: bypassPermissions
effort: high
hooks:
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: "/home/eltmon/.panopticon/bin/pre-tool-hook"
    - matcher: "Read"
      hooks:
        - type: command
          command: "/home/eltmon/.panopticon/bin/tldr-read-enforcer"
  PostToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: "/home/eltmon/.panopticon/bin/heartbeat-hook"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "/home/eltmon/.panopticon/bin/inspect-on-bead-close"
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "/home/eltmon/.panopticon/bin/tldr-post-edit"
  Stop:
    - hooks:
        - type: command
          command: "/home/eltmon/.panopticon/bin/stop-hook"
---

You are a Panopticon work agent...
```

### Hook Migration Matrix

| Hook Event | Current Location | Can Move to Agent Frontmatter? | Action |
|---|---|---|---|
| `PreToolUse` `.*` → pre-tool-hook | Global settings.json | Yes | Move to per-agent definitions |
| `PreToolUse` `Read` → tldr-read-enforcer | Global settings.json | Yes | Move to per-agent definitions |
| `PostToolUse` `.*` → heartbeat-hook | Global settings.json | Yes | Move to per-agent definitions |
| `PostToolUse` `.*` → permission-event-hook | Global settings.json | Yes | Move to per-agent definitions |
| `PostToolUse` `Bash` → inspect-on-bead-close | Global settings.json | Yes | Move to per-agent definitions |
| `PostToolUse` `Edit\|Write` → tldr-post-edit | Global settings.json | Yes | Move to per-agent definitions |
| `Stop` `.*` → stop-hook, permission-event-hook | Global settings.json | Yes | Move to per-agent definitions |
| `SessionStart` `.*` → session-start-hook | Global settings.json | **No** | Keep global, env-var gated |
| `UserPromptSubmit` `.*` → user-prompt-submit-hook | Global settings.json | **No** | Keep global, env-var gated |
| `PreCompact` → pre-compact-hook | Global settings.json | **No** | Keep global |
| `PostCompact` → post-compact-hook | Global settings.json | **No** | Keep global |
| `Notification` `.*` → notification-hook | Global settings.json | **No** | Keep global |
| `PermissionRequest` → permission-event-hook | Global settings.json | **No** | Keep global |

## Migration Plan

### Phase 1: Agent Definition Files

Create 7 `pan-*.md` files in `.claude/agents/`. Each file contains:
- YAML frontmatter with model, tools, permissionMode, and movable hooks
- Markdown body with the agent's system prompt / role description
- No implementation-specific context (that comes from vBRIEF/beads/continue.json)

### Phase 2: Launcher Integration

Modify `getAgentRuntimeBaseCommand()` and `generateLauncherScript()` to emit `--agent pan-work-agent` instead of hardcoding `--model` and `--dangerously-skip-permissions --permission-mode bypassPermissions`. The launcher script shrinks to:

```bash
#!/bin/bash
unset TMUX TMUX_PANE STY
export CI=1
export TERM=xterm-256color
export COLORTERM=truecolor
export LANG=C.UTF-8
command -v mkcert >/dev/null 2>&1 && export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
# Provider env (only for non-Anthropic models)
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN OPENAI_API_KEY ...
export ANTHROPIC_BASE_URL=...  # if non-Anthropic
export ANTHROPIC_AUTH_TOKEN=... # if non-Anthropic
# Panopticon identity
export PANOPTICON_AGENT_ID='agent-pan-982'
export PANOPTICON_ISSUE_ID='PAN-982'
export PANOPTICON_SESSION_TYPE='implementation'
export GIT_SEQUENCE_EDITOR=false
# Caveman exports (if enabled)
export CAVEMAN_MODE=full
# The command — now uses --agent instead of --model + --permission-mode
exec claude --agent pan-work-agent --model kimi-k2 --session-id 'abc123' "$prompt"
```

Key changes:
- `--agent pan-work-agent` replaces `--dangerously-skip-permissions --permission-mode bypassPermissions`
- `--model` override only added for non-Anthropic models (Anthropic models use agent frontmatter)
- Permission flags removed from baseCommand (now in agent definition)
- Tools restriction for review agent now in agent definition, not implicit

### Phase 3: Per-Agent Hook Migration

Move PreToolUse, PostToolUse, and Stop hooks from global `settings.json` into per-agent frontmatter. This eliminates env-var gating for those 3 event types.

**Before (global, env-var gated):**
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [{"type": "command", "command": "inspect-on-bead-close"}] }
    ]
  }
}
```
Hook script internally checks `PANOPTICON_SESSION_TYPE` to skip for non-work agents.

**After (per-agent):**
Only `pan-work-agent.md` gets the `inspect-on-bead-close` hook. Review/test/merge agents don't see it at all.

### Phase 4: Named Sessions (Optional Enhancement)

Use `--name agent-pan-982` when spawning to create human-readable Claude sessions. Benefits:
- `claude --resume agent-pan-982` for manual debugging
- Better session picker UI in `claude` interactive mode
- Session names visible in `claude agents` if running

This is additive — doesn't break anything.

### Phase 5: `pan plan draft` Command

New CLI command that spawns a planning agent using `--agent` instead of generating a full launcher script:

```bash
pan plan draft PAN-999
# Internally:
# 1. Creates workspace if needed
# 2. Spawns: claude --agent pan-planning-agent --name planning-pan-999 --session-id <uuid> "$prompt"
# 3. Uses thin launcher.sh for env vars only
```

### What Does NOT Change

- **tmux session management** — `createSessionAsync()` still creates tmux sessions
- **Message delivery** — `sendKeysAsync()` load-buffer/paste-buffer pattern unchanged
- **Agent state tracking** — `~/.panopticon/agents/<id>/` state files unchanged
- **Ready signal polling** — 30s timeout polling for Claude prompt unchanged
- **Prompt file delivery** — `$prompt` variable from file read unchanged
- **Hook FPP system** — `hook.json` pending work queue unchanged
- **Global hooks for non-frontmatter events** — SessionStart, UserPromptSubmit, etc. stay in `settings.json`
- **`claudish` wrapper** — Still needed for non-direct providers (Google, non-subscription OpenAI)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Per-agent hooks fire for user sessions too | User's ad-hoc `claude` sessions in workspace would trigger Panopticon hooks defined in agent .md files | `pan-*` prefix means user won't accidentally use `--agent pan-work-agent`. Hooks only fire when that specific agent is active. |
| `--agent` + `--resume` behavior changes in future Claude Code versions | Migration depends on agent config applying to resumed sessions | Pin minimum Claude Code version in `pan doctor` checks. Test in CI. |
| Agent definition files pollute `claude agents` listing | Users see 7+ Panopticon agents alongside their own | `pan-` prefix makes them visually distinct. Consider `~/.panopticon/agents/` as alternate location if Claude Code adds user-dir agent discovery. |
| Non-Anthropic models need both `--agent` AND `--model` | Dual-flag complexity | Only applies to ~20% of spawns (Kimi, CLIProxy). Document clearly. |
| Hook deduplication between global and per-agent | If global hooks aren't cleaned up, PreToolUse/PostToolUse fire twice | Phase 3 must remove migrated hooks from global `settings.json` atomically with agent definition deployment. |

## Dashboard Integration: Listing Configured Agents

Since `claude agents` has no JSON output, the dashboard must read agent definitions directly:

```typescript
// Read .claude/agents/*.md, parse YAML frontmatter
const agentFiles = glob.sync('.claude/agents/pan-*.md', { cwd: projectRoot });
for (const file of agentFiles) {
  const content = readFileSync(file, 'utf-8');
  const frontmatter = parseYamlFrontmatter(content);
  // { name, model, tools, permissionMode, hooks, ... }
}
```

This is more reliable than parsing CLI output and gives access to the full definition including hooks and MCP servers.
