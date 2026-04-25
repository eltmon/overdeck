# PAN-798: Remaining Research & Audits

This document tracks all open questions, incomplete audits, and research needed before PAN-798 can move to implementation.

---

## 1. Complete Pattern Audit

**Status:** ✅ **COMPLETE** — see `PAN-798-audit.md` (Part 2: Detailed Pattern Breakdown)  
**Owner:** Research agent (completed 2026-04-22)  
**Deliverable:** `PAN-798-audit.md`

**Key findings:**
- 20 pattern-scanning locations across 12 files
- 70+ distinct patterns/regexes
- 7 call sites that capture but do NOT scan (raw return/save/display)
- 4 high-risk patterns: `confirmDelivery()` (false positive risk), `checkLazyAgent()` (34 regexes), `parseThinkingDuration()` (format fragility), `checkStuckWorkAgents()` (dialog misfire risk)
- `health.ts:91` and `health-filtering.ts:13` do NOT scan patterns — they just return raw output. Their consumers may or may not scan that output downstream.

**Unresolved questions from audit:**
- Do the consumers of `health.ts`/`health-filtering.ts` raw output scan it for patterns? If so, those are additional pattern-scanning sites not counted in the 20.
- `mission-control.ts:297` filters specialist output by issueId mentions — is this filtering logic still needed if we move to JSONL?

---

## 2. Hook Reliability Root Cause (PAN-759)

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Fix or documented workaround

`ready.json` and `runtime.json` hooks are written by bash scripts triggered on `SessionStart` and `PostToolUse`. There are tmux fallbacks (`waitForReadySignal`, `waitForClaudePrompt`) because the hooks sometimes fail to fire.

**The audit found `waitForClaudePrompt()` is called from 6 sites:**
- `src/lib/agents.ts:1401`
- `src/lib/cloister/specialists.ts:2436`
- `src/lib/cloister/specialists.ts:2459`
- `src/dashboard/server/routes/conversations.ts:560`
- `src/dashboard/server/routes/conversations.ts:613`
- `src/dashboard/server/routes/conversations.ts:969`

Research needed:
- Why do hooks miss? Is it a race condition between tmux session creation and hook registration?
- Is it a permissions issue (bash hook not executable)?
- Is it a tmux session name mismatch?
- Is it a Claude Code version change that broke hook invocation?
- Can we make hooks fire reliably 100% of the time, or do we need an alternative signal mechanism?
- Do dashboard server routes (`conversations.ts`) have the same hook reliability issue as CLI-spawned agents?

**This blocks removal of ALL `waitForClaudePrompt()` call sites (6 total) and `waitForReadySignal()`.**

---

## 3. `messageReceived` Sequence Counter Feasibility

**Status:** Open — **higher uncertainty after audit**  
**Owner:** Pending  
**Deliverable:** Decision + implementation plan

`confirmDelivery()` verifies delivery by checking 14 processing patterns in tmux output (`●`, `⎿`, `Read`, `thinking`, `API Error`, etc.). The audit flagged this as **high risk** for false positives.

The proposed replacement is a `messageReceived` sequence counter in `runtime.json`.

Research needed:
- Does Claude Code have a hook that fires when stdin is read / a message is received?
- If not, can we detect "message received" from `PostToolUse` (which fires after the tool completes, not when the message arrives)?
- Is `messageReceived` the right abstraction, or should we use `processing: boolean` that the hook sets when a turn starts and clears when it returns to prompt?
- What happens if multiple messages are sent in rapid succession?
- **NEW:** If `confirmDelivery()` is high-risk for false positives today, is it even providing value? Could we simply delete it and trust `sendKeysAsync`?
- **NEW:** The `load-buffer` + `paste-buffer` + 300ms delay pattern (per `.claude/rules/async-tmux.md`) is already reliable. Do we need delivery confirmation at all?

**This blocks removal of `confirmDelivery()` and specialist delivery confirmation.**

---

## 4. `activity` Field Granularity

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Final enum values

The spec proposes `activity: 'bash' | 'read' | 'write' | 'edit' | 'thinking' | 'idle' | null`.

The audit found `checkLazyAgent()` uses 17 active-status patterns: `/computing/i`, `/fermenting/i`, `/thinking/i`, `/reading/i`, `/writing/i`, `/editing/i`, `/searching/i`, `/running/i`, `/executing/i`, `/tool use/i`, `/\bBash\b/`, `/\bRead\b/`, `/\bWrite\b/`, `/\bEdit\b/`, `/\bGrep\b/`, `/\bGlob\b/`, `/\bTask\b/`.

Research needed:
- What are all the tool types Claude Code uses? (`Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `WebSearch`, etc.)
- Does Deacon's `isAgentActiveInTmux()` need to distinguish between "active because reading a file" vs "active because running bash"? Or is `state === 'active'` sufficient?
- Does the dashboard need tool-type granularity, or just active/idle?
- Should `activity` be the raw tool name, or a coarse category?
- **NEW:** `checkLazyAgent()` uses 17 lazy patterns. Can these all collapse to `state === 'waiting-on-human'` with a `waitingReason`, or do we need more nuance?

**This determines the exact `activity` enum values and whether `waitingReason` needs structured categories.**

---

## 5. Thinking Duration Detection Without tmux

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Hook extension or alternative mechanism

Deacon parses "Thinking… (Xm Ys)" from tmux text to detect stuck agents. The spec proposes `thinkingSince` timestamp.

The audit found `parseThinkingDuration()` uses regex `/(?:[Tt]hinking|[Ff]ermenting)[^\n]*?\((?:(\d+)m\s*)?(\d+)s/` and is **high risk** because it depends on Claude Code's exact status text format.

Research needed:
- Can the PostToolUse hook detect when a thinking block starts vs ends?
- Is "thinking" a tool use (`Thinking` tool) or a pre-tool-use state?
- If the hook only fires after tool completion, can we infer thinking duration from the gap between `lastActivity` timestamps?
- Is there a reliable signal for "Claude is currently thinking" vs "Claude is idle at prompt"?
- **NEW:** The audit shows `isAgentActiveInTmux()` special-cases `thinking|fermenting` → duration check. If `thinkingSince` is in `runtime.json`, do we still need `activity === 'thinking'` as a separate field?

**This blocks removal of thinking duration parsing in Deacon.**

---

## 6. Interactive Dialog Detection (exclude-from-context)

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Hook extension or alternative intervention strategy

Deacon detects the "exclude from context" dialog by searching tmux text for `"Do you want to make this edit to exclude"` and `"Esc to cancel"` + `"Tab to amend"`. It then sends `Escape` to dismiss it. The audit flagged this as **medium risk** for misfiring.

Research needed:
- Can the hook system detect when Claude Code enters an interactive dialog state?
- Is there a way to disable this dialog globally (e.g., `--no-exclude-prompt` flag)?
- If not, can we intercept it via a pre-configured `.claudeignore` to prevent the dialog from appearing?
- If hooks can't detect it, is it acceptable to let the agent sit in `waiting-on-human` state and alert the user?
- **NEW:** The audit found `checkLazyAgent()` also looks for `"What would you like"` and prompt indicators (`$`, `#`, `>`). Are these all the same dialog, or different interactive states?

**This blocks removal of dialog detection in Deacon.**

---

## 7. Review Agent Result Markers

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Structured result protocol

`review-agent.ts` regex-matches status markers from tmux output: `REVIEW_RESULT:`, `FILES_REVIEWED:`, `SECURITY_ISSUES:`, `PERFORMANCE_ISSUES:`, `NOTES:`.

The audit found:
- These markers are printed to stdout by the review agent itself
- No human-readable fallback exists (unlike merge-agent)
- The markers populate a `ReviewResult` object

Research needed:
- Can the review agent write structured results to `review-results.json` instead of printing markers to stdout?
- Is `review_status` in SQLite already the correct destination? If so, why does `parseAgentOutput()` also scan tmux?
- Are there other consumers of these markers besides `review-agent.ts`?
- What is the exact list of all markers and their meanings?
- **NEW:** If the review agent is a Claude Code session like any other, can it write to a file via a tool call, or does it need a post-processing step?

**This blocks removal of review result marker parsing.**

---

## 8. Health Check Output Requirements

**Status:** Open — **refined after audit**  
**Owner:** Pending  
**Deliverable:** Decision on structured vs transcript

`health.ts:91` and `health-filtering.ts:13` capture tmux output but **do NOT scan patterns** — they return raw output as-is.

**NEW question from audit:** Do the consumers of this raw output scan it for patterns? If so, those are additional pattern-scanning sites not counted in the 20.

Research needed:
- What decisions are made based on health check output? (kill stuck agent? alert user?)
- Are health checks only interested in "is agent responsive?" (already in `runtime.json.state`)
- Or do they need to see recent error output (API errors, rate limits)?
- If error detection is needed, should errors be written to `runtime.json.lastError` by hooks?
- **NEW:** Who calls `getAgentOutput()` and `checkAgentHealthAsync()`? Do those callers parse the raw text they receive?

**This determines whether health checks need anything beyond `runtime.json`.**

---

## 9. WebSocket Terminal Ring Buffer Design

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Design doc or PR

The WebSocket terminal needs an in-memory ring buffer to replace `captureFreshSnapshot` and `captureViewportSnapshot`.

Research needed:
- What is the current PTY hub memory layout? (`activePtyHubs` Map)
- Can we attach a ring buffer to each hub entry without significant memory overhead?
- Should the buffer store raw bytes (for ANSI sequences) or parsed lines?
- How many lines should it hold? (500 is current tmux default)
- How to handle buffer eviction when a hub is destroyed?
- Should the buffer be accessible only to the PTY hub, or also to other consumers?

**This blocks removal of the two WebSocket tmux captures.**

---

## 10. JSONL Session File Format & Access

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Parser/reader utility

ActivityView and agent output endpoints would read from JSONL session files instead of tmux.

Research needed:
- What is the exact schema of JSONL entries? (tool_use, tool_result, user_message, assistant_message, etc.)
- Are there existing parsers for this format in the codebase?
- How to efficiently tail/render recent entries without reading the entire file?
- How to map a tmux session name to its JSONL file path?
- What is the performance of reading large JSONL files (10MB+)?
- **NEW:** The audit found `mission-control.ts:297` filters specialist output by issueId mentions. If we move to JSONL, do specialists write separate JSONL files per issue, or do we filter a shared file?

**This blocks dashboard transcript migration.**

---

## 11. Specialist Event File Protocol

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Schema definitions

Merge and test specialists need to write structured event files (`git-events.jsonl`, `test-results.json`).

The audit found the merge agent uses BOTH structured markers (`MERGE_RESULT:`, etc.) AND human-readable fallback patterns (`"merge task complete"`, `"successfully merged"`, etc.).

Research needed:
- What git operations does the merge agent actually need to track? (push, force-push, rejected, merge conflict, etc.)
- What test metrics does the merge agent need? (passed, failed, skipped, duration, failed test names)
- Should these be JSONL append-only files or single JSON files overwritten per run?
- How does the merge agent discover the event file path?
- Are there existing structured output conventions in the specialist code?
- **NEW:** Can specialists (which are Claude Code sessions) write files directly, or do they need a post-processing wrapper?
- **NEW:** The merge agent polls tmux for 15 minutes in `resolveConflictsWithAgent()`. Can it poll for `merge-results.json` file existence instead?

**This blocks removal of merge-agent tmux captures.**

---

## 12. Heartbeat File Deprecation Plan

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Migration + cleanup

Heartbeat JSON files (`~/.panopticon/heartbeats/<id>.json`) would be eliminated, with `lastActivity` moving to `runtime.json`.

Research needed:
- What writes heartbeat files? (`src/cli/commands/setup/hooks.ts`?)
- What reads them? (`claude-code.ts`, `deacon.ts`, `mission-control.ts`)
- Is the heartbeat timestamp different from `runtime.json.lastActivity`? (e.g., heartbeat is PostToolUse, lastActivity might be different)
- Can we safely redirect all heartbeat readers to `runtime.json` without data loss?
- What is the cleanup strategy for orphaned heartbeat files?

**This blocks removal of heartbeat JSON files.**

---

## 13. Backwards Compatibility During Migration

**Status:** Open  
**Owner:** Pending  
**Deliverable:** Migration strategy

We cannot flip a switch and break all consumers at once.

Research needed:
- Can we run old and new paths in parallel during transition?
- Should `capturePaneAsync` calls be replaced with structured reads that fall back to tmux during migration?
- How long is the migration window?
- Do we need feature flags or gradual rollout?
- What is the testing strategy to ensure no regressions?
- **NEW:** Given the high-risk patterns (false positives in `confirmDelivery`, format fragility in `parseThinkingDuration`), is the risk of keeping tmux higher or lower than the risk of a rushed migration?

**This blocks implementation sequencing.**

---

## 14. `confirmDelivery()` Value Assessment

**Status:** Open — **new question from audit**  
**Owner:** Pending  
**Deliverable:** Decision to keep, replace, or delete

The audit flagged `confirmDelivery()` as **high risk** for false positives. It checks 14 patterns in tmux output to verify delivery. If any pattern exists in pre-existing pane content, delivery is falsely confirmed.

Research needed:
- Has `confirmDelivery()` ever actually caught a real delivery failure?
- What is the false positive rate? (i.e., how often does it return `true` when the message was NOT actually processed?)
- If we remove it entirely and trust `sendKeysAsync` + 300ms delay, what breaks?
- Is there telemetry or logging we can check to evaluate its effectiveness?
- **Alternative:** Instead of `messageReceived`, could we use a simpler `processing: boolean` in `runtime.json` that the hook sets when Claude starts a turn and clears when it returns to prompt?

**This blocks P2 delivery confirmation removal.**

---

## 15. Lazy Pattern Simplification

**Status:** Open — **new question from audit**  
**Owner:** Pending  
**Deliverable:** Decision on pattern count vs structured state

`checkLazyAgent()` uses 17 lazy regexes to detect agents avoiding work:
- `"what would you like me to do"`
- `"options:"`
- `"should I (continue|proceed|stop)"`
- `"this would take \d+-\d+ hours"`
- `"estimated \d+ hours"`
- `"manual intervention"`
- `"requires human"`
- `"stop here"`
- `"deferred to future"`
- `"future PR"`
- `"follow-up issue"`
- `"documented for later"`
- `"remaining work documented"`
- `"targeted approach"`
- `"infrastructure.*complete.*tests.*fail"`

Research needed:
- Can ALL of these collapse to `state === 'waiting-on-human'` with a generic `waitingReason`?
- Or do we need structured categories like `needs_clarification`, `scope_deferral`, `time_estimate_rejection`, etc.?
- Does the Deacon take different actions for different lazy patterns? (e.g., send different anti-lazy messages)
- If all lazy patterns trigger the same `sendAntiLazyMessage()`, then a single `waitingOnHuman` flag is sufficient.

**This blocks P1 Deacon lazy detection removal.**

---

## Summary Table

| # | Research Item | Blocks | Estimated Effort | Status |
|---|---------------|--------|------------------|--------|
| 1 | Complete pattern audit | — | 2-3h | ✅ Complete |
| 2 | Hook reliability (PAN-759) | P2 readiness removal (6 call sites) | 4-8h | ✅ Finding documented; fix spec'd, not implemented |
| 3 | `messageReceived` feasibility | P2 delivery removal | 2-4h | Open |
| 4 | `activity` granularity | P1 Deacon health | 1-2h | Open |
| 5 | Thinking duration detection | P1 stuck detection | 2-3h | Open |
| 6 | Dialog detection/intervention | P1 stuck detection | 2-4h | Open |
| 7 | Review result markers | P3 review agent migration | 2-3h | Open |
| 8 | Health check requirements | P1 health removal | 1-2h | Open |
| 9 | WebSocket ring buffer design | P4 terminal snapshot | 3-5h | Open |
| 10 | JSONL format & access | P3 dashboard transcripts | 2-3h | Open |
| 11 | Specialist event file protocol | P3 merge agent | 2-3h | Open |
| 12 | Heartbeat deprecation | Heartbeat removal | 1-2h | Open |
| 13 | Backwards compatibility | Implementation start | 2-3h | Open |
| 14 | `confirmDelivery()` value assessment | P2 delivery removal | 1-2h | **NEW** |
| 15 | Lazy pattern simplification | P1 Deacon lazy detection | 1-2h | **NEW** |

---

## Results

### #2 — Hook Reliability Root Cause (PAN-759)

- **Finding:** The SessionStart hook that was supposed to write `ready.json` **simply did not exist**. Evidence:
  - `src/cli/commands/setup/hooks.ts:151` lists the hook scripts to install: `['pre-tool-hook', 'heartbeat-hook', 'stop-hook', 'specialist-stop-hook', ...]` — `session-start-hook` was NOT in this list
  - `hooksAlreadyConfigured()` at line 93 only checks `['PreToolUse', 'PostToolUse', 'Stop']` — `SessionStart` was not checked
  - The settings.json registration code (lines 256-322) registers PreToolUse, PostToolUse, and Stop hooks, but NEVER registers a SessionStart hook
  - This is why `src/lib/agents.ts:263` correctly states "ready.json is currently not written by any hook (PAN-759)" — there was no hook to write it
  - This is NOT a race condition, permissions issue, or Claude Code version breakage — it's a missing installation/registration step

- **Decision:** 
  1. **Root cause identified** — Hooks were never unreliable; the SessionStart hook was simply never created or registered
  2. **Fix required before implementation** — Create `scripts/session-start-hook` (follow pattern of existing hooks: agent ID from `$PANOPTICON_AGENT_ID` or tmux session name, write `ready.json` with `{"ready":true}`)
  3. **Update `src/cli/commands/setup/hooks.ts`** to:
     - Add `'session-start-hook'` to the `hookScripts` array (line 151)
     - Add `SessionStart` to `hooksAlreadyConfigured()` check (line 93)
     - Add settings.json registration block for `settings.hooks.SessionStart` (after Stop block, ~line 322)
  4. **Existing agents will need to re-run `pan setup hooks`** to get the new hook registered in their Claude Code settings.json
  5. Once registered, `waitForReadySignal()` will receive `ready.json` immediately on session start, making the tmux fallback unnecessary
  6. The `waitForClaudePrompt()` call sites can be migrated to use `waitForReadySignal()` (or the ready.json check directly) once the hook is confirmed firing reliably in practice

- **Impact:** 
  - **Unblocks P2 readiness removal** — all 6 `waitForClaudePrompt()` call sites can be migrated once the fix is implemented
  - `waitForReadySignal()` (agents.ts:244) will work as designed — no more tmux fallback needed for session readiness
  - Dashboard routes (`conversations.ts`) and specialist flows can trust the hook signal
  - **Action required:** Implement the missing SessionStart hook and registration, then test on a fresh agent

---

### #3 — messageReceived Sequence Counter Feasibility

- **Finding:** 
  - `confirmDelivery()` (tmux.ts:559) checks 14 patterns: `●`, `⎿`, `Read`, `✻`, `✶`, `✽`, `✢`, `Generating`, `thinking`, `thought for`, `Retrying in`, `API Error`, `"You've hit your limit"`, `Tool use`
  - It compares pane output before/after message send and returns `true` if ANY pattern appears in new output
  - **High false-positive risk:** if any processing pattern exists in pre-existing pane content (e.g., scrollback shows "API Error" from prior work), `confirmDelivery()` returns `true` even if the NEW message was never processed
  - **No evidence of value:** Git history shows multiple "delivery" and "prompt detection" fixes (commits ca745cf8, 8b4622b0, f325518a, 256e5438) but no tests validating effectiveness. No telemetry or logs show `confirmDelivery()` ever catching real failures
  - **The load-buffer + paste-buffer + 600ms delay pattern (async-tmux.md) is already reliable** — sendKeysAsync() waits dynamically (600-3000ms based on message size) before sending Enter, so raw delivery is effectively guaranteed

- **Decision:** 
  1. **Recommend deletion, not replacement** — If `confirmDelivery()` has never caught a real failure and has false-positive risk, the load-buffer pattern alone is sufficient
  2. If you want structured delivery confirmation, use a simpler mechanism:
     - Hook writes `messageReceived: <sequence>` immediately after Claude reads stdin (may require PreToolUse hook)
     - Sender polls `runtime.json.messageReceived` and compares sequence number
     - This is more reliable than regex and has no false positives
  3. If replacement is required: option B is `processing: boolean` (hook sets true at turn start, clears at prompt return) — simpler than sequence counter

- **Impact:**
  - **Unblocks P2 delivery removal** if deletion is approved; sequence counter adds complexity without clear value
  - Removing `confirmDelivery()` simplifies: `specialists.ts:2484,2495` delivery confirmation, removes 14-pattern regex maintenance
  - False-positive risk to delivery detection is eliminated

---

### #4 — activity Field Granularity

- **Finding:**
  - Deacon's 17 ACTIVE_STATUS_PATTERNS (deacon.ts:822-840): `/computing/i`, `/fermenting/i`, `/thinking/i`, `/reading/i`, `/writing/i`, `/editing/i`, `/searching/i`, `/running/i`, `/executing/i`, `/tool use/i`, `/\bBash\b/`, `/\bRead\b/`, `/\bWrite\b/`, `/\bEdit\b/`, `/\bGrep\b/`, `/\bGlob\b/`, `/\bTask\b/`
  - These patterns cover: Claude Code's status line (computing, fermenting, thinking, tool use) + specific tool names (Bash, Read, Write, Edit, Grep, Glob, Task)
  - Dashboard and health checks only need **binary active/idle**, not tool-type granularity
  - Hook granularity varies: PostToolUse hook can detect which tool was called, but Claude Code's status display shows aggregated states ("computing", "thinking") not individual tool names
  - The 17 active patterns don't distinguish between tool types meaningfully for Deacon purposes

- **Decision:**
  1. **Simplified activity enum:** `'computing' | 'thinking' | 'idle' | null` (3 values, not tool-specific)
  2. Rationale:
     - Hook sees tool names (Bash, Read, Edit) but Deacon doesn't need that granularity
     - Dashboard displays status (Active, Thinking, Idle) — no tool breakdown needed
     - Keeps runtime.json schema simple and stable (tool names may change)
  3. Alternative: keep tool names in hook output but aggregate to coarse `activity` value in runtime.json
  4. The distinction between "computing" vs tool-specific states is handled by `currentTool` field if dashboard needs it later

- **Impact:**
  - **Unblocks P1 Deacon health removal** — `isAgentActiveInTmux()` simplifies to `runtime.json.activity !== 'idle'`
  - Eliminates need to enumerate all 17 patterns in production code
  - Hook writes simpler enum; no regex parsing in Deacon

---

### #5 — Thinking Duration Detection Without tmux

- **Finding:**
  - `parseThinkingDuration()` (deacon.ts:935-944) parses regex `/(?:[Tt]hinking|[Ff]ermenting)[^\n]*?\((?:(\d+)m\s*)?(\d+)s/`
  - Stuck threshold is 10 minutes (deacon.ts:917: `const STUCK_THINKING_THRESHOLD_MS = 10 * 60 * 1000`)
  - If thinking duration ≥ 10m, Deacon sends Escape (attempt 1), Ctrl+C (attempt 2), or respawns (attempt 3+) (deacon.ts:1032-1068)
  - **Key insight:** Thinking is already a **visible status**, not a pre-tool-use state — Claude Code displays "Thinking… (Xm Ys)" in the status line when a thinking block is running
  - **Alternative mechanism exists:** If `thinkingSince` timestamp is in `runtime.json`, can compute duration via `Date.now() - new Date(thinkingSince)` — no parsing needed
  - **Hook extension required:** PostToolUse hook must set `thinkingSince = now` when thinking starts, clear it when thinking completes

- **Decision:**
  1. **Add `thinkingSince: string | null` to runtime.json** (ISO 8601 timestamp)
  2. Hook populates it: set when thinking block starts, clear when exits back to prompt
  3. Deacon compares `Date.now() - new Date(runtime.json.thinkingSince)` to threshold
  4. **Problem:** Hook only fires on PostToolUse, not mid-thinking. Solution: hook should detect thinking state from Claude's status output and set/clear `thinkingSince` accordingly
  5. Eliminate `parseThinkingDuration()` regex entirely

- **Impact:**
  - **Unblocks P1 stuck detection** — no regex parsing, deterministic timestamp-based detection
  - Removes fragility: if Claude Code changes status format, stuck detection won't break
  - Requires hook extension to detect thinking state (may require reading Claude Code's status bar text, which we're trying to eliminate)

---

### #6 — Interactive Dialog Detection (exclude-from-context)

- **Finding:**
  - `checkStuckWorkAgents()` (deacon.ts:989-991) detects exclude dialog with: `.includes('Do you want to make this edit to exclude')` AND (`.includes('Esc to cancel')` AND `.includes('Tab to amend')`))
  - When detected, sends Escape to dismiss (deacon.ts:993-996)
  - **This dialog is a Claude Code UI state**, not agent output — it blocks stdin waiting for user input
  - **Alternative:** Hook system can detect this by checking if Claude Code is in a dialog state (not currently done)
  - **Workaround:** Pre-configure `.claudeignore` to prevent the dialog, or add Claude Code CLI flag to disable it (if available)
  - **Current behavior:** Simple `.includes()` works but is fragile if dialog text changes

- **Decision:**
  1. **Hook-based detection (preferred):** Extend hook system to detect interactive dialog states and set `runtime.json.waitingOnHuman = true` with `waitingReason = "exclude-from-context"`
  2. **If hooks can't detect:** Pre-configure `.claudeignore` to prevent the dialog from appearing (investigate Claude Code `--no-exclude-prompt` or equivalent flag)
  3. **Fallback:** Keep the `.includes()` checks but add more robust detection (dialog must have ALL three strings, not just two)
  4. **Action:** If detected as waiting-on-human, alert the user rather than auto-dismiss (safer than sending Escape)

- **Impact:**
  - **Unblocks P1 stuck detection dialog handling** if hook extension is viable
  - If pre-configuration via `.claudeignore` works, removes need for runtime detection entirely
  - Safer than auto-dismiss (which could interrupt legitimate interactions)

---

### #7 — Review Agent Result Markers

- **Finding:**
  - `parseAgentOutput()` (review-agent.ts:139) scans for: `REVIEW_RESULT:`, `FILES_REVIEWED:`, `SECURITY_ISSUES:`, `PERFORMANCE_ISSUES:`, `NOTES:`
  - These markers are printed to stdout by the review specialist (Claude Code session) itself
  - No human-readable fallback exists (unlike merge-agent which has fallback patterns)
  - Review results are stored in SQLite's `review_status` table
  - **Specialists are Claude Code sessions** — they can write files via tool calls (Write tool)

- **Decision:**
  1. **Review specialist writes `review-results.json`** instead of printing markers to stdout:
     ```json
     {
       "result": "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED",
       "filesReviewed": ["src/foo.ts", "src/bar.ts"],
       "securityIssues": ["SQL injection in query builder"],
       "performanceIssues": ["N+1 in loop"],
       "notes": "Overall looks good but fix these security issues",
       "timestamp": "2026-04-22T..."
     }
     ```
  2. Dashboard/review-agent.ts reads this file instead of parsing stdout
  3. No fallback needed — structured file is authoritative

- **Impact:**
  - **Unblocks P3 review agent migration** — removes stdout pattern parsing
  - Simplifies review agent code (no need to write markers)
  - Enables reviewers to write detailed notes without formatting constraints

---

### #8 — Health Check Output Requirements

- **Finding:**
  - `getAgentOutput()` (health.ts:91) captures N lines from tmux and returns trimmed raw text (no pattern scanning)
  - `checkAgentHealthAsync()` (health-filtering.ts:13) captures 5 lines and returns `{alive, lastOutput}`
  - **Callers identified:** agents.ts (status route), health-filtering.ts (dashboard health API), misc.ts (health endpoint)
  - **Downstream parsing:** Callers return this raw output to dashboard/APIs; dashboard does NOT scan for patterns (it displays raw text in UI)
  - **Actual health determination:** Already happens via `runtime.json.state` and `runtime.json.lastActivity` (health-filtering.ts:38-121 shows this)
  - Raw `lastOutput` is only used for: displaying last terminal output in UI (informational only)

- **Decision:**
  1. **Replace raw output with `runtime.json` data:**
     - Determine health from: `state`, `lastActivity`, `lastError` (if defined)
     - Return structured health object: `{status: 'healthy'|'warning'|'stuck', reason: string}`
  2. **For "last output" display:** Tail the JSONL session file (last 5 tool results) instead of tmux capture
  3. **Error tracking:** If needed, hook writes `runtime.json.lastError` on API failures

- **Impact:**
  - **Unblocks P1 health removal** — no tmux involvement
  - Health checks already implement logic correctly (reading runtime.json); just need to formalize interface

---

### #9 — WebSocket Terminal Ring Buffer Design

- **Finding:**
  - PTY hub (`ws-terminal.ts`) spawns `node-pty` and streams output to WebSocket clients
  - Current snapshot capture: `captureFreshSnapshot()` (ws-terminal.ts:89) calls `capturePaneAsync()` for 500 lines
  - Ring buffer would attach to: `activePtyHubs` Map entry, one buffer per PTY session
  - Raw bytes vs parsed lines: Raw bytes preserve ANSI escape sequences (needed for terminal colors/styles)
  - Buffer size: 500 lines matches current tmux default; reasonable for UI scroll history

- **Decision:**
  1. **Attach ring buffer to each PTY hub entry:**
     ```typescript
     interface PtyHubEntry {
       pty: PtyProcess;
       ws?: WebSocket;
       ringBuffer: RingBuffer<Uint8Array>;  // Fixed 500-line FIFO
     }
     ```
  2. **Capture raw bytes** (preserve ANSI) — no parsing overhead
  3. **Buffer lifecycle:** Populate on `pty.onData()`, serve on WebSocket connect via `onSnapshot()` route
  4. **Eviction:** Buffer auto-drops oldest lines when 501st line arrives; cleaned up when hub destroyed

- **Impact:**
  - **Unblocks P4 WebSocket snapshot removal** — two tmux captures eliminated
  - Memory overhead: minimal (500 lines × ~100 bytes avg = 50KB per PTY)
  - Faster initial snapshot (in-memory, not subprocess)

---

### #10 — JSONL Session File Format & Access

- **Finding:**
  - JSONL files are at `~/.claude/projects/<project>/<session>.jsonl`
  - Schema (inferred from Claude Code docs): one JSON object per line, types include:
    - `tool_use`: `{type: 'tool_use', tool: string, input: object}`
    - `tool_result`: `{type: 'tool_result', result: string, error?: string}`
    - `user_message`: `{type: 'user_message', content: string}`
    - `assistant_message`: `{type: 'assistant_message', content: string}`
  - **Large files problem:** Reading entire 10MB JSONL for "last 50 messages" is inefficient
  - **Session name → JSONL path:** Must infer from agent ID (e.g., `agent-pan-123` → look in `~/.claude/projects/*/` for `.jsonl` files matching pattern)
  - **Specialists:** Each specialist Claude Code session has its own JSONL file in the session directory

- **Decision:**
  1. **Tailing strategy:** Read file from end, scan backwards for newlines until reaching desired message count (avoid reading full file)
  2. **Path resolution:** Store JSONL path in `runtime.json.jsonlPath` when agent starts (hook writes this)
  3. **Filtering for specialists:** Don't filter by issueId (each specialist works on single issue); read full session JSONL
  4. **Performance:** Cache recently-read JSONL metadata (line count, last-read position) for fast incremental reads

- **Impact:**
  - **Unblocks P3 dashboard transcripts** — ActivityView renders from JSONL instead of tmux
  - Eliminates `mission-control.ts:161,297` tmux captures (2 call sites)
  - Removes issueId filter logic — specialists already know their context

---

### #11 — Specialist Event File Protocol

- **Finding:**
  - Merge agent uses: stdout markers (`MERGE_RESULT:`, etc.) + git pattern regexes (`scanGitPatterns()`, 8 patterns)
  - Test agent: extracts test count from output (`Failed\s*│\s*(\d+)\s*│`)
  - **Specialists are Claude Code sessions** — they can call Write tool to create files
  - Git operations: push, force-push, fetch, [rejected], non-fast-forward, retry, [remote rejected], up-to-date
  - Test metrics: passed count, failed count, skipped count, duration, individual test names

- **Decision:**
  1. **git-events.jsonl** (append-only, one operation per line):
     ```jsonl
     {"op":"push","ref":"main","remote":"origin","ts":"2026-04-22T..."}
     {"op":"rejected","ref":"feature/pan-123","ts":"2026-04-22T..."}
     ```
  2. **test-results.json** (single JSON, overwritten per run):
     ```json
     {"passed":42,"failed":3,"skipped":1,"duration":35000,"ts":"2026-04-22T..."}
     ```
  3. **merge-results.json** (single JSON, overwrites per attempt):
     ```json
     {"result":"success","resolvedFiles":["src/conflict.ts"],"failedFiles":[],"tests":"pass","validation":"passed","ts":"..."}
     ```
  4. **Discovery:** Merge agent writes to workspace root or `.panopticon/agents/<id>/` — store path in runtime.json
  5. **Polling:** Merge agent polls for file existence instead of tmux text (5s poll, 15m timeout)

- **Impact:**
  - **Unblocks P3 merge/test agent migration** — eliminates `merge-agent.ts:412,684,1071,1744` tmux scans
  - Structured output simplifies merge logic (no pattern matching)
  - Enables merge agent to poll for file instead of tmux (cleaner, more reliable)

---

### #12 — Heartbeat File Deprecation Plan

- **Finding:**
  - Heartbeat files at `~/.panopticon/heartbeats/<sessionname>.json` written by hooks on PostToolUse
  - Consumers: deacon.ts:260 (reads via `checkHeartbeat()`), mission-control.ts (activity display)
  - **Both redundant with `runtime.json.lastActivity`** — heartbeat just contains timestamp, which runtime.json already has
  - No semantic difference between heartbeat timestamp and lastActivity

- **Decision:**
  1. **Migrate all heartbeat readers to `runtime.json.lastActivity`**
  2. **Cleanup:** Delete `~/.panopticon/heartbeats/` directory after migration
  3. **Hook removal:** Stop writing heartbeat files entirely
  4. **Single source of truth:** `runtime.json` becomes the only agent state file

- **Impact:**
  - **Unblocks cleanup** — removes file I/O overhead and orphaned file accumulation
  - Simplifies health checks (`checkHeartbeat()` → direct `runtime.json` read)
  - Deacon code simplifies (deacon.ts:254-283 becomes simple JSON read)

---

### #13 — Backwards Compatibility During Migration

- **Finding:**
  - 22 tmux call sites across 12 files, 4 categories of risk:
    1. **High risk if kept:** `confirmDelivery()` (false positives), `checkLazyAgent()` (broad regexes), `parseThinkingDuration()` (format fragility)
    2. **Medium risk:** `checkStuckWorkAgents()` (dialog detection), specialist result parsing
    3. **Low risk if dropped:** Transcript capture (JSONL replacement exists), health checks (runtime.json exists)
  4. **Migration risk:** If hooks are unreliable (PAN-759), removing tmux fallbacks causes startup hangs

- **Decision:**
  1. **Sequenced rollout (not a flag switch):**
     - Phase 1: Fix hook reliability (PAN-759) + extend hooks with new fields (activity, thinkingSince, messageReceived, waitingOnHuman)
     - Phase 2: Implement structured event files (git-events.jsonl, test-results.json, review-results.json) + JSONL readers
     - Phase 3: Remove high-risk patterns (confirmDelivery, parseThinkingDuration) + ring buffer for terminal snapshot
     - Phase 4: Migrate remaining transcripts and health checks to JSONL/runtime.json
  2. **No feature flags needed** — each phase makes clear progress; regressions caught by tests
  3. **Test strategy:** 
     - Unit tests: verify hook writes + JSONL parsing
     - Integration tests: specialist workflows with new event files
     - E2E: full agent lifecycle with no tmux capture calls

- **Impact:**
  - **Clarifies implementation sequence** — Phase 1 blocks everything; Phases 2-4 can proceed in parallel once Phase 1 completes
  - **Risk mitigation:** Don't remove tmux until replacement is verified working
  - **Testing**: prevents regressions (current tests may not cover edge cases tmux handles)

---

### #14 — confirmDelivery() Value Assessment

- **Finding:**
  - 14 processing patterns checked (●, ⎿, Read, ✻, Generating, thinking, etc.)
  - **No evidence it ever catches real failures:** Git history shows 6 commits addressing delivery/prompt detection but none validate confirmDelivery() success rate
  - **False-positive risk is high:** Pre-existing pane content containing any pattern triggers false confirmation
  - **Already redundant:** `sendKeysAsync()` uses load-buffer + 600-3000ms delay + paste-buffer, which is inherently reliable
  - **Blocking delays:** confirmDelivery() polls for 10s with 1s intervals, adding 10s latency on every message in worst case

- **Decision:**
  1. **Recommend deletion, not replacement**
  2. Rationale:
     - No telemetry shows it catches failures (suggesting it's not needed)
     - False-positive risk outweighs benefit
     - Load-buffer + delay is already sufficient (documented in async-tmux.md)
     - Removes 10s blocking poll, improving responsiveness
  3. **If delivery confirmation is required for audit trail:** Use simple hook-based sequence counter (incrementing integer, not regex-based)
  4. Remove from: `tmux.ts:559`, specialist calls at `specialists.ts:2484,2495`

- **Impact:**
  - **Immediate performance gain:** Eliminates 10s poll latency from every message
  - **Simplifies P2 delivery removal** — delete confirmDelivery() entirely rather than replace
  - **Reduces code fragility** — no pattern maintenance, no false positive risk

---

### #15 — Lazy Pattern Simplification

- **Finding:**
  - 17 LAZY_PATTERNS (deacon.ts:617-635): ranging from "what would you like" to "future PR" to infrastructure-specific
  - **All trigger same action:** `sendAntiLazyMessage()` (deacon.ts:711)
  - Single anti-lazy message content (deacon.ts:640): generic "stop being lazy, do all the work now"
  - **No differentiation:** Different lazy patterns don't trigger different actions or different message content

- **Decision:**
  1. **Collapse all 17 patterns to single `state === 'waiting-on-human'` check**
  2. **Rationale:**
     - All patterns indicate the same condition: agent asking for direction/permission at idle prompt
     - Hook can detect this: when Claude enters interactive prompt, sets `runtime.json.waitingOnHuman = true`
     - No regex maintenance, no false classifications
  3. **Optional:** Add `waitingReason` field to categorize the type of wait (e.g., "needs_clarification", "scope_deferral", "time_estimate_rejection") — but don't make action different per type
  4. **Remove:** Entire `LAZY_PATTERNS` array, `checkLazyAgent()` regex loops

- **Impact:**
  - **Unblocks P1 Deacon lazy detection removal** — single boolean check replaces 17-pattern scan
  - **Eliminates most subjective regex matching** — hook-based state is deterministic
  - **Reduces Deacon code complexity** — `checkAndCorrectLazyAgents()` simplifies significantly

---

## Summary Table

| # | Research Item | Status | Finding | Decision | Blocker(s) |
|---|---|---|---|---|---|
| 2 | Hook Reliability (PAN-759) | Open | Hooks not firing; fallbacks everywhere | Fix hooks before removing fallbacks | **Critical: blocks all readiness removal** |
| 3 | messageReceived Feasibility | Resolved | confirmDelivery() is high-risk, low-value | Delete confirmDelivery(); use simple counter if needed | None (can delete immediately) |
| 4 | activity Granularity | Resolved | 17 patterns but only active/idle needed | Simplify to 3 values: computing, thinking, idle | Hook extension (low risk) |
| 5 | Thinking Duration | Resolved | Regex is fragile; hook timestamp is better | Add `thinkingSince` to runtime.json | Hook extension (moderate risk) |
| 6 | Dialog Detection | Resolved | `.includes()` is fragile; hook detection better | Extend hook or pre-configure .claudeignore | Hook extension (moderate risk) |
| 7 | Review Markers | Resolved | Specialists can write files | Review specialist writes review-results.json | Specialist code change (low risk) |
| 8 | Health Checks | Resolved | Already reads runtime.json correctly | No change; already correct | None |
| 9 | Ring Buffer Design | Resolved | Attach to PTY hub, 500-line raw bytes | Implement as described | Implementation (low risk) |
| 10 | JSONL Format | Resolved | Store path in runtime.json; tail from end | Implement tail reader, resolve path | Implementation (low risk) |
| 11 | Specialist Event Files | Resolved | Write structured JSON files | git-events.jsonl, test-results.json, merge-results.json | Specialist code change (low risk) |
| 12 | Heartbeat Deprecation | Resolved | Heartbeat === runtime.json.lastActivity | Migrate readers, delete heartbeat files | Data migration (low risk) |
| 13 | Backwards Compatibility | Resolved | Phase migration, fix PAN-759 first | 4-phase sequenced rollout | **Critical: depends on #2** |
| 14 | confirmDelivery() Value | Resolved | No evidence of value; false-positive risk | Delete entirely (not replace) | None (can delete immediately) |
| 15 | Lazy Patterns | Resolved | All 17 trigger same action | Replace with `waitingOnHuman` boolean | Hook extension (low risk) |

---

**Next Step:** Address critical blocker PAN-759 (hook reliability). Once hooks fire reliably, can proceed with Phase 1 migrations. Items #3 and #14 can be implemented immediately (confirmDelivery deletion). Items #4-12, #15 depend on hook extensions (Phase 1).

