# PAN-277: SageOx Integration — Fork PR + Panopticon Wiring

## Problem Statement

SageOx (`ox`) captures session reasoning from Claude Code conversations — key decisions, trade-offs, "aha moments" — and makes them searchable via a web dashboard at sageox.ai. This is valuable for both human PRD planning sessions and agent implementation sessions.

However, two problems prevent integration:

1. **Devroot discovery**: SageOx assumes Claude Code starts from within a project directory. Panopticon uses a **devroot pattern** where Claude Code always starts from `~/Projects/` (the parent of all repos). SageOx's `FindProjectRoot()` walks UP from CWD, which fails when CWD is above the initialized repo.

2. **Recording is manual**: `ox agent prime` (the hook) only injects team context — it does NOT start session recording. Recording requires a separate explicit call to `/ox-session-start`. For Panopticon agents, there's no reliable way to ensure recording starts/stops with the agent lifecycle.

Additionally, SageOx should only be used for **Panopticon** (open source, freely shareable). MYN is a closed-source commercial product and must never have sessions uploaded to sageox.ai.

## Decisions Made

### D1: Per-project `.sageox/`, not devroot-level
`.sageox/` stays inside `panopticon-cli/` (Panopticon team on sageox.ai). NOT in devroot. NOT in MYN repos. This ensures project isolation and prevents commercial code from leaking.

### D2: Fork SageOx, contribute upstream PR
Rather than building native Panopticon features, contribute a PR to SageOx that adds explicit project root override and auto-recording. Benefits their project, solves our problem, supports the founder (Milkana Brace, known personally).

### D3: `OX_PROJECT_ROOT` env var is the primary mechanism
Simple, composable, works with any hook system. The hook in devroot sets this env var before calling `ox agent prime`. No marker files, no magic discovery.

### D4: `--project` flag as explicit alternative
For CLI usage and debugging: `ox agent prime --project /path/to/repo`. Same precedence as env var but more explicit.

### D5: `--auto-record` flag on `ox agent prime`
Combines context injection + session recording start into a single command. Panopticon's hook becomes one call instead of two separate steps. This is the key enabler for reliable agent session capture.

### D6: Server-side summarization is SageOx's value
SageOx's `POST /api/v1/session/summarize` provides structured LLM summarization (title, key decisions, aha moments, chapters, outcome assessment). This is their likely monetization path — the prompt template is open source but inference + dashboard are SaaS. We consume this, not rebuild it.

### D7: Two SageOx teams, one active
- **Panopticon** team on sageox.ai — active, used for all Panopticon sessions
- **Mind Your Now** team — created accidentally during initial `ox init`, should be ignored/deleted
- MYN repos never get `ox init`

### D8: Two POC use cases, same infrastructure
Both use identical capture/summarization pipeline:
1. **Agent tradeoff capture** (primary) — review what decisions agents made during implementation
2. **PRD planning sessions** (secondary) — capture reasoning behind product decisions

### D9: Multi-agent issue pipeline uses parent-child session linking
Panopticon issues go through up to 5 agents: planner → worker → reviewer → tester → merger. SageOx already has parent-child session linking via `subagents.jsonl`. The planner session acts as the "parent" and all subsequent specialist sessions report as subagents. Each session gets an `--issue` tag for grouping.

### D10: `--issue` flag for external issue tracking
Add an `--issue PAN-279` flag to `ox agent session start` (and to `--auto-record`). Stored as `ExternalIssueID` in session metadata. Enables filtering "show me all sessions for PAN-279" — the planner's planning, the worker's implementation tradeoffs, the reviewer's concerns, the tester's diagnostics, and the merger's conflict resolution.

## Architecture

### Session Lifecycle (Current SageOx Design)

Recording and context injection are **independent** lifecycles:

```
SessionStart hook fires → ox agent prime (context injection ONLY)
                          ↓
                          Team context injected into Claude Code
                          Agent ID assigned (SAGEOX_AGENT_ID env var)
                          NO recording started

User/agent explicitly runs → /ox-session-start skill
                             ↓
                             ox agent <id> session start
                             .recording.json created
                             Adapter watches JSONL file

User/agent explicitly runs → /ox-session-stop skill
                             ↓
                             ox agent <id> session stop
                             Session processed (redact, summarize, generate HTML)
                             Files saved locally
                             Upload to ledger (future: auto-push)
```

### The Problem With Agent Sessions

Panopticon agents don't know to call `/ox-session-start`. The session lifecycle is:

```
Panopticon creates agent → starts Claude Code in worktree
  → SessionStart hook fires ox agent prime ✓ (context injected)
  → Agent works on implementation...
  → Agent finishes, Claude Code exits
  → NO session was ever recorded ✗
```

### How It Works After Fork PR

```
Panopticon creates agent → starts Claude Code in worktree
  → SessionStart hook fires: ox agent prime --auto-record
  → Context injected AND recording started in one call ✓
  → Agent works on implementation...
  → Claude Code Stop hook fires: ox agent <id> session stop
  → Session processed, summarized, uploaded ✓
  → Summary appears on sageox.ai dashboard ✓

Human PRD session from devroot:
  → SessionStart hook fires: OX_PROJECT_ROOT=.../panopticon-cli ox agent prime --auto-record
  → Context injected, recording started ✓
  → Human iterates on PRD with Claude...
  → Stop hook fires: ox agent <id> session stop
  → Reasoning captured, browsable on sageox.ai ✓
```

### Session Classification (Already Solved)

Claude Code JSONL paths tell us session type without any code:
- `~/.claude/projects/-home-eltmon-Projects/` → human session from devroot
- `~/.claude/projects/-home-eltmon-Projects-panopticon-cli-workspaces-feature-pan-*` → agent session

SageOx captures both. The sageox.ai dashboard lets you browse/search them.

### Multi-Agent Issue Pipeline

A single Panopticon issue (e.g., PAN-279) goes through up to 5 agents sequentially. Each runs in its own Claude Code session, each makes different kinds of decisions:

| Phase | Agent | Decisions Worth Capturing |
|-------|-------|--------------------------|
| **Planning** | Planner | Architectural choices, scope decisions, what to include/exclude, PRD structure |
| **Implementation** | Worker | Library choices, edge case handling, approaches tried & abandoned, performance tradeoffs |
| **Review** | Reviewer | Code concerns raised, patterns flagged, what was acceptable vs needs changes |
| **Testing** | Tester | Failure diagnosis, test strategy, which edge cases to cover |
| **Merge** | Merger | Conflict resolution, final integration checks |

SageOx's existing parent-child model maps naturally to this:

```
Issue PAN-279 on sageox.ai:

Planner Session (parent)
├── Title: "PAN-279: Planning — convoy auto-synthesis"
├── Key Decisions: chose EventEmitter over polling, scoped to 3 files
├── Duration: 12 min
│
├── Subagent: Worker Session
│   ├── Title: "PAN-279: Implementation"
│   ├── Key Decisions: used existing EventEmitter, skipped caching layer
│   ├── Aha: "specialist outputs already structured — no LLM re-synthesis needed"
│   └── Duration: 47 min
│
├── Subagent: Review Session
│   ├── Title: "PAN-279: Review"
│   ├── Key Decisions: flagged missing error handling on emit(), approved after fix
│   └── Duration: 8 min
│
├── Subagent: Test Session
│   ├── Title: "PAN-279: Testing"
│   ├── Key Decisions: added timeout test for hung specialists, all 12 tests pass
│   └── Duration: 15 min
│
└── Subagent: Merge Session
    ├── Title: "PAN-279: Merge"
    ├── Key Decisions: clean merge, no conflicts
    └── Duration: 3 min

Total issue duration: 85 min | 5 sessions | 37 key decisions captured
```

**How Panopticon wires this:**

1. Planner starts → hook fires `ox agent prime --auto-record --issue PAN-279 --title "PAN-279: Planning"`
2. Planner finishes → Stop hook fires `ox session stop` → planner session saved, gets a session path
3. Worker starts → hook fires with `--parent-session <planner-session-path> --issue PAN-279 --title "PAN-279: Implementation"`
4. Worker finishes → Stop hook fires → worker reports as subagent to planner via `ReportSubagentComplete()`
5. (Repeat for reviewer, tester, merger — each reports to planner as parent)
6. On sageox.ai: all 5 sessions linked under PAN-279, planner shows aggregated subagent list

Panopticon already tracks the issue ID and specialist phase. It passes these as `--issue` and `--title` to the hooks.

### What You See on sageox.ai After a Full Issue Workflow

After PAN-279 goes through all 5 agents, you browse sageox.ai and see:

```
Panopticon Team → Sessions → Filter: PAN-279

┌─────────────────────────────────────────────────────────────────┐
│ 📋 PAN-279: Convoy auto-synthesis                               │
│ 5 sessions | Total: 85 min | Feb 28, 2026                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ▸ Planning (12 min)                                             │
│   Researched specialist output formats, decided on EventEmitter │
│   approach over polling. Scoped to 3 files: convoy.ts,          │
│   synthesis.ts, types.ts.                                       │
│   Key: "Polling adds 200ms latency per specialist — unacceptable│
│   for 5+ specialist convoys"                                    │
│                                                                 │
│ ▸ Implementation (47 min)                                       │
│   Built synthesis engine using EventEmitter. Tried concat-first │
│   approach, then switched to structured merge after discovering  │
│   specialists use inconsistent heading levels.                   │
│   💡 "Specialist outputs already have structured sections —     │
│      no need for LLM re-synthesis, just normalize headings"     │
│   Key: Skipped caching layer — premature for current sizes      │
│                                                                 │
│ ▸ Review (8 min)                                                │
│   Flagged missing error handling on emit() for hung specialists. │
│   Approved after worker added timeout + retry logic.             │
│                                                                 │
│ ▸ Testing (15 min)                                              │
│   Added 12 tests including timeout scenario. Discovered edge     │
│   case: empty specialist output crashes concat. Fixed with       │
│   null guard.                                                    │
│                                                                 │
│ ▸ Merge (3 min)                                                 │
│   Clean merge to main, no conflicts. CI passed.                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

This gives you the **full decision trail** for the issue — from "why did we choose this approach" (planning) through "what tradeoffs were made" (implementation) to "what concerns were raised" (review) and "what broke" (testing).

## Scope: The SageOx Fork PR

### Change 1: `OX_PROJECT_ROOT` env var (LOW risk)

**File: `internal/config/project_config.go`**

Add env var check at the top of `FindProjectRoot()`:

```go
func FindProjectRoot() string {
    // NEW: explicit override for devroot/multi-repo workflows
    if override := os.Getenv("OX_PROJECT_ROOT"); override != "" {
        resolved := expandAndResolve(override)
        if IsInitialized(resolved) {
            return resolved
        }
    }

    // Existing walk-up logic unchanged...
    cwd, err := os.Getwd()
    // ...
}
```

~10 lines of Go. Non-breaking.

**File: `cmd/ox/agent.go`**

Same change to the duplicate `findProjectRoot()` function (lines 257-278). Or better: refactor both callers to use `config.FindProjectRoot()` and eliminate the duplicate.

### Change 2: `--project` flag on `ox agent prime` (LOW risk)

**File: `cmd/ox/agent_prime.go`**

```go
var agentPrimeProjectFlag string

func init() {
    agentPrimeCmd.PersistentFlags().StringVar(&agentPrimeProjectFlag,
        "project", "", "Explicit project root (overrides CWD discovery)")
}

// In runAgentPrime():
projectRoot := agentPrimeProjectFlag
if projectRoot == "" {
    projectRoot = os.Getenv("OX_PROJECT_ROOT")
}
if projectRoot == "" {
    projectRoot, err = findProjectRoot()
}
```

~15 lines. Clean precedence: flag > env var > walk-up.

### Change 3: `--issue` flag on session start and auto-record (LOW risk)

**File: `cmd/ox/agent_session.go`** + **`internal/session/recording.go`**

Add `ExternalIssueID` to `RecordingState` and `SessionMeta`, with a `--issue` CLI flag:

```go
// In RecordingState:
ExternalIssueID string `json:"external_issue_id,omitempty"` // e.g., "PAN-279"

// In agent_session.go:
agentSessionCmd.PersistentFlags().StringVar(&issueFlag,
    "issue", "", "External issue ID for grouping (e.g., PAN-279, MIN-663)")
```

When `--auto-record` is used with `--issue`, the issue ID flows through to recording state and session metadata. Enables filtering sessions by issue on sageox.ai.

~15 lines across 2 files.

### Change 4: `--auto-record` flag on `ox agent prime` (MEDIUM risk)

**File: `cmd/ox/agent_prime.go`**

After successful prime, automatically call `session.StartRecording()`. Passes through `--issue`, `--title`, and `--parent-session` if provided:

```go
var (
    agentPrimeAutoRecord  bool
    agentPrimeIssue       string
    agentPrimeTitle       string
    agentPrimeParent      string
)

func init() {
    agentPrimeCmd.PersistentFlags().BoolVar(&agentPrimeAutoRecord,
        "auto-record", false, "Automatically start session recording after prime")
    agentPrimeCmd.PersistentFlags().StringVar(&agentPrimeIssue,
        "issue", "", "External issue ID (e.g., PAN-279)")
    agentPrimeCmd.PersistentFlags().StringVar(&agentPrimeTitle,
        "title", "", "Session title")
    agentPrimeCmd.PersistentFlags().StringVar(&agentPrimeParent,
        "parent-session", "", "Parent session path (for subagent linking)")
}

// After successful prime output:
if agentPrimeAutoRecord {
    _, err := session.StartRecording(projectRoot, session.StartRecordingOptions{
        AgentID:           agentID,
        AdapterName:       "Claude Code",
        SessionFile:       sessionFile,
        Username:          username,
        Title:             agentPrimeTitle,
        ExternalIssueID:   agentPrimeIssue,
        ParentSessionPath: agentPrimeParent,
    })
    if err != nil {
        slog.Warn("auto-record failed", "error", err)
    }
}
```

~30 lines. Uses existing `session.StartRecording()` Go API. The `--parent-session` flag enables Panopticon to chain specialist sessions: planner is parent, worker/reviewer/tester/merger are subagents.

### Change 5: Session adapter project root hint (MEDIUM risk)

**File: `internal/session/adapters/claude_code.go`**

`FindSessionFile()` computes the JSONL directory from CWD. When `OX_PROJECT_ROOT` points elsewhere, the path won't match. Accept optional project root for hash computation:

```go
func (a *ClaudeCodeAdapter) FindSessionFile(agentID string, opts ...FindOption) (string, error) {
    projectRoot := a.projectRoot  // NEW: set from OX_PROJECT_ROOT
    if projectRoot == "" {
        projectRoot, _ = os.Getwd()
    }

    projectHash := computeProjectHash(projectRoot)
    projectDir := filepath.Join(projectsDir, projectHash)

    // Also check CWD hash as fallback
    cwdHash := computeProjectHash(cwd)
    // Search both directories for matching agentID...
}
```

~30 lines. Needs tests for dual-path search.

### Change 6: Stop hook support (LOW risk)

The Claude Code `Stop` hook event should trigger `ox agent <id> session stop`. This may already be possible via `.claude/settings.local.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "command": "if command -v ox >/dev/null 2>&1 && [ -n \"$SAGEOX_AGENT_ID\" ]; then ox agent $SAGEOX_AGENT_ID session stop 2>&1 || true; fi"
      }
    ]
  }
}
```

If `SAGEOX_AGENT_ID` is available as an env var in the Stop hook context, this works without any Go changes. Need to verify.

### Change 7: Tests + Documentation

- Unit tests for `FindProjectRoot()` with `OX_PROJECT_ROOT`
- Unit test for `--project` flag
- Unit test for `--auto-record` flag
- Integration test for session file found via project root hint
- Update `CLAUDE.md` with devroot workflow section
- Add env vars to `ox agent prime --help`

## Scope: Panopticon Wiring (After PR Merged)

### Hook Configuration

**For human sessions (devroot):**

The devroot hook (managed by PAN-266 mechanism) sets `OX_PROJECT_ROOT` and enables auto-record:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "command": "if command -v ox >/dev/null 2>&1; then OX_PROJECT_ROOT=/home/eltmon/Projects/panopticon-cli AGENT_ENV=claude-code ox agent prime --auto-record --idempotent 2>&1 || true; fi"
      }
    ],
    "Stop": [
      {
        "command": "if command -v ox >/dev/null 2>&1 && [ -n \"$SAGEOX_AGENT_ID\" ]; then OX_PROJECT_ROOT=/home/eltmon/Projects/panopticon-cli ox agent $SAGEOX_AGENT_ID session stop 2>&1 || true; fi"
      }
    ]
  }
}
```

**For agent sessions (worktrees):**

Panopticon sets environment variables when spawning agents. The worktree-level hooks read them:

```bash
# Panopticon sets these env vars when creating the agent's Claude Code session:
export PAN_ISSUE_ID="PAN-279"
export PAN_PHASE="implementation"          # planning|implementation|review|testing|merge
export PAN_PARENT_SESSION="/path/to/planner/session"  # empty for planner
```

The worktree hook template uses these:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "command": "if command -v ox >/dev/null 2>&1; then ox agent prime --auto-record --issue \"$PAN_ISSUE_ID\" --title \"$PAN_ISSUE_ID: ${PAN_PHASE^}\" --parent-session \"$PAN_PARENT_SESSION\" --idempotent 2>&1 || true; fi"
      }
    ],
    "Stop": [
      {
        "command": "if command -v ox >/dev/null 2>&1 && [ -n \"$SAGEOX_AGENT_ID\" ]; then ox agent $SAGEOX_AGENT_ID session stop 2>&1 || true; fi"
      }
    ]
  }
}
```

**Session chaining for multi-agent pipeline:**

```
1. Planner starts:
   ox agent prime --auto-record --issue PAN-279 --title "PAN-279: Planning"
   → Recording starts, planner session path saved

2. Planner finishes:
   ox agent <id> session stop
   → Session processed + uploaded. Panopticon captures the session path.

3. Worker starts (Panopticon passes planner's session path):
   ox agent prime --auto-record --issue PAN-279 --title "PAN-279: Implementation" \
     --parent-session /path/to/planner/session

4. Worker finishes:
   ox agent <id> session stop
   → Worker reports as subagent to planner session via ReportSubagentComplete()

5. (Repeat for reviewer, tester, merger — all report to planner as parent)

Result: sageox.ai shows all 5 sessions linked under PAN-279
```

### Commit `.sageox/` in panopticon-cli

Currently staged but uncommitted. After confirming Panopticon team:

```bash
cd ~/Projects/panopticon-cli
cat .sageox/config.json | jq .team_id
# Verify Panopticon team, not Mind Your Now
git add .sageox/
git commit -m "Initialize SageOx for session capture (Panopticon team)"
```

### Agent Lifecycle Integration

Panopticon's cloister (agent lifecycle manager) needs to:

1. **Pass env vars to agent sessions** — `PAN_ISSUE_ID`, `PAN_PHASE`, `PAN_PARENT_SESSION`
2. **Capture planner session path** — when planner's `ox session stop` runs, Panopticon reads the session path from the output and stores it for subsequent agents
3. **Chain subsequent agents** — each specialist gets `--parent-session` pointing to the planner's session

This is lightweight — it's env vars passed through `createSession()` in `agents.ts`, not new API calls.

## Files to Modify (SageOx PR)

| File | Change | Risk |
|------|--------|------|
| `internal/config/project_config.go` | Add `OX_PROJECT_ROOT` env var check to `FindProjectRoot()` | LOW |
| `cmd/ox/agent_prime.go` | Add `--project`, `--auto-record`, `--issue`, `--title`, `--parent-session` flags | MEDIUM |
| `cmd/ox/agent.go` | Same env var check in duplicate `findProjectRoot()`, or refactor | LOW |
| `cmd/ox/agent_session.go` | Add `--issue` flag to session start | LOW |
| `internal/session/recording.go` | Add `ExternalIssueID` to `RecordingState` and `StartRecordingOptions` | LOW |
| `internal/session/metadata.go` | Add `ExternalIssueID` to `SessionMeta` | LOW |
| `internal/session/adapters/claude_code.go` | Accept project root hint for JSONL path computation | MEDIUM |
| `CLAUDE.md` | Document devroot workflow, env var, auto-record, issue linking | LOW |
| Tests for above | New test cases | LOW |

## Files to Modify (Panopticon Side)

| File | Change | Risk |
|------|--------|------|
| Devroot hooks (via PAN-266 mechanism) | Add `OX_PROJECT_ROOT` + `--auto-record` + `--issue` + Stop hook | LOW |
| `.sageox/config.json` | Verify Panopticon team, commit | LOW |
| `src/lib/agents.ts` (or cloister) | Pass issue ID + parent session path to hook env vars | LOW |

## Documentation Draft: How SageOx Integration Works

*(For Panopticon docs — `docs/sageox-integration.md`)*

### Overview

Panopticon integrates with [SageOx](https://sageox.ai) to capture session reasoning from both human planning sessions and agent implementation sessions. After a session ends, structured summaries — key decisions, trade-offs, "aha moments" — are browsable on the SageOx dashboard.

### What Gets Captured

**Human PRD sessions** (from devroot):
- Your back-and-forth reasoning while iterating on a PRD with Claude
- Why you chose approach B over approach A
- The context behind architectural decisions
- Searchable later when revisiting old decisions or onboarding

**Agent implementation sessions** (from worktrees):
- Trade-off decisions the agent made during coding (chose library X over Y)
- Approaches tried and abandoned
- Edge cases the agent considered
- Useful for code review — understand WHY code looks the way it does

**Full issue pipelines** (5 agents per issue):
- Planning, implementation, review, testing, and merge sessions linked together
- See the complete decision trail from "why this approach" to "what broke in testing"
- All sessions grouped by issue ID (e.g., PAN-279)

### How It Works

1. **SageOx is initialized per-project** — `.sageox/` lives in the project repo, associated with a team on sageox.ai
2. **Claude Code hooks fire automatically** — when a session starts (human or agent), `ox agent prime --auto-record` injects team context and begins recording
3. **When the session ends** — the `Stop` hook calls `ox session stop`, which processes the session (redacts secrets, generates summary) and uploads to sageox.ai
4. **Browse on sageox.ai** — structured summaries with key decisions, aha moments, and chapter titles

### Setup

```bash
# One-time: install ox CLI
# (already at ~/.local/bin/ox)

# One-time: initialize project
cd ~/Projects/panopticon-cli
ox init  # associates with team on sageox.ai

# Commit the initialization
git add .sageox/
git commit -m "Initialize SageOx for session capture"
```

Hooks are managed by Panopticon's devroot hook system (PAN-266). No manual hook configuration needed.

### Constraints

- **Panopticon only** — MYN and other closed-source projects are never initialized with SageOx
- **Secrets are redacted** — SageOx strips API keys, tokens, passwords before upload
- **Sessions are per-team** — only Panopticon team members see Panopticon sessions

### Architecture

```
Claude Code session (human or agent)
  ↓ SessionStart hook
ox agent prime --auto-record
  ↓ finds .sageox/ (via OX_PROJECT_ROOT or walk-up)
  ↓ injects team context + starts recording
  ↓ watches Claude Code JSONL file
  ... session happens ...
  ↓ Stop hook
ox agent <id> session stop
  ↓ reads JSONL, redacts secrets
  ↓ POST /api/v1/session/summarize (SageOx server)
  ↓ structured summary returned
  ↓ saved locally + uploaded to team ledger
Browse at sageox.ai → Panopticon team → Sessions
```

## Email Draft: Milkana

```
Subject: SageOx + Panopticon integration — PR incoming

Hi Milkana,

I've been exploring SageOx for my project Panopticon (open source multi-agent
orchestrator — github.com/eltmon/panopticon-cli) and I'm really impressed with
the session capture architecture. The server-side summarization especially —
the structured aha moments and chapter titles are exactly what I need.

I have two workflow patterns that need small additions to ox:

1. DEVROOT WORKFLOW: I launch Claude Code from a parent directory (~/Projects/)
   rather than from inside individual repos. This breaks FindProjectRoot()
   since it walks up from CWD and doesn't find .sageox/ in child repos.

2. MULTI-AGENT PIPELINES: Panopticon runs 5 agents per issue — planner,
   worker, reviewer, tester, merger — each in its own Claude Code session.
   I need sessions to start/stop automatically and be linked by issue ID.

I've forked the repo and have a PR that adds:

• OX_PROJECT_ROOT env var — checked before walk-up in FindProjectRoot().
  Lets orchestrators explicitly specify the project root.

• --project flag on `ox agent prime` — same thing as a CLI flag.
  Precedence: --project > OX_PROJECT_ROOT > walk-up (existing).

• --auto-record flag on `ox agent prime` — combines context injection with
  session recording start in one call. Essential for automated workflows
  where there's no human to run /ox-session-start.

• --issue flag on session start — tags sessions with an external issue ID
  (e.g., "PAN-279"). With --parent-session, links all 5 agent sessions for
  an issue into a parent-child chain using your existing subagent model.

• Session adapter project root hint — so FindSessionFile() can locate JSONL
  files when CWD differs from the project root.

All changes are backward-compatible. Tests included.

The result: after an issue goes through all 5 agents, I browse sageox.ai and
see the complete decision trail — why the planner chose this approach, what
tradeoffs the worker made, what the reviewer flagged, what broke in testing.
Your existing parent-child session linking + subagent aggregation maps
perfectly to this.

Same pipeline captures my human planning sessions from devroot too. Two use
cases, zero additional infrastructure.

Would love to chat more — happy to walk through the PR before submitting.

Best,
Edward
```

## Out of Scope

- **MYN integration** — MYN is closed source, no SageOx
- **Native session summarization in Panopticon** — use SageOx's server-side summarization
- **Collaborative PRD refinement** — separate feature, different mechanism
- **Retroactive batch processing of historical sessions** — future work
- **`.ox-devroot` marker file** — over-engineered, env var is sufficient

## Open Questions

1. **Should the SageOx PR also refactor the duplicate `findProjectRoot()`?** — `cmd/ox/agent.go:257` duplicates `internal/config/project_config.go:318`. Refactoring to one function is cleaner but increases diff size. Recommendation: include it, it's a clear improvement.

2. **Team cleanup** — The "Mind Your Now" team on sageox.ai was created during initial exploration. Should it be deleted, or left dormant?

3. **Hook placement** — PAN-266 is redesigning devroot hooks. The SageOx hooks should integrate with whatever mechanism PAN-266 establishes.

4. **Stop hook env var availability** — Does `SAGEOX_AGENT_ID` persist in the Claude Code `Stop` hook context? If not, the Stop hook needs another way to find the agent ID (e.g., reading `.recording.json`).

5. **Auto-upload on session stop** — Currently `ox session stop` processes locally but doesn't auto-upload. Should the PR add `--auto-upload` or leave that as a separate step? Recommendation: include it — the whole point is fire-and-forget for agents.

6. **Planner session path capture** — When the planner agent's `ox session stop` runs, Panopticon needs to capture the session path from its output to pass as `--parent-session` to subsequent agents. Where does Panopticon store this? Recommendation: in the workspace state alongside the agent metadata.

7. **Dashboard filtering by issue** — The `--issue` flag stores `ExternalIssueID` in session metadata, but sageox.ai needs a frontend filter to actually use it. Is this something the SageOx team would build, or is it a feature request for later? For the POC, title-based visual scanning works.

8. **PR size** — With `--issue`, `--parent-session`, `--auto-record`, `OX_PROJECT_ROOT`, and `--project`, this is getting to ~150 LOC. Consider splitting into two PRs: (a) project root override, (b) auto-record + issue linking. Recommendation: one PR — the changes are cohesive and the SageOx team benefits from seeing the full use case.
