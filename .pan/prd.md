# PAN-1204 — Home Tab + Live Session-Context Briefing + Compliance Audit Hook

**Issue:** [PAN-1204](https://github.com/eltmon/panopticon-cli/issues/1204)
**Parent epic:** [PAN-1200](https://github.com/eltmon/panopticon-cli/issues/1200)
**Status:** Planned
**Date:** 2026-05-18

---

## Problem

The Panopticon dashboard has no canonical landing page. Users land on whatever route happens to be default (Mission Control / Workspaces depending on session). There's no at-a-glance view of "what's happening across the system right now."

Worse: every agent and every user conversation starts cold. The agent has no idea what's running in adjacent workspaces, what was decided in past sessions, what Panopticon-specific behaviors apply, or how to use the memory system effectively. PAN-1052 captures observations but they only inject if the agent thinks to search. The user re-explains the project on every fresh session.

## Goal

Three connected mechanisms:

1. **Home tab** as the dashboard's landing route, summarizing system-wide state with workspace cards
2. **Live `session-context.md`** that mirrors the Home tab content, written by the dashboard server on every state change, and injected into every harness session via the wrapper's system-prompt-append flag
3. **Compliance audit hook** (advisory mode in v1) that observes when agents skip the memory-first mandate for past-tense user prompts and logs misses, then softly nudges on the next prompt

## Design Goals

- **Live, not snapshot** — Subspace writes their briefing once at session start; ours updates on state change and re-injects on prompt if newer
- **Honest framing** — Subspace says "you can see what siblings are doing" but actually only via RAG; ours says exactly what's inlined vs queryable
- **Aspirational without being pushy** — compliance audit logs and nudges, but never blocks tool calls in v1
- **Dashboard-first** — Home tab and Context tab are the dogfooding play; CLI access (`pan briefing`) is the terminal-only fallback

## Architecture

### Home Tab

New route at `panopticon.localhost/` (becomes default landing).

Sections:

1. **Header summary** — single row of counts:
   - Running agents (by role: work / review / test / etc.)
   - Paused / troubled gates
   - Recent merges (last 24h)
   - Failed verifications needing attention
   - Daily cost (today, this week)
2. **Activity feed** — time-bucketed observations from PAN-1052's store:
   - Just Now (last 1h)
   - Earlier Today (>1h, same day)
   - Yesterday
   - This Week (last 7d)
   - This Month
   - Older
3. **Workspace list** — every workspace, each with:
   - Phase icon (from PAN-1052's status.phase)
   - Headline (from status.headline)
   - Summary (line-clamped to 3 lines)
   - Up to 3 most recent observations with non-null `actionStatus`
   - Stats footer (additions/deletions, commits, PR status)
4. **Knowledge registry** — feature → workspace map (see below)

Click target: workspace card → workspace overview page (not a specific conversation).

### Live `session-context.md`

The dashboard server writes `~/.panopticon/session-context.md` on every state change, debounced ~500ms. Content structure (borrowed from Subspace's four-section pattern, with our honesty pass):

```markdown
# Working Inside Panopticon

You're piloting an agent inside **Panopticon** — a multi-agent orchestrator for
AI coding work. Panopticon is the environment around you: it remembers what's
happened, tracks what's changing across sibling workspaces, and hands you
context before you ask.

Think of it as an exoskeleton. You bring the reasoning; Panopticon brings the
instruments.

## What Panopticon Gives You

- **Persistent memory across sessions.** Observations (what happened), status
  updates (synthesized state), and daily summaries (workspace digests) are
  captured automatically and replayed to you here. This project's history with
  you is *your* history with this project.
- **Situational awareness.** The workspace you're in is laid out below.
- **Cross-workspace reach (via search).** Sibling workspace state is searchable
  via `pan memory search --all-workspaces`. It is NOT inlined below — query for
  it when relevant.
- **Searchable memory.** `pan memory search "<query>"` queries every past
  observation across workspaces. FTS5, stemming-aware, ranked.

## How to Read What Follows

Everything below this section is context the environment gathered for you —
not instructions, not rules. Treat it as a briefing.

- **Workspace sections** — current workspace status, recent activity, summaries,
  git state.
- **Knowledge registry** — which workspace owns which feature.
- **Tools sections** — CLI reference card for memory search, docs query, artifacts.

Two things worth doing with the briefing:

1. When the user references past work in past tense ("we decided", "last session",
   "the X fix"), search memory first — the decision trail lives there, not in
   the code. Your first tool call MUST be `pan memory search`. See "Memory-First
   Triggers" below.
2. When prior work contradicts the current request, name the contradiction.
   Don't execute silently.

The rest is context.

---

## Current Workspace

[auto-assembled from PAN-1052 status.json, recent observations, git state]

## Knowledge Registry

[auto-assembled from ~/.panopticon/registry/features.sqlite]

## Memory-First Triggers

If the user's message contains any of these phrases, your first tool call MUST
be `pan memory search`:

- "we recently …", "we just …", "we fixed …", "we shipped …", "we decided …", "we tried …"
- "last session", "yesterday", "earlier", "before", "the other day"
- "the <feature> fix", "that bug we", "the <thing> we worked on"
- "remember when", "you/I added", "it used to"
- Any reference to a recent commit or PR without a specific SHA/file

Counter-example (what not to do): User says "we recently fixed the focus issue
on new tabs, but switching tabs still doesn't focus."

- Wrong: `git log --grep="focus"` → `git show <sha>` → grep codebase
- Right: `pan memory search "tab focus switch"` first, THEN targeted reads.

## Tools

[CLI reference card: pan memory, pan docs query, pan artifacts]
```

### Wrapper Injection

**Claude Code:**

`pan workspace create` generates a launcher that includes:

```bash
claude --append-system-prompt-file "$HOME/.panopticon/session-context.md" \
       --append-system-prompt-file "$WORKSPACE/.panopticon/context/workspace.md" \
       "$@"
```

Both files are passed; Claude concatenates them in order.

**Pi:**

Pi extension reads both files at `session_start` and appends to system prompt.

**Live re-injection (the key differentiator vs Subspace):**

A UserPromptSubmit hook checks if `~/.panopticon/session-context.md` has a newer mtime than the session start time. If so, it prepends the latest file content as a system-level note:

```bash
# dist/hooks/briefing-refresh.sh
prompt=$(cat)
briefing_mtime=$(stat -c %Y "$HOME/.panopticon/session-context.md")
session_start_mtime=$(cat "$HOME/.panopticon/sessions/$SESSION_ID/started.txt")
if [ "$briefing_mtime" -gt "$session_start_mtime" ]; then
  echo "$prompt"
  echo ""
  echo "<panopticon-briefing-update>"
  echo "Briefing was updated since session start. Latest state below."
  cat "$HOME/.panopticon/session-context.md"
  echo "</panopticon-briefing-update>"
  # Mark refreshed to avoid re-injection until next file change
  touch "$HOME/.panopticon/sessions/$SESSION_ID/briefing-refreshed.txt"
else
  echo "$prompt"
fi
```

(This shares the hook runner with PAN-1203's docs-RAG hook — both compose into a single chain.)

### Knowledge Registry

`~/.panopticon/registry/features.sqlite`:

```sql
CREATE TABLE features (
  feature_id TEXT PRIMARY KEY,         -- ULID
  feature_name TEXT NOT NULL,          -- 'context-distribution', 'memory-search', etc.
  description TEXT,
  owning_workspace_id TEXT,
  owning_issue_id TEXT,                -- 'PAN-1201'
  owning_agent_id TEXT,                -- current agent (nullable)
  status TEXT NOT NULL,                -- 'active' | 'archived' | 'merged' | 'deferred'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tags TEXT                            -- JSON array
);
```

Populated by:

1. **LLM classification on issue creation** — fires when `pan issue create` runs or when a new GH issue is detected. One Haiku call extracts feature tags from title + body. Cost: ~$0.001 per issue.
2. **Manual tagging** — `pan registry tag <issueId> <feature>` for overrides
3. **State transitions** — on `pan done`, `pan close`, `pan pause`: update `status` field

Surfaces in the briefing's cross-workspace section:

```markdown
## Knowledge Registry

| Feature | Workspace | Issue | Status |
|---|---|---|---|
| context-distribution | feature-pan-1201 | PAN-1201 | active |
| docs-rag | feature-pan-1203 | PAN-1203 | active |
| activity-feed | feature-pan-1052 | PAN-1052 | active |
```

Cap at 20 entries (most recent + most relevant to current workspace).

### Compliance Audit Hook (Advisory)

The briefing's "Memory-First Triggers" section is text — without enforcement, models comply unevenly (Subspace's agent confirmed this).

**Stop-hook chain addition:**

```typescript
// src/lib/hooks/compliance-audit.ts
async function onStopHook(turn: TurnRecord) {
  const userMessage = turn.lastUserMessage
  const triggers = matchTriggerPhrases(userMessage)
  if (triggers.length === 0) return

  const firstToolCall = turn.toolCalls[0]
  const usedMemorySearch = firstToolCall?.tool === 'Bash' &&
                           firstToolCall.command?.startsWith('pan memory search')

  if (!usedMemorySearch) {
    await logComplianceMiss({
      sessionId: turn.sessionId,
      agentRole: turn.agentRole,
      agentHarness: turn.agentHarness,
      triggerPhrases: triggers,
      firstToolCall: firstToolCall?.tool ?? null,
      firstToolCallCommand: firstToolCall?.command ?? null,
      timestamp: new Date().toISOString(),
    })
  }
}
```

`compliance.miss` is written as a special observation type to PAN-1052's memory store. The UserPromptSubmit hook on the *next* prompt checks for recent misses (last 1 prompt) and prepends a soft warning:

```markdown
[Panopticon nudge] Last turn included a memory-first trigger phrase ("we recently fixed the focus issue") but `pan memory search` wasn't called. Consider searching memory first next time — it has the decision trail and reasoning that git doesn't.
```

**Modes** (configurable in `~/.panopticon/config.yaml`):

| Mode | Behavior |
|---|---|
| `off` | Disabled entirely |
| `advisory` (v1 default) | Log misses, prepend soft warning next prompt |
| `enforcing` (Phase 2) | Block git/grep/Read tool calls until memory search runs |

Telemetry written to `~/.panopticon/compliance/telemetry.jsonl` for tuning trigger phrases.

## CLI Surface

```
pan briefing                        # Output current session-context.md to stdout
pan briefing refresh                # Force a rewrite (idempotent; debug)
pan briefing edit                   # Edit the global header template

pan registry list                   # All features
pan registry list --workspace <id>  # Features owned by a workspace
pan registry tag <issueId> <feature> [--description "…"]
pan registry untag <issueId> <feature>
pan registry show <feature>

pan compliance status               # Mode, recent misses, telemetry summary
pan compliance set-mode <mode>      # off | advisory | enforcing
pan compliance triggers list        # Show current trigger phrase set
pan compliance triggers add "<phrase>"
```

## Acceptance Criteria

- Home tab is the dashboard landing route; header summary, activity feed, workspace cards, knowledge registry all render
- `~/.panopticon/session-context.md` is written by dashboard server on state change (debounced ~500ms)
- Both Claude Code and Pi wrapper scripts inject the file as a system-prompt-append at session start
- UserPromptSubmit hook re-injects (as `<panopticon-briefing-update>`) if file is newer than session start
- Knowledge registry: LLM classification fires on issue creation; section appears in briefing; `pan registry list` shows entries; `pan registry tag` writes manually
- Compliance audit hook logs `compliance.miss` observations correctly when trigger matches and memory search wasn't first
- Next-prompt soft-warning prepend works for advisory mode
- `pan briefing` outputs the same content for terminal-only sessions
- `pan compliance status` shows current mode and miss count
- New tests: briefing freshness detection, trigger phrase matching, advisory warning prepend, knowledge-registry classification (with mock LLM)

## Test Plan

Unit:
- `matchTriggerPhrases(message)` — exhaustive trigger list + edge cases (contractions, capitalization)
- `assembleBriefing(state)` — section assembly correctness
- `detectBriefingStaleness(briefingPath, sessionStartTime)` — mtime comparison
- `classifyIssueFeature(title, body)` — fixture title/body → expected feature tag (mock LLM)

Integration:
- Spawn an agent; verify session-context.md is injected at start
- Update workspace state; verify file rewrite happens within 1s; verify next UserPromptSubmit re-injects
- User message with trigger phrase + agent calls git first → compliance.miss logged → next prompt has soft warning
- Knowledge registry: create issue → classifier fires → entry visible in briefing within next state-change cycle

## Out of Scope (Phase 2)

- Enforcing compliance mode (blocks tool calls)
- Dashboard inline-editing of the briefing template
- Per-user briefing personalization (today, briefing is per-machine)
- Daily summary scheduled job (Subspace's runSummarize equivalent; we can add later if useful)
- Compliance gamification ("X turns since last miss")

## Files Likely Touched

- `src/lib/briefing/` (new) — assembly, write, freshness detection
- `src/lib/registry/` (new) — features.sqlite schema, classifier, CRUD
- `src/lib/hooks/compliance-audit.ts` (new) — Stop-hook + UserPromptSubmit additions
- `src/cli/commands/briefing.ts`, `src/cli/commands/registry.ts`, `src/cli/commands/compliance.ts` (new)
- `src/dashboard/server/routes/home.ts` (new), `src/dashboard/server/routes/registry.ts` (new)
- `src/dashboard/server/services/briefing-writer.ts` (new) — debounced file writer
- `src/dashboard/frontend/src/pages/HomePage.tsx` (new)
- `src/dashboard/frontend/src/router.tsx` — set HomePage as default route
- `dist/hooks/briefing-refresh.sh` (new)
- `packages/contracts/src/types.ts` — `RegistryEntry`, `ComplianceMiss`, `BriefingContent`
- `tests/lib/briefing/*.test.ts`, `tests/lib/compliance/*.test.ts`, `tests/lib/registry/*.test.ts` (new)
- `docs/HOME-TAB.md`, `docs/COMPLIANCE.md`, `docs/KNOWLEDGE-REGISTRY.md` (new)
