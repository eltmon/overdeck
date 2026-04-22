# PAN-798: Tmux Pattern Audit Report

**Issue**: Identify every single location where Panopticon CLI captures tmux session output and scans it for specific string patterns, regexes, keywords, or markers.

**Scope**: `src/` directory comprehensive search, including `src/lib/`, `src/dashboard/`, `src/cli/`, and all subdirectories.

**Date**: 2026-04-22

---

## Summary

Found **20 pattern-scanning locations** across **12 files** where tmux output is captured and then searched/matched/parsed for decision-making.

| Category | Count |
|---|---|
| `activity_detection` | 6 |
| `result_extraction` | 4 |
| `delivery_confirmation` | 1 |
| `stuck_detection` | 2 |
| `dialog_intervention` | 1 |
| `metadata_extraction` | 4 |
| `other` | 2 |

---

## Pattern Scanning Locations

### src/lib/tmux.ts:527 — `waitForClaudePrompt`

**Patterns searched for:**
- `❯` (Claude Code prompt indicator, via `.includes()` on each line)

**What it does on match:**
Detects that Claude Code has initialized and is waiting for user input. Increments `consecutivePromptPolls`; returns `true` once the prompt is seen in 2+ consecutive polls (with session existence verification between polls).

**WHY it looks for this:**
- `activity_detection` — detecting that the AI is actively working/thinking/processing (or rather, ready to receive work)

**Current implementation:**
```typescript
const output = await capturePaneAsync(sessionName, 10);
const lines = output.split('\n').filter(l => l.trim());
const hasPromptLine = lines.some(line => line.includes('❯'));
if (hasPromptLine) {
  consecutivePromptPolls += 1;
  if (consecutivePromptPolls >= 2 && await sessionExistsAsync(sessionName)) {
    return true;
  }
}
```

**Called from:**
- `src/lib/agents.ts:1401`
- `src/lib/cloister/specialists.ts:2436`
- `src/lib/cloister/specialists.ts:2459`
- `src/dashboard/server/routes/conversations.ts:560`
- `src/dashboard/server/routes/conversations.ts:613`
- `src/dashboard/server/routes/conversations.ts:969`

---

### src/lib/tmux.ts:559 — `confirmDelivery`

**Patterns searched for:**
- `●`
- `⎿`
- `Read`
- `✻`
- `✶`
- `✽`
- `✢`
- `Generating`
- `thinking`
- `thought for`
- `Retrying in`
- `API Error`
- `You've hit your limit`
- `Tool use`

**What it does on match:**
Compares tmux output before and after sending a message. If any processing pattern appears in the new output, confirms the message was delivered and processing started. Returns `true` if confirmed, `false` on timeout.

**WHY it looks for this:**
- `delivery_confirmation` — verifying a sent message was received

**Current implementation:**
```typescript
const processingPatterns = [
  '●', '⎿', 'Read', '✻', '✶', '✽', '✢', 'Generating', 'thinking',
  'thought for', 'Retrying in', 'API Error', "You've hit your limit", 'Tool use',
];
const newOutput = afterText.startsWith(beforeText)
  ? afterText.slice(beforeText.length)
  : afterText;
if (processingPatterns.some(pattern => newOutput.includes(pattern))) {
  return true;
}
```

**Called from:**
- `src/lib/cloister/specialists.ts:2491`
- `src/lib/cloister/specialists.ts:2497`

---

### src/lib/agents.ts:244 — `waitForReadySignal`

**Patterns searched for:**
- `bypass permissions on`
- `⏵⏵`

**What it does on match:**
Returns `true` if the tmux pane contains either indicator, signaling that Claude Code is ready. This is the primary detection path (the `ready.json` hook file is not currently written per PAN-759).

**WHY it looks for this:**
- `activity_detection` — detecting that the AI is actively working/thinking/processing (specifically: ready to receive instructions)

**Current implementation:**
```typescript
const pane = await capturePaneAsync(agentId, 200);
if (pane.includes('bypass permissions on') || pane.includes('⏵⏵')) {
  return true;
}
```

---

### src/lib/agents.ts:1041 — `startAgent` (inline prompt-ready check)

**Patterns searched for:**
- `bypass permissions on`
- `Claude Code`

**What it does on match:**
Sets `ready = true` after detecting Claude Code is initialized in the tmux pane. Falls back from `ready` file existence check.

**WHY it looks for this:**
- `activity_detection` — detecting that the AI is actively working/thinking/processing (ready state before sending initial prompt)

**Current implementation:**
```typescript
const pane = await capturePaneAsync(agentId, 200);
if (pane.includes('bypass permissions on') || pane.includes('Claude Code')) {
  ready = true;
  break;
}
```

---

### src/lib/cloister/deacon.ts:651 — `checkLazyAgent`

**Patterns searched for:**
1. **Active-status guard** (regex loop over `ACTIVE_STATUS_PATTERNS`):
   - `/computing/i`, `/fermenting/i`, `/thinking/i`, `/reading/i`, `/writing/i`, `/editing/i`, `/searching/i`, `/running/i`, `/executing/i`, `/tool use/i`, `/\bBash\b/`, `/\bRead\b/`, `/\bWrite\b/`, `/\bEdit\b/`, `/\bGrep\b/`, `/\bGlob\b/`, `/\bTask\b/`
2. **Idle prompt detection**:
   - `/^[>\$#]\s*$/` (regex on last line)
   - `lastLine.endsWith('?')`
   - `lastLine.includes('What would you like')`
3. **Lazy patterns** (regex loop over `LAZY_PATTERNS`):
   - `/what would you like me to do\??/i`
   - `/option\s*[123]:/i`
   - `/options?:/i`
   - `/would you prefer/i`
   - `/should I (continue|proceed|stop)/i`
   - `/this would take \d+[-–]\d+ hours/i`
   - `/estimated \d+ hours/i`
   - `/manual intervention/i`
   - `/requires human/i`
   - `/stop here/i`
   - `/deferred (to|for) (future|later|follow-up)/i`
   - `/future PR/i`
   - `/follow-up issue/i`
   - `/documented for later/i`
   - `/remaining work documented/i`
   - `/targeted approach/i`
   - `/infrastructure.*(complete|done).*tests.*(fail|broken)/i`

**What it does on match:**
If active-status patterns match first, returns `{isLazy: false}` immediately. If agent appears idle (prompt indicators) AND a lazy pattern matches, returns `{isLazy: true, matchedPattern, output}`. This triggers `sendAntiLazyMessage()` from the patrol cycle.

**WHY it looks for this:**
- `stuck_detection` — detecting that the agent is stuck/hung/blocked (specifically: avoiding work at an idle prompt)

**Current implementation:**
```typescript
const stdout = await capturePaneAsync(sessionName, 20);
for (const pattern of ACTIVE_STATUS_PATTERNS) {
  if (pattern.test(stdout)) {
    return { isLazy: false };
  }
}
const isAtPrompt = lastLine.match(/^[>\$#]\s*$/) ||
                   lastLine.endsWith('?') ||
                   lastLine.includes('What would you like');
if (!isAtPrompt) {
  return { isLazy: false };
}
for (const pattern of LAZY_PATTERNS) {
  if (pattern.test(stdout)) {
    return { isLazy: true, matchedPattern: pattern.source, output: stdout.slice(-500) };
  }
}
```

---

### src/lib/cloister/deacon.ts:849 — `isAgentActiveInTmux`

**Patterns searched for:**
- `ACTIVE_STATUS_PATTERNS` (same 17 regex patterns as above)
- `/thinking|fermenting/i` (special handling for duration check)

**What it does on match:**
Returns `true` if any active-status pattern matches the bottom 8 non-blank lines of pane output. Special case: if `thinking|fermenting` matches, calls `parseThinkingDuration()`; if duration exceeds `STUCK_THINKING_THRESHOLD_MS` (10 minutes), returns `false` (stuck, not active).

**WHY it looks for this:**
- `activity_detection` — detecting that the AI is actively working/thinking/processing

**Current implementation:**
```typescript
const stdout = await capturePaneAsync(sessionName, 5);
const lines = stdout.split('\n').filter(l => l.trim().length > 0);
const tail = lines.slice(-8).join('\n');
for (const pattern of ACTIVE_STATUS_PATTERNS) {
  if (pattern.test(tail)) {
    if (/thinking|fermenting/i.test(tail)) {
      const thinkingMs = parseThinkingDuration(tail);
      if (thinkingMs !== null && thinkingMs >= STUCK_THINKING_THRESHOLD_MS) {
        return false; // Stuck, not active
      }
    }
    return true;
  }
}
```

---

### src/lib/cloister/deacon.ts:935 — `parseThinkingDuration`

**Patterns searched for:**
- `/(?:[Tt]hinking|[Ff]ermenting)[^\n]*?\((?:(\d+)m\s*)?(\d+)s/` (regex)

**What it does on match:**
Extracts minutes and seconds from Claude Code's thinking/fermenting status line, converts to milliseconds. Returns `null` if no duration found.

**WHY it looks for this:**
- `metadata_extraction` — extracting known metadata (thinking duration for stuck detection)

**Current implementation:**
```typescript
const match = tmuxOutput.match(/(?:[Tt]hinking|[Ff]ermenting)[^\n]*?\((?:(\d+)m\s*)?(\d+)s/);
if (!match) return null;
const minutes = match[1] ? parseInt(match[1], 10) : 0;
const seconds = parseInt(match[2], 10);
return (minutes * 60 + seconds) * 1000;
```

---

### src/lib/cloister/deacon.ts:955 — `checkStuckWorkAgents`

**Patterns searched for:**
- `Do you want to make this edit to exclude` (`.includes()`)
- `Esc to cancel` AND `Tab to amend` (combined `.includes()`)
- Thinking/fermenting duration via `parseThinkingDuration()` (regex, see above)

**What it does on match:**
1. **Exclude dialog**: sends Escape key to dismiss the interactive dialog, resets agent state to `active`.
2. **Extended thinking**: if thinking duration exceeds `STUCK_THINKING_THRESHOLD_MS` (10 min), initiates three-stage recovery:
   - Attempt 1: Send Escape
   - Attempt 2: Send Ctrl+C
   - Attempt 3+: Kill tmux session and respawn via `launcher.sh`

**WHY it looks for this:**
- `stuck_detection` — detecting that the agent is stuck/hung/blocked
- `dialog_intervention` — detecting an interactive prompt that needs automated dismissal

**Current implementation:**
```typescript
const isExcludeDialog = tmuxOutput.includes('Do you want to make this edit to exclude')
  || tmuxOutput.includes('Esc to cancel') && tmuxOutput.includes('Tab to amend');
if (isExcludeDialog) {
  await execAsync(`${buildTmuxCommandString(['send-keys', '-t', agent.id, 'Escape'])} ...`);
}
const thinkingMs = parseThinkingDuration(tmuxOutput);
if (thinkingMs === null || thinkingMs < STUCK_THINKING_THRESHOLD_MS) {
  continue;
}
// ... escalating recovery sequence
```

---

### src/lib/cloister/review-agent.ts:139 — `parseAgentOutput`

**Patterns searched for:**
- `REVIEW_RESULT:` (`.startsWith()`)
- `FILES_REVIEWED:` (`.startsWith()`)
- `SECURITY_ISSUES:` (`.startsWith()`)
- `PERFORMANCE_ISSUES:` (`.startsWith()`)
- `NOTES:` (`.startsWith()`)

**What it does on match:**
Extracts structured markers from review agent output. Populates `ReviewResult` object with review disposition (`APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`), file list, security/performance issues, and notes.

**WHY it looks for this:**
- `result_extraction` — extracting a structured result (pass/fail, files reviewed, etc.)

**Current implementation:**
```typescript
for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('REVIEW_RESULT:')) {
    reviewResult = trimmed.substring('REVIEW_RESULT:'.length).trim();
  }
  if (trimmed.startsWith('FILES_REVIEWED:')) {
    filesReviewed = value.split(',').map(f => f.trim()).filter(f => f.length > 0);
  }
  // ... SECURITY_ISSUES, PERFORMANCE_ISSUES, NOTES
}
```

---

### src/lib/cloister/merge-agent.ts:412 — `parseAgentOutput`

**Patterns searched for:**
**Structured markers:**
- `MERGE_RESULT:` (`.startsWith()`)
- `RESOLVED_FILES:` (`.startsWith()`)
- `FAILED_FILES:` (`.startsWith()`)
- `TESTS:` (`.startsWith()`)
- `VALIDATION:` (`.startsWith()`)
- `REASON:` (`.startsWith()`)
- `NOTES:` (`.startsWith()`)

**Human-readable fallback (if no structured markers):**
- Success indicators: `merge task complete`, `successfully merged`, `merge complete`, `pushed merge commit`, `successfully merged and pushed`
- Failure indicators: `merge failed`, `merge task failed`, `could not merge`, `conflict not resolved`
- Test detection: `tests: pass`, `tests passed`, `/\d+ passed/`, `tests: fail`, `tests failed`

**What it does on match:**
Returns `MergeResult` with success/failure status, file lists, test/validation status, and reason. Falls back to human-readable indicators if structured markers are absent.

**WHY it looks for this:**
- `result_extraction` — extracting a structured result (pass/fail, files reviewed, etc.)

**Current implementation:**
```typescript
for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed.startsWith('MERGE_RESULT:')) { ... }
  if (trimmed.startsWith('RESOLVED_FILES:')) { ... }
  // ... FAILED_FILES, TESTS, VALIDATION, REASON, NOTES
}
// Fallback:
const successIndicators = ['merge task complete', 'successfully merged', ...];
const failureIndicators = ['merge failed', 'merge task failed', ...];
const hasSuccessIndicator = successIndicators.some(i => lowerOutput.includes(i));
const hasFailureIndicator = failureIndicators.some(i => lowerOutput.includes(i));
```

---

### src/lib/cloister/merge-agent.ts:684 — `scanGitPatterns`

**Patterns searched for:**
- `/force-with-lease/i` → `force_push_cmd`
- `/git push/i` → `push_attempt`
- `/git fetch/i` → `fetch_attempt`
- `/\[rejected\]/i` → `push_rejected`
- `/non-fast-forward/i` → `non_ff`
- `/retrying/i` → `retry`
- `/\[remote rejected\]/i` → `remote_rejected`
- `/Everything up-to-date/i` → `push_noop`

**What it does on match:**
Scans each line of tmux output for git operation patterns. Emits `git_operations` database row with operation type, branch, issue ID, status, and error text. Uses line-hash deduplication to avoid duplicate entries.

**WHY it looks for this:**
- `metadata_extraction` — extracting known metadata (git operation audit trail)

**Current implementation:**
```typescript
for (const { re, operation, level } of GIT_PATTERNS) {
  if (re.test(trimmed)) {
    seenLineHashes.add(hash);
    appendGitOperation({ operation, branch, issueId, status, error, ts });
    emitActivityEntry({ source: 'merge-agent', level, message, issueId });
    break;
  }
}
```

---

### src/lib/cloister/merge-agent.ts:1071 — `pollMergeCompletion` (test baseline extraction)

**Patterns searched for:**
- `/Failed\s*│\s*(\d+)\s*│/` (regex)

**What it does on match:**
Extracts the number of failed tests from the specialist output table (Vitest-style output) to establish a baseline for post-merge validation comparison.

**WHY it looks for this:**
- `metadata_extraction` — extracting known metadata (test failure baseline)

**Current implementation:**
```typescript
const specialistOutput = await captureTmuxOutput(mergeSession);
const baselineMatch = specialistOutput.match(/Failed\s*│\s*(\d+)\s*│/);
specialistBaseline = baselineMatch ? parseInt(baselineMatch[1], 10) : undefined;
```

---

### src/lib/cloister/merge-agent.ts:1744 — `resolveConflictsWithAgent` (sync-main polling)

**Patterns searched for:**
- `MERGE_RESULT:` (`.includes()`)
- `merge task complete` (lowercased `.includes()`)
- `successfully merged` (lowercased `.includes()`)
- `merge complete` (lowercased `.includes()`)
- `merge failed` (lowercased `.includes()`)
- `merge task failed` (lowercased `.includes()`)

**What it does on match:**
Polls tmux output every 5 seconds for up to 15 minutes. When structured or human-readable merge completion markers are detected, calls `parseAgentOutput()` to extract the full result. On success, verifies no leftover conflict markers remain; on failure, aborts the merge.

**WHY it looks for this:**
- `result_extraction` — extracting a structured result (pass/fail, files reviewed, etc.)

**Current implementation:**
```typescript
const output = await captureTmuxOutput(tmuxSession);
const hasStructured = output.includes('MERGE_RESULT:');
const lowerOutput = output.toLowerCase();
const hasHumanReadable =
  lowerOutput.includes('merge task complete') ||
  lowerOutput.includes('successfully merged') ||
  lowerOutput.includes('merge complete') ||
  lowerOutput.includes('merge failed') ||
  lowerOutput.includes('merge task failed');
if (hasStructured || hasHumanReadable) {
  const agentResult = parseAgentOutput(output);
  // ...
}
```

---

### src/dashboard/server/routes/conversations.ts:81 — `waitForClaudeReady`

**Patterns searched for:**
- `❯` (`.includes()`)

**What it does on match:**
Polls tmux output every 500ms for up to 30 seconds. Returns when Claude Code prompt is detected, indicating the session is ready for input.

**WHY it looks for this:**
- `activity_detection` — detecting that the AI is actively working/thinking/processing (ready state)

**Current implementation:**
```typescript
const output = await capturePaneAsync(tmuxSession, 200);
if (output.includes('❯')) {
  console.log(`[conversations] Claude Code ready in ${tmuxSession}`);
  return;
}
```

---

### src/dashboard/server/routes/mission-control.ts:297 — `buildMissionControlTranscript` (specialist output filter)

**Patterns searched for:**
- `issueId.toUpperCase()` (`.includes()`)
- `issueId` (original case, `.includes()`)
- `issueLower` (`.includes()`)

**What it does on match:**
Captures specialist tmux output and filters it: only includes the output in the mission control transcript if it mentions the current issue ID. If output exists but doesn't mention the issue, shows a "Waiting" placeholder instead.

**WHY it looks for this:**
- `other` — filtering unrelated specialist output to show only relevant content to the user

**Current implementation:**
```typescript
const output = (await capturePaneAsync(tmuxName, 100)).trim();
if (output && (output.includes(issueId.toUpperCase()) || output.includes(issueId) || output.includes(issueLower))) {
  transcriptParts.push(`\n--- Live Output ---\n${output}`);
} else if (output) {
  transcriptParts.push(`\n--- Waiting ---\nSpecialist is processing another issue. Will update when it reaches ${issueId}.`);
}
```

---

### src/dashboard/server/routes/workspaces.ts:931 — `getWorkspaceRoute` (model extraction)

**Patterns searched for:**
- `/\[((?:oai|cx|go)?@?(?:gpt-[0-9.]+(?:-mini|-nano|-pro)?|o[1-4](?:-mini)?(?:-high)?|gemini-[0-9.]+(?:-pro|-flash|-lite)?))[^\]]*\]/i` (regex)
- `/\[(Opus|Sonnet|Haiku)[^\]]*\]/i` (regex)

**What it does on match:**
Extracts the active AI model name from tmux pane output by matching model identifiers inside square brackets (e.g., `[Sonnet 4.6]`, `[gpt-5.4]`).

**WHY it looks for this:**
- `metadata_extraction` — extracting known metadata (model name)

**Current implementation:**
```typescript
const modelMatch = paneOutput.match(
  /\[((?:oai|cx|go)?@?(?:gpt-[0-9.]+(?:-mini|-nano|-pro)?|o[1-4](?:-mini)?(?:-high)?|gemini-[0-9.]+(?:-pro|-flash|-lite)?))[^\]]*\]/i
) || paneOutput.match(/\[(Opus|Sonnet|Haiku)[^\]]*\]/i);
agentModel = modelMatch ? modelMatch[1] : undefined;
```

---

## Call Sites That Capture But Do NOT Scan

The following locations call `capturePaneAsync()` but do not perform any pattern matching on the captured output (they simply return, save, or display it raw):

- `src/lib/agents.ts:1224` — `stopAgentAsync`: captures 5000 lines and saves to `output.log`
- `src/lib/health.ts:91` — `getAgentOutput`: returns trimmed output as-is
- `src/dashboard/lib/health-filtering.ts:13` — `checkAgentHealthAsync`: returns `{alive, lastOutput}`
- `src/dashboard/server/routes/agents.ts:526` — `getAgentOutputRoute`: returns raw output for dashboard display
- `src/dashboard/server/routes/mission-control.ts:161` — captures 500 lines for transcript display
- `src/dashboard/server/routes/mission-control.ts:297` (review branch): captures and appends raw output
- `src/dashboard/server/ws-terminal.ts:89` — terminal streaming via WebSocket

---

## Risk Assessment

### High Risk
1. **`confirmDelivery()`** — False positives on stale output could mask real delivery failures. 14 patterns are checked; if any appear in pre-existing pane content, delivery is falsely confirmed.
2. **`parseThinkingDuration()`** — Regex must match Claude Code's evolving status format. If the format changes, stuck agent recovery will not trigger.
3. **`checkLazyAgent()`** — 17 active-status patterns + 17 lazy patterns. Overly broad lazy patterns could interrupt working agents; missed active patterns could misclassify computing agents as lazy.

### Medium Risk
4. **`parseAgentOutput()` (review-agent)** — Structured markers are reliable, but agents may omit them. No human-readable fallback exists for review results (unlike merge-agent).
5. **`parseAgentOutput()` (merge-agent)** — Human-readable fallback adds ambiguity. Success/failure indicators could match false positives in unrelated output.
6. **`checkStuckWorkAgents()`** — Exclude-dialog detection uses simple `.includes()`; could misfire if those strings appear in legitimate output.

### Low Risk
7. **`scanGitPatterns()`** — False positives produce spurious audit records but do not affect functionality.
8. **Model extraction** — Non-critical enrichment; fallback to `getActiveSessionModel()` exists.
9. **`waitForClaudePrompt()` / `waitForClaudeReady()`** — Low risk; timeout handles missed prompts.

---

## Testing Recommendations

1. **`waitForClaudePrompt()`** — Unit tests for timeout, double-poll confirmation, session-death mid-poll.
2. **`confirmDelivery()`** — Test each of the 14 patterns in isolation; verify no false positive when pattern exists in `outputBefore`.
3. **`parseThinkingDuration()`** — Edge cases: `0m 5s`, `59m 59s`, missing minutes group, non-ASCII ellipsis variants.
4. **`checkLazyAgent()`** — Verify no false lazy detection when agent shows any ACTIVE_STATUS_PATTERNS.
5. **`checkStuckWorkAgents()`** — Test exclude-dialog dismissal; test thinking-duration threshold boundary (exactly 10 min vs. 10 min + 1s).
6. **Result extraction** — Verify both structured-marker and human-readable fallback paths for merge-agent.
7. **`scanGitPatterns()`** — Verify each GIT_PATTERNS regex matches expected git output lines.
8. **Model extraction** — Test with actual Claude Code output containing `[Sonnet 4.6]`, `[gpt-5.4]`, `[o3]`.

---

## Audit Completeness

- [x] All `capturePaneAsync()` call sites identified (22 total, 20 with pattern scanning)
- [x] All `captureTmuxOutput()` call sites identified (3 total, all with pattern scanning)
- [x] All `.includes()`, `.indexOf()`, `.match()`, `.test()`, `.search()`, `.startsWith()`, `.endsWith()` on captured tmux text documented
- [x] Status markers (`REVIEW_RESULT:`, `FILES_REVIEWED:`, `MERGE_RESULT:`, `RESOLVED_FILES:`, `FAILED_FILES:`, `TESTS:`, `VALIDATION:`, `NOTES:`) documented
- [x] Model extraction regex documented
- [x] Thinking duration parsing documented
- [x] Exclude-from-context dialog detection documented
- [x] All other tmux text scraping for decision-making documented

**Total pattern-scanning locations**: 20  
**Total files affected**: 12  
**Total distinct patterns/regexes**: 70+

---

## References

- [GitHub Issue #798](https://github.com/eltmon/panopticon-cli/issues/798)
