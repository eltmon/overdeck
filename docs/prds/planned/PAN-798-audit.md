# PAN-798: Tmux capture-pane Audit

**Scope:** All `capturePaneAsync()` call sites and pattern-scanning locations in `src/`  
**Date:** 2026-04-22  
**Related:** `PAN-798.md` (master PRD), `PAN-798-research.md`

---

## Executive Summary

- **22 total call sites** across **12 files**
- **20 perform pattern scanning** — 70+ distinct patterns/regexes
- **2 are pure passthrough** (return/save/display raw output, no scanning)
- Every single pattern-scanning location can be replaced with structured data sources

---

## Part 1: Call Site Analysis

### Category: Transcript Display (Dashboard)

| # | File:Line | Captures | Used For | Replacement |
|---|-----------|----------|----------|-------------|
| 1 | `mission-control.ts:161` | 500 lines | ActivityView agent transcript | JSONL session file |
| 2 | `mission-control.ts:297,306` | 100 lines | Specialist live output panel | JSONL session file |
| 3 | `agents.ts:526` | Configurable (default 100) | Agent output endpoint | JSONL session file |

### Category: Readiness Detection

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 4 | `tmux.ts:527` | `waitForClaudePrompt()` | 10 lines every 500ms/15s | Wait for `❯` prompt | `ready.json` hook |
| 5 | `conversations.ts:81` | `waitForClaudeReady()` | 200 lines every 500ms/30s | Wait for `❯` prompt | `ready.json` hook |
| 6 | `agents.ts:244` | `waitForReadySignal()` | 200 lines | Fallback when hook misses | Fix PAN-759 |
| 7 | `agents.ts:1041` | `startAgent` inline | 200 lines | Detect "bypass permissions on" | `ready.json` hook |

**Note:** `waitForClaudePrompt()` is called from **6 sites** total: `agents.ts:1401`, `specialists.ts:2436,2459`, `conversations.ts:560,613,969`.

### Category: Delivery Confirmation

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 8 | `tmux.ts:559` | `confirmDelivery()` | 50 lines before/after | Verify message received | `messageReceived` sequence |
| 9 | `specialists.ts:2484,2495` | — | 50 lines before + retry | Specialist delivery confirmation | `messageReceived` sequence |

### Category: Health & Stuck Detection (Deacon)

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 10 | `deacon.ts:651` | `checkLazyAgent()` | 20 lines | Detect lazy patterns at idle prompt | `runtime.json.state` + `waitingReason` |
| 11 | `deacon.ts:849` | `isAgentActiveInTmux()` | 5 lines (bottom 8) | Check if agent is working | `runtime.json.activity` |
| 12 | `deacon.ts:935` | `parseThinkingDuration()` | Called from #11, #13 | Extract thinking duration | `runtime.json.thinkingSince` |
| 13 | `deacon.ts:955` | `checkStuckWorkAgents()` | 10 lines | Detect stuck agents + dialog | `runtime.json.thinkingSince` + `waitingOnHuman` |

### Category: Health Checks (No Pattern Scanning)

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 14 | `health.ts:91` | `getAgentOutput()` | Configurable | Return raw output | `runtime.json.state` |
| 15 | `health-filtering.ts:13` | `checkAgentHealthAsync()` | 5 lines | Return `{alive, lastOutput}` | `runtime.json.state` |

**Note:** These do NOT scan patterns — they return raw tmux text. Downstream consumers may scan that text; this needs verification (see research item #8).

### Category: Model & Metadata Extraction

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 16 | `workspaces.ts:931` | `getWorkspaceRoute()` | 50 lines | Extract model name from tmux | `runtime.json.model` |

### Category: Terminal Streaming (WebSocket)

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 17 | `ws-terminal.ts:89` | `captureFreshSnapshot()` | 500 lines | Initial WebSocket snapshot | PTY hub ring buffer |
| 18 | `ws-terminal.ts:101` | `captureViewportSnapshot()` | 0 lines (viewport) | Hub join snapshot | PTY hub viewport state |

### Category: Agent Lifecycle

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 19 | `agents.ts:1224` | `stopAgentAsync()` | 5000 lines | Save output before kill | JSONL session file |

### Category: Git Pattern Scanning (Merge Agent)

| # | File:Line | Function | Captures | Used For | Replacement |
|---|-----------|----------|----------|----------|-------------|
| 20 | `merge-agent.ts:660` | `captureTmuxOutput()` | 50 lines | Scan git operations | `git-events.jsonl` |
| 21 | `merge-agent.ts:1017` | `scanGitPatterns()` | Captured text | Emit `git_operations` rows | `git-events.jsonl` |
| 22 | `merge-agent.ts:1071` | `pollMergeCompletion()` | Captured text | Extract test failure count | `test-results.json` |

---

## Part 2: Detailed Pattern Breakdown

### `waitForClaudePrompt()` (`tmux.ts:527`) — `activity_detection`

**Pattern:** `❯` (Claude Code prompt indicator, `.includes()` on each line)  
**Logic:** Requires 2+ consecutive polls with session existence verification.  
**Called from:** 6 sites (see above).

### `confirmDelivery()` (`tmux.ts:559`) — `delivery_confirmation` — **HIGH RISK**

**14 processing patterns checked:**
- `●`, `⎿`, `Read`, `✻`, `✶`, `✽`, `✢`
- `Generating`, `thinking`, `thought for`
- `Retrying in`, `API Error`, `"You've hit your limit"`, `Tool use`

**Logic:** Compares pane output before/after send. Returns `true` if any pattern appears in the delta.  
**Risk:** False positive if pattern exists in pre-existing pane content.

### `waitForReadySignal()` (`agents.ts:244`) — `activity_detection`

**Patterns:** `bypass permissions on`, `⏵⏵`  
**Logic:** Returns `true` if either indicator found in 200-line capture.

### `startAgent` inline check (`agents.ts:1041`) — `activity_detection`

**Patterns:** `bypass permissions on`, `Claude Code`  
**Logic:** Sets `ready = true` after detecting Claude Code initialized.

### `checkLazyAgent()` (`deacon.ts:651`) — `stuck_detection` — **HIGH RISK**

**17 active-status patterns (regex):**
`/computing/i`, `/fermenting/i`, `/thinking/i`, `/reading/i`, `/writing/i`, `/editing/i`, `/searching/i`, `/running/i`, `/executing/i`, `/tool use/i`, `/\bBash\b/`, `/\bRead\b/`, `/\bWrite\b/`, `/\bEdit\b/`, `/\bGrep\b/`, `/\bGlob\b/`, `/\bTask\b/`

**Idle prompt detection:**
- `/^[>\$#]\s*$/` (regex on last line)
- `lastLine.endsWith('?')`
- `lastLine.includes('What would you like')`

**17 lazy patterns (regex):**
- `/what would you like me to do\??/i`
- `/option\s*[123]:/i`, `/options?:/i`
- `/would you prefer/i`
- `/should I (continue|proceed|stop)/i`
- `/this would take \d+[-–]\d+ hours/i`
- `/estimated \d+ hours/i`
- `/manual intervention/i`, `/requires human/i`
- `/stop here/i`
- `/deferred (to|for) (future|later|follow-up)/i`
- `/future PR/i`, `/follow-up issue/i`
- `/documented for later/i`, `/remaining work documented/i`
- `/targeted approach/i`
- `/infrastructure.*(complete|done).*tests.*(fail|broken)/i`

**Logic:** If active pattern matches → not lazy. If at prompt AND lazy pattern matches → lazy.  
**Risk:** Broad lazy patterns could interrupt working agents; missed active patterns could misclassify computing agents.

### `isAgentActiveInTmux()` (`deacon.ts:849`) — `activity_detection`

**Patterns:** Same 17 active-status regexes as `checkLazyAgent()`.  
**Special case:** If `thinking|fermenting` matches → calls `parseThinkingDuration()`. If duration ≥ 10 min → returns `false` (stuck).  
**Logic:** Checks bottom 8 non-blank lines.

### `parseThinkingDuration()` (`deacon.ts:935`) — `metadata_extraction` — **HIGH RISK**

**Regex:** `/(?:[Tt]hinking|[Ff]ermenting)[^\n]*?\((?:(\d+)m\s*)?(\d+)s/`  
**Logic:** Extracts minutes and seconds, converts to milliseconds.  
**Risk:** Format fragility — if Claude Code changes status text, stuck detection breaks.

### `checkStuckWorkAgents()` (`deacon.ts:955`) — `stuck_detection` + `dialog_intervention`

**Dialog detection:**
- `.includes('Do you want to make this edit to exclude')`
- `.includes('Esc to cancel') && .includes('Tab to amend')`

**Thinking detection:** Calls `parseThinkingDuration()`. If ≥ 10 min → three-stage recovery (Escape → Ctrl+C → kill + respawn).

**Risk:** Simple `.includes()` could misfire if those strings appear in legitimate output.

### `parseAgentOutput()` (`review-agent.ts:139`) — `result_extraction`

**Structured markers:** `REVIEW_RESULT:`, `FILES_REVIEWED:`, `SECURITY_ISSUES:`, `PERFORMANCE_ISSUES:`, `NOTES:`  
**Logic:** `.startsWith()` on each line. Populates `ReviewResult` object.  
**Note:** No human-readable fallback. Markers are printed to stdout by the review agent itself.

### `parseAgentOutput()` (`merge-agent.ts:412`) — `result_extraction`

**Structured markers:** `MERGE_RESULT:`, `RESOLVED_FILES:`, `FAILED_FILES:`, `TESTS:`, `VALIDATION:`, `REASON:`, `NOTES:`  
**Human-readable fallback:**
- Success: `merge task complete`, `successfully merged`, `merge complete`, `pushed merge commit`, `successfully merged and pushed`
- Failure: `merge failed`, `merge task failed`, `could not merge`, `conflict not resolved`
- Test detection: `tests: pass`, `tests passed`, `/\d+ passed/`, `tests: fail`, `tests failed`

**Logic:** Structured markers first, fallback to human-readable indicators.

### `scanGitPatterns()` (`merge-agent.ts:684`) — `metadata_extraction`

**8 git pattern regexes:**
| Pattern | Operation |
|---------|-----------|
| `/force-with-lease/i` | `force_push_cmd` |
| `/git push/i` | `push_attempt` |
| `/git fetch/i` | `fetch_attempt` |
| `/\[rejected\]/i` | `push_rejected` |
| `/non-fast-forward/i` | `non_ff` |
| `/retrying/i` | `retry` |
| `/\[remote rejected\]/i` | `remote_rejected` |
| `/Everything up-to-date/i` | `push_noop` |

**Logic:** Line-by-line scan. Emits `git_operations` DB row with deduplication.  
**Risk:** False positives produce spurious audit records but don't affect functionality.

### `pollMergeCompletion()` test baseline (`merge-agent.ts:1071`) — `metadata_extraction`

**Regex:** `/Failed\s*│\s*(\d+)\s*│/`  
**Logic:** Extracts failed test count from Vitest-style output table.

### `resolveConflictsWithAgent()` (`merge-agent.ts:1744`) — `result_extraction`

**Patterns:** `MERGE_RESULT:` (`.includes()`), `merge task complete`, `successfully merged`, `merge complete`, `merge failed`, `merge task failed` (lowercased `.includes()`).  
**Logic:** Polls every 5s for 15min. Calls `parseAgentOutput()` when marker detected.

### `waitForClaudeReady()` (`conversations.ts:81`) — `activity_detection`

**Pattern:** `❯` (`.includes()`)  
**Logic:** Polls every 500ms for 30s.

### `getWorkspaceRoute()` (`workspaces.ts:931`) — `metadata_extraction`

**Regex 1:** `/\[((?:oai|cx|go)?@?(?:gpt-[0-9.]+(?:-mini|-nano|-pro)?|o[1-4](?:-mini)?(?:-high)?|gemini-[0-9.]+(?:-pro|-flash|-lite)?))[^\]]*\]/i`  
**Regex 2:** `/\[(Opus|Sonnet|Haiku)[^\]]*\]/i`  
**Logic:** Extracts model identifier from square brackets in tmux output (e.g., `[Sonnet 4.6]`).

### `mission-control.ts:297` — `other`

**Patterns:** `issueId.toUpperCase()`, `issueId`, `issueLower` (`.includes()`)  
**Logic:** Filters specialist output — only includes lines mentioning the current issue ID. Shows "Waiting" placeholder otherwise.

---

## Part 3: Risk Assessment

### High Risk

1. **`confirmDelivery()`** — False positives on stale output could mask real delivery failures. 14 patterns; if any appear in pre-existing content, delivery is falsely confirmed.
2. **`checkLazyAgent()`** — 34 regexes total. Overly broad lazy patterns could interrupt working agents; missed active patterns could misclassify computing agents.
3. **`parseThinkingDuration()`** — Regex must match Claude Code's evolving status format. Format change = broken stuck detection.
4. **`checkStuckWorkAgents()`** — Dialog detection uses simple `.includes()`; could misfire if strings appear in legitimate output.

### Medium Risk

5. **`parseAgentOutput()` (review-agent)** — No human-readable fallback. Agents may omit markers.
6. **`parseAgentOutput()` (merge-agent)** — Human-readable fallback adds ambiguity. False positives possible.

### Low Risk

7. **`scanGitPatterns()`** — False positives produce spurious audit records only.
8. **Model extraction** — Non-critical enrichment; fallback exists.
9. **`waitForClaudePrompt()` / `waitForClaudeReady()`** — Timeout handles misses.

---

## Part 4: Testing Recommendations

1. **`waitForClaudePrompt()`** — Unit tests for timeout, double-poll confirmation, session-death mid-poll.
2. **`confirmDelivery()`** — Test each of the 14 patterns in isolation; verify no false positive when pattern exists in `outputBefore`.
3. **`parseThinkingDuration()`** — Edge cases: `0m 5s`, `59m 59s`, missing minutes group, non-ASCII ellipsis variants.
4. **`checkLazyAgent()`** — Verify no false lazy detection when agent shows any active-status pattern.
5. **`checkStuckWorkAgents()`** — Test exclude-dialog dismissal; test thinking-duration threshold boundary (exactly 10 min vs 10 min + 1s).
6. **Result extraction** — Verify both structured-marker and human-readable fallback paths for merge-agent.
7. **`scanGitPatterns()`** — Verify each regex matches expected git output lines.
8. **Model extraction** — Test with actual output containing `[Sonnet 4.6]`, `[gpt-5.4]`, `[o3]`.

---

## Part 5: Call Sites That Capture But Do NOT Scan

These locations call `capturePaneAsync()` but perform no pattern matching — they simply return, save, or display raw output:

| # | File:Line | Function | Action |
|---|-----------|----------|--------|
| 1 | `agents.ts:1224` | `stopAgentAsync()` | Saves 5000 lines to `output.log` |
| 2 | `health.ts:91` | `getAgentOutput()` | Returns trimmed output as-is |
| 3 | `health-filtering.ts:13` | `checkAgentHealthAsync()` | Returns `{alive, lastOutput}` |
| 4 | `agents.ts:526` | `getAgentOutputRoute()` | Returns raw output for dashboard |
| 5 | `mission-control.ts:161` | — | Captures 500 lines for transcript |
| 6 | `mission-control.ts:297` | — | Captures and appends raw specialist output |
| 7 | `ws-terminal.ts:89` | `captureFreshSnapshot()` | Terminal streaming via WebSocket |

**Important:** While these call sites don't scan patterns themselves, downstream consumers of their raw output may. This needs verification (see research item #8).

---

## Part 6: Category Summary

| Category | Count | Description |
|----------|-------|-------------|
| `activity_detection` | 6 | Detecting ready/active/working state |
| `result_extraction` | 4 | Extracting pass/fail/files-reviewed results |
| `delivery_confirmation` | 1 | Verifying message delivery |
| `stuck_detection` | 2 | Detecting hung/blocked agents |
| `dialog_intervention` | 1 | Detecting interactive prompts |
| `metadata_extraction` | 4 | Extracting model name, git ops, test counts |
| `other` | 2 | IssueId filtering, raw output passthrough |

---

## Audit Completeness

- [x] All `capturePaneAsync()` call sites identified (22 total)
- [x] All `captureTmuxOutput()` call sites identified
- [x] All `.includes()`, `.indexOf()`, `.match()`, `.test()`, `.search()`, `.startsWith()`, `.endsWith()` on captured tmux text documented
- [x] Status markers documented
- [x] Model extraction regex documented
- [x] Thinking duration parsing documented
- [x] Exclude-from-context dialog detection documented
- [x] Risk assessment completed
- [x] Testing recommendations provided
- [x] Raw passthrough call sites identified

**Total pattern-scanning locations:** 20  
**Total files affected:** 12  
**Total distinct patterns/regexes:** 70+
