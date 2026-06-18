# Critical Bugs Found in PAN-81 Implementation

## 🔴 CRITICAL: Cache Line Tracking Bug

**File**: `src/lib/costs/aggregator.ts`
**Line**: 124
**Severity**: CRITICAL - Causes cache desync with malformed data

### Problem
```typescript
cache.lastEventLine += events.length;
```

If malformed events are skipped during parsing, `events.length` won't match the actual number of lines read from the file. This causes the cache to lose track of its position in the events.jsonl file.

### Impact
- Cache becomes out of sync with events file
- Duplicate event processing possible
- Missing events possible
- Cache rebuild required to fix

### Example
```
events.jsonl has lines 0-104 (105 total lines)
Line 50 is malformed and skipped
readEventsFromLine(100) reads lines 100-104 but only returns 4 events (line 102 was malformed)
cache.lastEventLine = 100 + 4 = 104 (WRONG!)
Should be 105 (total lines)
Next sync will re-read line 104
```

### Solution
Track actual line numbers, not event count. Modify `readEventsFromLine` to return `{ events: CostEvent[], lastLine: number }`.

---

## 🟡 MEDIUM: Agent ID Fallback Issue

**File**: `scripts/record-cost-event.js`
**Line**: 67
**Severity**: MEDIUM - Incorrect agent tracking

### Problem
```javascript
const agentId = process.env.OVERDECK_AGENT_ID ||
                process.env.TMUX_PANE?.replace(/^%/, '') ||
                'main-cli';
```

Uses `TMUX_PANE` (e.g., "%1") as fallback, but this is a pane ID, not a session name.
Won't match the agentId from heartbeat-hook which uses the session name.

### Impact
- Inconsistent agent IDs in cost tracking
- Harder to correlate costs with agents
- Not critical since OVERDECK_AGENT_ID should always be set

### Solution
Either remove TMUX_PANE fallback or use proper tmux command to get session name.

---

## 🟢 MINOR: Empty Events Array Edge Case

**File**: `src/lib/costs/events.ts`
**Line**: 229
**Severity**: MINOR - Cosmetic issue

### Problem
```typescript
const content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
```

If `events` is empty, this writes a single newline character to the file.

### Impact
- File has trailing newline when empty
- Doesn't affect functionality
- Minor cosmetic issue

### Solution
```typescript
const content = events.length > 0
  ? events.map(e => JSON.stringify(e)).join('\n') + '\n'
  : '';
```

---

## 🔴 CRITICAL: Race Condition in Concurrent Writes

**File**: `src/lib/costs/events.ts`, `src/lib/costs/aggregator.ts`
**Lines**: 76, 105
**Severity**: CRITICAL - Data loss possible

### Problem
Multiple processes (main agent + subagents) can call `appendCostEvent` concurrently.
No file locking mechanism prevents interleaved writes.

### Impact
- Corrupted JSONL lines possible
- Data loss in high-concurrency scenarios
- JSON parse errors on cache rebuild

### Example
```
Process A writes: {"ts":"2026...
Process B writes: {"ts":"2026...  (interrupts A)
Result: {"ts":"2026...{"ts":"2026...  (corrupted)
```

### Solution
Implement file locking using `fs.open` with exclusive mode or use a queue.
Or document that costs are only recorded from heartbeat-hook (single-threaded per agent).

---

## 🟡 MEDIUM: Missing Error Handling in Migration

**File**: `src/lib/costs/migration.ts`
**Line**: Various
**Severity**: MEDIUM - Silent failures

### Problem
Migration continues silently when files are unreadable due to permissions or locks.

### Impact
- Incomplete migration without clear indication
- Users don't know if costs are missing
- Stats show warnings but no clear action

### Solution
Add more detailed logging and a migration verification step that compares totals.

---

## 🟢 MINOR: Floating Point Display in UI

**File**: `src/dashboard/frontend/src/components/CostsPage.tsx`
**Lines**: Various
**Severity**: MINOR - Display inconsistency

### Problem
Some costs display with `.toFixed(2)`, others with `.toFixed(4)`.

### Impact
- Inconsistent precision in UI
- User confusion about actual costs
- Not a calculation error, just display

### Solution
Standardize to `.toFixed(4)` for all costs in the UI or use currency formatting lib.

---

## Verification Needed

1. **Subagent Hook Execution**: Verify that hooks actually fire for subagents
2. **Long-Context Detection**: Test with >200K token sessions
3. **Cache TTL Detection**: Verify 1h vs 5m cache is correctly detected from session files
4. **Provider Auto-Detection**: Test with non-Claude models

---

## Recommended Actions

### Immediate (Before Deployment)
1. ✅ Fix cache line tracking bug (CRITICAL)
2. ✅ Add file locking or document concurrency limitations (CRITICAL)
3. ✅ Fix agent ID fallback (MEDIUM)

### Before Production
4. Add migration verification tests
5. Add integration tests with real session files
6. Stress test with concurrent agents

### Nice to Have
7. Fix minor cosmetic issues
8. Standardize cost display formatting
