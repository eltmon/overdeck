# PAN-798: Remaining Research & Audits

This document tracks all open questions, incomplete audits, and research needed before PAN-798 can move to implementation.

---

## 1. Complete Pattern Audit

**Owner:** Pending — assign to research agent  
**Deliverable:** `PAN-798-pattern-audit.md` (currently a stub)

We need an exhaustive list of every string pattern, regex, and keyword searched for within captured tmux output. For each pattern, we need:

- Exact file path and line number
- The pattern itself (literal string or regex)
- What action is taken on match
- **WHY** it is searched for — categorized as:
  - `delivery_confirmation` — verifying a message was received
  - `activity_detection` — detecting the AI is actively working
  - `result_extraction` — extracting a pass/fail/files-reviewed result
  - `stuck_detection` — detecting a hung/blocked agent
  - `error_detection` — detecting API/infrastructure errors
  - `metadata_extraction` — extracting model name, commit hash, etc.
  - `dialog_intervention` — detecting interactive prompts needing dismissal
  - `other` — explain

This determines which `runtime.json` fields are actually needed vs speculative.

---

## 2. Hook Reliability Root Cause (PAN-759)

**Owner:** Pending  
**Deliverable:** Fix or documented workaround

`ready.json` and `runtime.json` hooks are written by bash scripts triggered on `SessionStart` and `PostToolUse`. There are tmux fallbacks (`waitForReadySignal`, `waitForClaudePrompt`) because the hooks sometimes fail to fire.

Research needed:
- Why do hooks miss? Is it a race condition between tmux session creation and hook registration?
- Is it a permissions issue (bash hook not executable)?
- Is it a tmux session name mismatch?
- Is it a Claude Code version change that broke hook invocation?
- Can we make hooks fire reliably 100% of the time, or do we need an alternative signal mechanism?

**This blocks removal of `waitForClaudePrompt()` and `waitForReadySignal()`.**

---

## 3. `messageReceived` Sequence Counter Feasibility

**Owner:** Pending  
**Deliverable:** Decision + implementation plan

`confirmDelivery()` currently verifies that a sent message triggered visible processing patterns (`●`, `⎿`, `thinking`, etc.). The proposed replacement is a `messageReceived` sequence counter in `runtime.json`.

Research needed:
- Does Claude Code have a hook that fires when stdin is read / a message is received?
- If not, can we detect "message received" from `PostToolUse` (which fires after the tool completes, not when the message arrives)?
- Is `messageReceived` the right abstraction, or should we use `processing: boolean` that the hook sets when a turn starts and clears when it returns to prompt?
- What happens if multiple messages are sent in rapid succession?

**This blocks removal of `confirmDelivery()`.**

---

## 4. `activity` Field Granularity

**Owner:** Pending  
**Deliverable:** Final enum values

The spec proposes `activity: 'bash' | 'read' | 'write' | 'edit' | 'thinking' | 'idle' | null`.

Research needed:
- What are all the tool types Claude Code uses? (`Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `WebSearch`, etc.)
- Does Deacon's `isAgentActiveInTmux()` need to distinguish between "active because reading a file" vs "active because running bash"? Or is `state === 'active'` sufficient?
- Does the dashboard need tool-type granularity, or just active/idle?
- Should `activity` be the raw tool name, or a coarse category?

**This determines the exact `activity` enum values.**

---

## 5. Thinking Duration Detection Without tmux

**Owner:** Pending  
**Deliverable:** Hook extension or alternative mechanism

Deacon parses "Thinking… (Xm Ys)" from tmux text to detect stuck agents. The spec proposes `thinkingSince` timestamp.

Research needed:
- Can the PostToolUse hook detect when a thinking block starts vs ends?
- Is "thinking" a tool use (`Thinking` tool) or a pre-tool-use state?
- If the hook only fires after tool completion, can we infer thinking duration from the gap between `lastActivity` timestamps?
- Is there a reliable signal for "Claude is currently thinking" vs "Claude is idle at prompt"?

**This blocks removal of thinking duration parsing in Deacon.**

---

## 6. Interactive Dialog Detection (exclude-from-context)

**Owner:** Pending  
**Deliverable:** Hook extension or alternative intervention strategy

Deacon detects the "exclude from context" dialog by searching tmux text for `"Do you want to make this edit to exclude"` and `"Esc to cancel"`. It then sends `Escape` to dismiss it.

Research needed:
- Can the hook system detect when Claude Code enters an interactive dialog state?
- Is there a way to disable this dialog globally (e.g., `--no-exclude-prompt` flag)?
- If not, can we intercept it via a pre-configured `.claudeignore` to prevent the dialog from appearing?
- If hooks can't detect it, is it acceptable to let the agent sit in `waiting-on-human` state and alert the user?

**This blocks removal of dialog detection in Deacon.**

---

## 7. Review Agent Result Markers

**Owner:** Pending  
**Deliverable:** Structured result protocol

`review-agent.ts` regex-matches status markers from tmux output: `REVIEW_RESULT:`, `FILES_REVIEWED:`, `SKIPPED:`, etc.

Research needed:
- These markers are printed to stdout by the review agent itself. Can the review agent write structured results to a file instead?
- Is `review_status` in SQLite already the correct destination? If so, why does `parseAgentOutput()` also scan tmux?
- Are there other consumers of these markers besides `review-agent.ts`?
- What is the exact list of all markers and their meanings?

**This blocks removal of review result marker parsing.**

---

## 8. Health Check Output Requirements

**Owner:** Pending  
**Deliverable:** Decision on structured vs transcript

`health.ts` and `health-filtering.ts` capture tmux output for health checks.

Research needed:
- What decisions are made based on health check output? (kill stuck agent? alert user?)
- Are health checks only interested in "is agent responsive?" (already in `runtime.json.state`)
- Or do they need to see recent error output (API errors, rate limits)?
- If error detection is needed, should errors be written to `runtime.json.lastError` by hooks?

**This determines whether health checks need anything beyond `runtime.json`.**

---

## 9. WebSocket Terminal Ring Buffer Design

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

**Owner:** Pending  
**Deliverable:** Parser/reader utility

ActivityView and agent output endpoints would read from JSONL session files instead of tmux.

Research needed:
- What is the exact schema of JSONL entries? (tool_use, tool_result, user_message, assistant_message, etc.)
- Are there existing parsers for this format in the codebase?
- How to efficiently tail/render recent entries without reading the entire file?
- How to map a tmux session name to its JSONL file path?
- What is the performance of reading large JSONL files (10MB+)?

**This blocks dashboard transcript migration.**

---

## 11. Specialist Event File Protocol

**Owner:** Pending  
**Deliverable:** Schema definitions

Merge and test specialists need to write structured event files (`git-events.jsonl`, `test-results.json`).

Research needed:
- What git operations does the merge agent actually need to track? (push, force-push, rejected, merge conflict, etc.)
- What test metrics does the merge agent need? (passed, failed, skipped, duration, failed test names)
- Should these be JSONL append-only files or single JSON files overwritten per run?
- How does the merge agent discover the event file path?
- Are there existing structured output conventions in the specialist code?

**This blocks removal of merge-agent tmux captures.**

---

## 12. Heartbeat File Deprecation Plan

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

**Owner:** Pending  
**Deliverable:** Migration strategy

We cannot flip a switch and break all consumers at once.

Research needed:
- Can we run old and new paths in parallel during transition?
- Should `capturePaneAsync` calls be replaced with structured reads that fall back to tmux during migration?
- How long is the migration window?
- Do we need feature flags or gradual rollout?
- What is the testing strategy to ensure no regressions?

**This blocks implementation sequencing.**

---

## Summary Table

| # | Research Item | Blocks | Estimated Effort |
|---|---------------|--------|------------------|
| 1 | Complete pattern audit | Spec finalization | 2-3h |
| 2 | Hook reliability (PAN-759) | P2 readiness removal | 4-8h |
| 3 | `messageReceived` feasibility | P2 delivery removal | 2-4h |
| 4 | `activity` granularity | P1 Deacon health | 1-2h |
| 5 | Thinking duration detection | P1 stuck detection | 2-3h |
| 6 | Dialog detection/intervention | P1 stuck detection | 2-4h |
| 7 | Review result markers | Review agent migration | 2-3h |
| 8 | Health check requirements | P1 health removal | 1-2h |
| 9 | WebSocket ring buffer design | P4 terminal snapshot | 3-5h |
| 10 | JSONL format & access | P3 dashboard transcripts | 2-3h |
| 11 | Specialist event file protocol | P3 merge agent | 2-3h |
| 12 | Heartbeat deprecation | Heartbeat removal | 1-2h |
| 13 | Backwards compatibility | Implementation start | 2-3h |

---

**Next Step:** Pick a research item and assign it, or begin implementation on items with no blockers (P0 model field, P0 `output.log` removal planning).
