# Correctness Review - PAN-709

**Timestamp:** 2026-04-20  
**Scope:** Self-improving flywheel — retro-agent, synthesis, issue filing, daemon, skill audience routing  
**Reviewed Files:** 40+ source files in `src/lib/flywheel/`, `src/lib/cloister/`, `src/dashboard/server/`, `src/dashboard/frontend/`

## Summary

Found **4 critical correctness issues** affecting core pipeline logic, **3 warnings** for potential edge case bugs, and **5 suggestions** for robustness improvements. The implementation is largely sound with proper async/await discipline, but several edge cases and race condition scenarios pose production risks.

---

## Critical Issues

### 1. [retro-agent.ts:104-105] Silent failure when retro output directory doesn't exist

**Severity:** Critical  
**Location:** `src/lib/cloister/retro-agent.ts:104-105`

**Problem:**
```typescript
const retroOutputDir = join(cwd, 'docs', 'flywheel', 'retros');
const existingRetroFiles = new Set(await readdir(retroOutputDir).catch(() => [] as string[]));
```

The code silently swallows directory-not-found errors by catching and returning an empty array. If the `docs/flywheel/retros/` directory does not exist (e.g., on first retro run), `readdir()` returns `[]`. The subsequent `waitForRetroCompletion()` polls for new files, but if the retro process itself fails to create the directory before writing, the detection logic will never find the file (checking if `newFile` exists in `afterFiles`), even if the retro was written to a different location.

**Impact:**
- Retro files written to an alternate location are never detected as "success"
- The daemon reports "No retro file written by agent" even though one exists
- Retros are lost and never fed into synthesis, breaking the improvement loop
- Watchlist accumulation fails (retros can't be aged out if never recorded)

**Fix:**
Ensure the retro output directory exists before spawning the retro-agent, or parse the retro-agent's output to extract the exact file path it wrote:

```typescript
// Create the directory if it doesn't exist
const retroOutputDir = join(cwd, 'docs', 'flywheel', 'retros');
await mkdir(retroOutputDir, { recursive: true });
const existingRetroFiles = new Set(await readdir(retroOutputDir).catch(() => [] as string[]));
```

Alternatively, instruct retro-agent to output the exact path it wrote, then parse it from the session log.

---

### 2. [synthesis.ts:261-266] Duplicate retro paths accumulate in proposal triggering list

**Severity:** Critical  
**Location:** `src/lib/flywheel/synthesis.ts:261-266`

**Problem:**
```typescript
const acc = accumulators.get(key)!;
acc.frictionScores.push(frictionScore);
// Avoid duplicating the same retro path for multiple proposed_changes
if (!acc.retroPaths.includes(path)) {
  acc.retroPaths.push(path);
}
```

The code uses `.includes()` to check if a path already exists in the array before pushing. This is an O(n) linear search per retro, and with hundreds or thousands of retros, it becomes O(n²) overall. More critically, if a single retro has multiple `proposed_changes` that map to the same (targetSkill, audience, gapDescription) signature, the check prevents duplication **within the same signature**, but the path may legitimately appear in multiple signatures.

The real issue: if a retro is processed twice (e.g., due to a partial crash and recovery), or if the file system has a duplicate file with the same timestamp, the deduplication will only catch duplicates *within the same accumulator*, not across multiple synthesis runs or corrupted state.

**Impact:**
- O(n²) performance on large retro sets (hundreds of retros → second-long synthesis runs)
- Risk of phantom "duplicate" paths in proposals if synthesis is retried
- Archiver may fail to archive all contributing retros if the list is corrupted
- Provenance tracking loses signal history

**Fix:**
Use a `Set` to track added paths in each accumulator:

```typescript
interface RetroSignalAccumulator {
  signature: ProposalSignature;
  changeType: ProposedChange['type'];
  changeDescription: string;
  frictionScores: number[];
  retroPaths: string[];
  seenPaths: Set<string>;  // Add this
}

// In the loop:
if (!acc.seenPaths.has(path)) {
  acc.retroPaths.push(path);
  acc.seenPaths.add(path);
}

// Initialize:
accumulators.set(key, {
  signature: sig,
  changeType: signal.changeType,
  changeDescription: signal.changeDescription,
  frictionScores: [],
  retroPaths: [],
  seenPaths: new Set(),
});
```

---

### 3. [flywheel-daemon.ts:407-414] Race condition in pending retros queue — fire-and-forget spawns

**Severity:** Critical  
**Location:** `src/lib/cloister/flywheel-daemon.ts:407-414`

**Problem:**
```typescript
const pending = await loadPendingRetros();
if (pending.length > 0) {
  await savePendingRetros([]);  // Clear before spawning
  for (const pendingIssueId of pending) {
    console.log(`[flywheel-daemon] Draining pending retro for ${pendingIssueId}`);
    spawnRetroAgentForIssue(pendingIssueId).catch(err =>
      console.warn(`[flywheel-daemon] Failed to drain pending retro for ${pendingIssueId}:`, err)
    );
  }
}
```

The code clears the pending queue **before** spawning the retro agents, using fire-and-forget (no `await`). If any spawn fails or the daemon crashes before all spawns complete, pending retros are lost permanently. The next tick will see an empty queue and never retry.

Timeline:
1. Load pending: `["PAN-709", "PAN-710"]`
2. Clear queue: `savePendingRetros([])`
3. Spawn PAN-709 → starts tmux session
4. **Daemon crashes or hostname changes** before PAN-710 spawn executes
5. PAN-710 spawn never happens
6. Queue is empty; next tick sees nothing
7. PAN-710 retro is lost forever

**Impact:**
- Pending retros silently disappear if daemon restarts during batch spawning
- Merges that occurred during quiet hours never get retrospectives
- Flywheel signals for those issues are permanently lost
- Watchlist entries can never reach threshold (signal history broken)

**Fix:**
Only clear the queue after **all spawns complete**, and track failures:

```typescript
const pending = await loadPendingRetros();
if (pending.length > 0) {
  const failed: string[] = [];
  for (const pendingIssueId of pending) {
    console.log(`[flywheel-daemon] Draining pending retro for ${pendingIssueId}`);
    try {
      await spawnRetroAgentForIssue(pendingIssueId);
    } catch (err) {
      console.warn(`[flywheel-daemon] Failed to drain pending retro for ${pendingIssueId}:`, err);
      failed.push(pendingIssueId);
    }
  }
  // Only clear items that succeeded
  const succeeded = pending.filter(id => !failed.includes(id));
  await savePendingRetros(failed);  // Persist failed items for next tick
  console.log(`[flywheel-daemon] Drained ${succeeded.length}/${pending.length} pending retros`);
}
```

---

### 4. [retro-writer.ts:174-177] Type assertion bypasses validation — unsafe downcast

**Severity:** Critical  
**Location:** `src/lib/flywheel/retro-writer.ts:174-177`

**Problem:**
```typescript
return {
  frontmatter: fm as unknown as RetroFrontmatter,
  body: body.trim(),
};
```

The parser does not validate the structure of the parsed frontmatter object. It just performs an **unsafe type assertion** `as unknown as RetroFrontmatter`, which tells TypeScript "trust me, this is correct" without actually checking anything at runtime. If the YAML is malformed or missing required fields, the assertion succeeds but returns an invalid object.

This cascades:
- `validateRetro()` is called **after** the unsafe assertion, so it's defensive but comes too late
- The parsing logic (`parseRetroMarkdown`) has no schema validation—it just regex-matches key-value pairs
- If a retro file has typos (e.g., `surprise: "yes"` instead of `true`), the parser treats it as a string, the assertion doesn't catch it, and validation may fail or misbehave

**Impact:**
- Malformed retro files silently parse as partially-valid objects
- Validation errors are not caught until write time (after expensive computation)
- Retro output from agents with schema bugs cascades failures through synthesis
- Archive/wontfix detection relies on these same objects and may fail

**Fix:**
Validate the parsed object structure before the assertion:

```typescript
export function parseRetroMarkdown(content: string): RetroDocument | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const rawFm = match[1];
  const body = match[2] ?? '';

  // ... existing parsing logic ...

  // Perform basic structural validation before type assertion
  if (!fm.issue || !fm.agent || fm.run === undefined || !Array.isArray(fm.proposed_changes)) {
    // Return null for invalid structure — let caller handle
    return null;
  }

  return {
    frontmatter: fm as unknown as RetroFrontmatter,
    body: body.trim(),
  };
}
```

Or better yet, create a proper validation function that returns structured errors.

---

## Warnings

### 1. [retro-archiver.ts:131-135] Stale mtime comparison ignores DST and clock skew

**Severity:** Warning  
**Location:** `src/lib/flywheel/retro-archiver.ts:131-135`

**Problem:**
```typescript
try {
  const stat = await fsPromises.stat(fullPath);
  if (stat.mtimeMs > cutoffMs) continue;  // not old enough
```

The code compares `stat.mtimeMs` (file modification time in milliseconds) against `cutoffMs` (30 days ago in milliseconds). This assumes:
1. The system clock is accurate and monotonic (not true if NTP resets or DST changes)
2. File modification times are reliable across reboots and time zone changes
3. No skew between the daemon's system time and the file system's time

If the system clock drifts or jumps backward (rare but possible), files may be incorrectly aged out or not aged out when they should be. A 1-hour clock skew would cause files to be archived prematurely.

**Impact:**
- Watchlist retros may be wontfixed too early (false negatives, losing signals)
- Retros may not be wontfixed after 30 days if clock drifts backward (false positives)
- Signal accumulation is unreliable in the presence of time jumps

**Conditions:** Clock skew, NTP adjustments, or system time changes during daemon operation.

**Fix:**
Use creation time or a secondary tracking mechanism (e.g., a manifest file with creation timestamps) instead of relying solely on `mtime`:

```typescript
// Option 1: Store creation time in metadata file
const metaFile = join(dirname(fullPath), `.${basename(fullPath)}.meta.json`);
let createdAt: number;
try {
  const meta = JSON.parse(await fsPromises.readFile(metaFile, 'utf-8'));
  createdAt = meta.createdAt ?? stat.birthtimeMs;
} catch {
  createdAt = stat.birthtimeMs ?? stat.ctimeMs;  // fallback
}
if (Date.now() - createdAt > WONTFIX_AGE_MS) { /* age out */ }

// Option 2: Use a separate "wontfix tracking" file
const wontfixTrackingFile = join(RETROS_DIR, 'wontfix-tracking.json');
const tracked = JSON.parse(await fsPromises.readFile(wontfixTrackingFile, 'utf-8').catch(() => '{}'));
if (tracked[filename]?.agedOutAt) continue;  // Already processed
if (Date.now() - tracked[filename]?.firstSeen > WONTFIX_AGE_MS) {
  // Age out logic
}
```

---

### 2. [flywheel-daemon.ts:281-290] Pending retros file corruption silent failure

**Severity:** Warning  
**Location:** `src/lib/cloister/flywheel-daemon.ts:281-290`

**Problem:**
```typescript
async function loadPendingRetros(): Promise<string[]> {
  try {
    const content = await readFile(FLYWHEEL_PENDING_RETROS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

If the JSON file is corrupted (e.g., partial write, truncation), `JSON.parse()` throws and the error is silently swallowed. The function returns an empty array, **even if the file contains pending retros**. Combined with Issue #3 above (fire-and-forget spawns that clear before success), a corrupted file means all pending retros are lost.

**Impact:**
- Corrupted pending-retros file → queue gets reset to empty
- Lost pending retros never get processed
- No logging or visibility into corruption events

**Conditions:** Disk errors, mid-write daemon crash, filesystem corruption.

**Fix:**
Log corruption events and implement recovery:

```typescript
async function loadPendingRetros(): Promise<string[]> {
  try {
    const content = await readFile(FLYWHEEL_PENDING_RETROS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      console.warn(`[flywheel-daemon] Pending retros file has invalid structure (not an array), resetting`);
      return [];
    }
    return parsed;
  } catch (err) {
    console.error(`[flywheel-daemon] Failed to load pending retros (corruption?):`, err);
    // Attempt recovery: read the raw file and try to salvage valid issue IDs
    try {
      const raw = await readFile(FLYWHEEL_PENDING_RETROS_FILE, 'utf-8');
      const matches = raw.match(/PAN-\d+|[A-Z]+-\d+/g) ?? [];
      if (matches.length > 0) {
        console.log(`[flywheel-daemon] Recovered ${matches.length} issue IDs from corrupted file`);
        return matches;
      }
    } catch { /* no recovery possible */ }
    return [];
  }
}
```

---

### 3. [issue-filer.ts:188] Off-by-one risk in issue number parsing

**Severity:** Warning  
**Location:** `src/lib/flywheel/issue-filer.ts:188`

**Problem:**
```typescript
// Parse the visible issue number from the URL — issue.id is GitHub's
// internal node id, which differs from the user-visible issue number.
issueNumber: parseInt(issue.url.split('/').pop() ?? '', 10),
```

The code assumes `issue.url` is a URL like `https://github.com/owner/repo/issues/750`. If `.pop()` returns an empty string (e.g., if the URL ends with `/`), `parseInt('', 10)` returns `NaN`. This passes `NaN` into the `FiledIssue` structure, which can cause:
1. Provenance index corruption (key is `"NaN"`)
2. Dashboard queries fail to find the issue
3. Synthesis report contains invalid issue numbers

**Impact:**
- Provenance tracking corrupted if URL parsing fails
- Flywheel-change issues may not be discoverable by number
- Issue filing succeeds but becomes orphaned

**Conditions:** Malformed issue URL from tracker API, edge case in GitHub response.

**Fix:**
Validate the parsed number:

```typescript
const issueNumStr = issue.url.split('/').pop() ?? '';
const issueNumber = parseInt(issueNumStr, 10);
if (isNaN(issueNumber)) {
  throw new Error(`Failed to parse issue number from URL: ${issue.url}`);
}
filed.push({
  proposalSignature: signatureStr,
  issueNumber,
  issueUrl: issue.url,
  title,
  triggeringRetros: proposal.triggeringRetros.map((p) => p.split('/').pop() ?? p),
});
```

---

## Suggestions

### 1. [retro-inputs.ts:147-152] Timeout protection should be configurable

**Location:** `src/lib/flywheel/retro-inputs.ts:147-152`

The `fetchPrComments()` and `fetchBranchCommits()` functions use hard-coded `15_000`ms timeouts. If GitHub is slow or the network is congested, retro input gathering fails. The daemon has a 5-minute hard cap on retro-agent execution, but inputs are gathered before that timer starts, so a hung `gh` call delays the whole daemon.

**Suggestion:** Make timeouts configurable in cloister config and add exponential backoff:

```typescript
async function fetchPrComments(
  issueId: string,
  workspacePath: string | null,
  timeoutMs: number = 15_000
): Promise<string | null> {
  // ... with configurable timeoutMs
}
```

---

### 2. [synthesis.ts:295] Sorting proposal by friction score may hide important low-friction wins

**Location:** `src/lib/flywheel/synthesis.ts:295`

The synthesis pipeline sorts proposals by median friction score **descending** (worst pain first). This is intuitive but may deprioritize important but low-friction improvements (e.g., adding a missing docstring, fixing a typo in a common skill). Over time, this biases the improvement pipeline toward fire-fighting rather than proactive refinement.

**Suggestion:** Sort by friction score **with a tiebreaker on signal count**:

```typescript
proposals.sort((a, b) => {
  // Primary: friction score descending (worst pain first)
  const frictionDiff = b.medianFrictionScore - a.medianFrictionScore;
  if (frictionDiff !== 0) return frictionDiff;
  // Tiebreaker: signal count descending (broader consensus)
  return b.retroCount - a.retroCount;
});
```

This ensures consistent ordering and prioritizes changes with the most evidence.

---

### 3. [skill-lint.ts:186-187] Reference detection too strict, misses hyphenated single-word skills

**Location:** `src/lib/flywheel/skill-lint.ts:186-187`

```typescript
if (!knownSkills.has(ref) && ref.includes('-') && ref.length > 3) {
  errors.push({
    field: 'reference',
    message: `Broken skill reference: "${ref}" is not a known skill in ${skillsDir}`,
  });
}
```

The linter only flags references that include a dash (`-`) and are longer than 3 characters. This filters out false positives (e.g., matching `a-b` in prose), but it also misses actual broken references like:
- Single-word skills: `pan` (should be `pan-something`)
- Very short skill names: `cd` (2 chars, skipped)
- Skills named with underscores (which the regex doesn't match)

**Suggestion:** Improve the heuristic to whitelist known single-word skill names, or require explicit escaping in SKILL.md body for text that looks like skill refs but isn't:

```typescript
const SINGLE_WORD_SKILL_NAMES = new Set(['pan', 'fly', 'bd']);  // Add as needed

for (const ref of refs) {
  if (!knownSkills.has(ref) && !SINGLE_WORD_SKILL_NAMES.has(ref) && ref.includes('-')) {
    errors.push({...});
  }
}
```

---

### 4. [flywheel-daemon.ts:485-490] Pending retro enqueue uses `.then()` without error handling

**Location:** `src/lib/cloister/flywheel-daemon.ts:485-490`

```typescript
loadPendingRetros().then(pending => {
  if (!pending.includes(issueId)) {
    return savePendingRetros([...pending, issueId]);
  }
}).catch(err => console.warn('[flywheel-daemon] Failed to enqueue pending retro:', err));
```

The promise chain uses `.then()` without a catch on the inner `savePendingRetros()` call. If `savePendingRetros()` rejects, the catch will log it but the enqueue is already lost. This can happen if the file system becomes read-only during quiet hours.

**Suggestion:** Use async/await for clarity:

```typescript
try {
  const pending = await loadPendingRetros();
  if (!pending.includes(issueId)) {
    await savePendingRetros([...pending, issueId]);
    console.log(`[flywheel-daemon] Enqueued pending retro for ${issueId}`);
  }
} catch (err) {
  console.error(`[flywheel-daemon] Failed to enqueue pending retro for ${issueId}:`, err);
  // Optionally: trigger a notification to the operator
}
```

---

### 5. [flywheel-daemon.ts:450-462] Race condition in synthesis scheduling — both timers fire simultaneously

**Location:** `src/lib/cloister/flywheel-daemon.ts:450-462`

```typescript
const doSynthesis = nowMs - lastSynthesisAt > synthIntervalMs;
const doFullCycle = nowMs - lastFullCycleAt > fullCycleIntervalMs;

if (doSynthesis || doFullCycle) {
  if (!await acquireLock()) return;
  try {
    if (doFullCycle) {
      lastFullCycleAt = nowMs;
      console.log('[flywheel-daemon] Full 24h flywheel cycle — running synthesis');
    }
    if (doSynthesis) {
      lastSynthesisAt = nowMs;
    }
    await runSynthesis();  // Only runs once!
  } finally {
    await releaseLock();
  }
}
```

When both `doSynthesis` and `doFullCycle` are true (e.g., on startup, or if the daemon skipped ticks), the code runs `runSynthesis()` once. But it sets **both** `lastFullCycleAt` and `lastSynthesisAt`, so the next tick resets both timers. If a tick is skipped due to active session backoff, the 24-hour full cycle timer is never triggered.

**Impact:**
- Full 24-hour cycles are unreliable — may never run if daemon is frequently backed off
- Synthesis runs are potentially triggered too often (every 30 min AND 24h both reset)

**Suggestion:** Decouple the two timers and only reset the one that actually ran:

```typescript
if (doFullCycle) {
  if (!await acquireLock()) return;
  try {
    lastFullCycleAt = nowMs;
    console.log('[flywheel-daemon] Full 24h flywheel cycle — running synthesis');
    await runSynthesis();
  } finally {
    await releaseLock();
  }
} else if (doSynthesis) {
  if (!await acquireLock()) return;
  try {
    lastSynthesisAt = nowMs;
    console.log('[flywheel-daemon] Scheduled synthesis step');
    await runSynthesis();
  } finally {
    await releaseLock();
  }
}
```

---

## Summary Statistics

| Category | Count |
|----------|-------|
| **Critical** | 4 |
| **Warnings** | 3 |
| **Suggestions** | 5 |
| **Files Reviewed** | 40+ |
| **Lines of Code** | ~4,000+ |

### Critical Issues by Area
- **Retro input/output:** 1 (missing directory creation)
- **Synthesis core:** 1 (O(n²) deduplication, duplicate path risk)
- **Daemon state:** 1 (fire-and-forget race condition in pending queue)
- **Schema validation:** 1 (unsafe type assertions in parser)

### Acceptance Criteria Compliance

Checked against `docs/prds/active/pan-709/plan.vbrief.json`:

✅ Retro-agent spawns and times out correctly (5-min cap enforced)  
✅ Synthesis reads non-archived retros and applies 3-signal threshold  
✅ Skill audience field is parsed with backward-compat default ('operator')  
✅ Issue filer creates GitHub issues with flywheel-change label  
✅ Retro archiver moves processed retros and ages out watchlist entries  
⚠️ Retro output directory creation is unreliable (Issue #1)  
⚠️ Pending retro queue has race condition on clear (Issue #3)  
⚠️ Schema validation happens after unsafe assertion (Issue #4)  

---

## Recommended Actions

**Immediate (before merge):**
1. Fix retro output directory creation (Issue #1) — prevents data loss
2. Fix pending retros race condition (Issue #3) — ensures queue reliability
3. Replace `.includes()` deduplication with `Set` (Issue #2) — prevents O(n²) and data corruption
4. Add validation before type assertion (Issue #4) — prevents schema corruption

**Pre-production:**
1. Implement file corruption recovery in pending retros loader (Warning #2)
2. Add issue number validation in issue-filer (Warning #3)
3. Decouple synthesis and full-cycle timers (Suggestion #5)
4. Add operator logging for filesystem errors and timeouts

**Follow-up work:**
1. Implement reliable file aging (Warning #1) — use metadata files instead of mtime
2. Make network timeouts configurable (Suggestion #1)
3. Improve skill reference detection heuristic (Suggestion #3)

---

## Files with Changes

- ✅ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/flywheel/retro-inputs.ts` — No blocking calls, correct async/await
- ✅ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/flywheel/synthesis.ts` — Correct logic, but O(n²) deduplication and unsafe assertion issues
- ⚠️ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/flywheel/issue-filer.ts` — Issue number parsing risk
- ⚠️ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/flywheel/retro-archiver.ts` — mtime-based aging unreliable
- ⚠️ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/flywheel/retro-writer.ts` — Unsafe type assertion, no structural validation
- 🔴 `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/cloister/retro-agent.ts` — Missing directory creation, unsafe execAsync shell command
- 🔴 `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/cloister/flywheel-daemon.ts` — Race condition in pending queue, timer coupling, silent file corruption
- ✅ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/dashboard/server/routes/flywheel.ts` — All fs/promises (no blocking calls), correct
- ✅ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/tmux.ts` — Correct async variants, unique tmp filenames
- ✅ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/sync.ts` — Correct audience routing, backward-compat default
- ✅ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/template.ts` — Correct file I/O, no blocking calls in code paths
- ✅ `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-709/src/lib/flywheel/skill-lint.ts` — Correct validation logic, minor heuristic improvement suggested

---

**End of Review**
