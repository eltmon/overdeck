# PAN-611: Caveman Integration — Agent Output Token Reduction

## Problem Statement

Output tokens are the dominant cost driver for long-running Overdeck agents. Work, review, test, and merge agents generate substantial prose narration — status updates, reasoning, code explanations — that no one reads in real-time. This narration is burned on every bead, every inspection cycle, every specialist wake. Caveman compresses that narration ~65-75% while keeping full technical accuracy and leaving code, commands, and structured output untouched.

## Requirements

### Must Have

- Caveman hook JS files installed at `~/.panopticon/hooks/caveman/` (one-time setup, part of `pan up` or `pan install`)
- Caveman hooks injected into each workspace's `.claude/settings.json` at workspace creation time, based on config
- Per-agent-type intensity configured via `~/.panopticon/config.yaml` (and per-project `.panopticon.yaml` override)
- `CAVEMAN_DEFAULT_MODE` env var set at agent spawn time so caveman reads the right intensity from day one
- Planning agents excluded entirely (no hooks injected for planning sessions)
- Inspect agent excluded entirely — its `INSPECTION PASSED` / `INSPECTION BLOCKED` sentinel strings are parsed by Cloister and must not be compressed
- Three hard-rule overrides injected into each agent's caveman context block:
  1. STATE.md updates always use full prose (crash recovery depends on readable structured format)
  2. `.planning/feedback/` files written at full prose (work agents read these to understand what to fix)
  3. Code, commits, and tool call arguments written normal (already in caveman spec, reinforce here)
- Config toggle: `enabled: false` turns caveman off globally with zero workspace changes needed
- A/B testing: `ab_test: true` randomly assigns new workspaces to enabled/disabled at creation; `caveman_variant` stored in workspace metadata and cost events

### Should Have

- Dashboard Experiments view: cost-per-workspace split by `caveman_variant` (token totals + review-pass-rate-first-try)
- `pan caveman-compress <file>` manual CLI command (wraps the Python compress script) for compressing static reference docs — NOT automated
- Statusline shows `[CAVEMAN]` / `[CAVEMAN:FULL]` in agent tmux panes when active

### Out of Scope

- caveman-compress in any automated pipeline (Python + recursive API calls — too risky for autonomous agents)
- Applying caveman-compress to workspace CLAUDE.md, STATE.md, or any workspace artifact
- caveman-commit skill (commit message format is already handled by our conventions)
- 文言文 / wenyan modes (interesting but not useful for English-speaking review of agent output)
- Per-bead intensity switching mid-session (mode is set at session start, fixed for the session)

## Design

### Hook Architecture (Option B — native caveman design)

Caveman uses a `SessionStart` hook + `UserPromptSubmit` hook, not prompt injection. This is the right approach for Overdeck because:

1. Rules are in context from turn 1, before any task prompt
2. Mid-session switching works (`pan tell <agent> "/caveman lite"` becomes a real lever)
3. Statusline integration works out of the box
4. No pollution of workspace CLAUDE.md or specialist prompts
5. The global flag file (`~/.claude/.caveman-active`) is not a collision risk for Overdeck — autonomous agents never issue `/caveman` mode commands; all agents boot with the same configured intensity

**Hook files location:** `~/.panopticon/hooks/caveman/`
- `caveman-activate.js` — SessionStart hook (from JuliusBrussee/caveman repo)
- `caveman-mode-tracker.js` — UserPromptSubmit hook

**Workspace settings.json injection** (when caveman enabled, at workspace creation):
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{"type": "command", "command": "node ~/.panopticon/hooks/caveman/caveman-activate.js", "timeout": 5}]
    }],
    "UserPromptSubmit": [{
      "hooks": [{"type": "command", "command": "node ~/.panopticon/hooks/caveman/caveman-mode-tracker.js", "timeout": 5}]
    }]
  }
}
```

**Per-agent intensity via env var:** At agent spawn in `specialists.ts`, set `CAVEMAN_DEFAULT_MODE` in the process environment. Caveman's config resolution: env var → config file → `'full'`. Planning agent and inspect agent simply don't receive the hooks.

### Config Schema

```yaml
# ~/.panopticon/config.yaml
agents:
  caveman:
    enabled: true          # master switch
    ab_test: false         # true = random 50/50 per new workspace
    work: full             # lite | full | ultra | disabled
    review: caveman-review # separate review skill
    test: full
    planning: disabled     # always disabled — planning output is user-facing
    merge: full
```

Per-project override in `.panopticon.yaml` uses the same schema; project config wins over global.

### Hard-Rule Caveman Override Block

Each agent's caveman context must include this override, injected alongside the standard caveman skill via the SessionStart hook's output (or appended to the caveman SKILL.md content that gets emitted):

```
## Overdeck Overrides (non-negotiable)

STATE.md updates: ALWAYS use full prose with exact section headers (## Status, ## Current Phase, ## Completed Work, ## Remaining Work, ## Key Decisions, ## Specialist Feedback). Crash recovery depends on this format.

.planning/feedback/ files: ALWAYS write at full prose. The work agent that reads this file needs complete context to understand what to fix.

Code, commits, tool arguments: always normal (already in your rules — reinforced here).
```

### caveman-review for Review Agent

The review agent uses the `caveman-review` skill rather than the standard caveman. From the source:
```
Format: L<line>: <problem>. <fix>.
Severity: 🔴 bug / 🟡 risk / 🔵 nit / ❓ q
```

This applies to the review agent's **dashboard API response** (the JSON payload it POSTs). The `.planning/feedback/` file it writes must still be full prose per the override rule above.

### A/B Testing

At workspace creation:
1. If `ab_test: true`, randomly assign `enabled` or `disabled`
2. Store `caveman_variant: "enabled" | "disabled" | "off"` in workspace metadata
3. Pass `caveman_variant` to the cost event recorder (already runs at session end)
4. Dashboard Experiments tab: group workspaces by variant, show median output tokens/session and first-try review pass rate

## Technical Notes

### Verification: Do hooks fire for Overdeck agent sessions?

Overdeck spawns agents via Claude Code CLI running interactively in tmux (identity-wake prompt sent via paste-buffer). `SessionStart` hooks fire for interactive Claude Code sessions. **This must be verified as the first step of implementation** — run a test workspace with a SessionStart hook that writes a marker file; confirm the marker appears when the agent session starts.

### Hook file sourcing

The caveman hook JS files (`caveman-activate.js`, `caveman-mode-tracker.js`) must be downloaded from `https://github.com/JuliusBrussee/caveman` at install time. Pin to a specific commit hash to avoid breaking changes. Store the pinned version in Overdeck config.

### Workspace settings.json merge

Existing workspaces may already have a `.claude/settings.json` (from TLDR or other hooks). The injection must MERGE, not overwrite. Use deep merge on the `hooks` key.

### caveman-compress (manual only)

The Python script at `caveman-compress/scripts/` calls Claude API/CLI recursively with a 500KB file limit. Safe to use manually on static docs (project-level CLAUDE.md, long READMEs). Expose as `pan caveman-compress <file>` — a thin CLI wrapper that runs the Python script. Never call from automated pipeline code.

## References

- Source repo: https://github.com/JuliusBrussee/caveman (read all 91 files including hooks, SKILL.md, compress scripts, evals)
- Benchmark: 65-75% output token reduction on conversational tasks; expect 40-50% for tool-heavy autonomous agents
- Research paper cited in README: brevity constraints improved accuracy by 26pp on certain benchmarks
- Related issue: PAN-591 (Karpathy guidelines) — shares A/B infrastructure; implement PAN-611 first

## Open Questions

- Exact commit hash to pin for caveman hook files (resolve at implementation start)
- Whether `caveman-review` skill content should be a separate downloaded file or inlined
- Whether `pan install` is the right command name or if it hooks into `pan up`
