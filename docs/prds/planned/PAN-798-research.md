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
| 2 | Hook reliability (PAN-759) | P2 readiness removal (6 call sites) | 4-8h | Open |
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

**Next Step:** Pick a research item and assign it, or begin implementation on items with no blockers (P0 model field, P0 `output.log` removal planning).
