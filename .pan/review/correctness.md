# Correctness Review - 2026-04-20T15-30-00

## Summary
Found 5 critical logic errors and 4 warnings in the flywheel implementation. The retro-agent spawn logic has a race condition and missing error handling, retro file path handling uses unsafe string splitting, shell script JSON injection vulnerability, incorrect directory path construction, and potential list flushing bugs in YAML parsing.

## Critical Issues

### 1. [retro-agent.ts:145] Race condition: existingFiles set not populated correctly

**Severity:** Critical  
**Location:** `src/lib/cloister/retro-agent.ts:145`

**Problem:**
```typescript
const existingRetroFiles = new Set(await readdir(retroOutputDir).catch(() => [] as string[]));
// ...
const afterFiles = await readdir(retroOutputDir).catch(() => [] as string[]);
const prefix = `${issueId.toLowerCase()}-`;
const newFile = afterFiles.find(f => f.startsWith(prefix) && !existingFiles.has(f));
```

The `existingRetroFiles` is populated at spawn time (line 105), but then the retro-agent runs for up to 5 minutes. If the agent never creates a file, or if multiple retros for the same issue run in parallel, the logic fails:

1. If two retros for the same issue run concurrently, both capture `existingFiles` at nearly the same time. If the first one writes a file while the second is still running, the second will see that file in `afterFiles` but also in `existingFiles` (race condition).
2. If a retro fails silently and never writes a file, this correctly returns an error, which is good. But there's no cleanup of the session directory on failure.

**Impact:**
- In concurrent retro scenarios, a retro file might not be detected as "new" if it was created by a parallel retro for the same issue.
- Orphaned agent directories accumulate if retro-agent fails.

**Fix:**
Use a true timestamp-based detection instead of file set comparison:
```typescript
// At spawn time, record when we started
const spawnTimeMs = Date.now();
// Later, when polling for completion, check for files newer than spawn time
const afterFiles = await readdir(retroOutputDir).catch(() => [] as string[]);
const newFile = afterFiles.find(async (f) => {
  if (!f.startsWith(prefix)) return false;
  const stat = await fsPromises.stat(join(retroOutputDir, f));
  return stat.mtimeMs >= spawnTimeMs;
});
```

Or simplify by checking if ANY retro file matching the prefix was created and use the most recent one:
```typescript
const candidates = afterFiles.filter(f => f.startsWith(prefix));
if (candidates.length === 0) return { success: false, issueId, error: 'No retro file written' };
const newest = candidates.reduce((a, b) => a > b ? a : b); // sorts lexicographically by timestamp
const retroFilePath = join(retroOutputDir, newest);
```

---

### 2. [flywheel-report.ts:147] Unsafe path construction with split()

**Severity:** Critical  
**Location:** `src/lib/flywheel/flywheel-report.ts:147`

**Problem:**
```typescript
await fsPromises.mkdir(reportPath.split('/').slice(0, -1).join('/'), { recursive: true });
```

This splits the absolute path `/home/user/docs/FLYWHEEL-REPORT.md` on `/`, removes the last part, and rejoins. The result is correct but:
1. On Windows, paths use `\` not `/`, so this breaks entirely
2. If `reportPath` is just a filename with no directory (edge case), `split('/').slice(0, -1)` returns empty array, and `join('/')` produces an empty string

**Impact:**
- Windows systems will fail to create the directory
- Edge case with filename-only paths will create directory at root or fail silently

**Fix:**
Use `dirname()` from the `path` module (already imported):
```typescript
await fsPromises.mkdir(dirname(reportPath), { recursive: true });
```

---

### 3. [retro-writer.ts:133] Unsafe list flushing logic bug

**Severity:** Critical  
**Location:** `src/lib/flywheel/retro-writer.ts:128-173`

**Problem:**
```typescript
if (kvMatch) {
  // Flush previous list
  if (currentKey && inList) {
    fm[currentKey] = listItems.splice(0);  // ← splice() mutates listItems!
    inList = false;
  }
  // ... set new currentKey and process value ...
}

// Later, at the end:
if (currentKey && inList) {
  fm[currentKey] = listItems;  // ← same array reference
}
```

The `listItems.splice(0)` mutates the array AND returns it. For the final list (after the loop exits), the code assigns the same `listItems` array reference. This creates a shared reference where future mutations to `listItems` would corrupt `fm[currentKey]`.

More critically: if the YAML has multiple list keys, only the FINAL list is preserved correctly because each intermediate `splice(0)` empties the array, but then the same `listItems = []` is reused without resetting it for the next key.

**Impact:**
- Multiple proposed_changes fields will not parse correctly
- The frontmatter object will contain corrupted or missing proposed_changes arrays

**Fix:**
Create a fresh array for each list and don't reuse `listItems`:
```typescript
if (kvMatch) {
  // Flush previous list
  if (currentKey && inList) {
    fm[currentKey] = [...listItems];  // Copy the array instead of splicing
    inList = false;
    listItems.length = 0;  // Clear for next list
  }
  // ...
}

// At the end:
if (currentKey && inList) {
  fm[currentKey] = listItems;  // Now safe because no previous list references this
}
```

---

### 4. [pre-tool-hook:108] JSON injection vulnerability in shell script

**Severity:** Critical  
**Location:** `scripts/pre-tool-hook:108`

**Problem:**
```bash
curl -s -X POST "http://localhost:3011/api/agents/$AGENT_ID/heartbeat" \
  -H "Content-Type: application/json" \
  -d "{"state":"$AGENT_STATE","tool":"$TOOL_NAME","timestamp":"$(date -Iseconds)"}" \
  > /dev/null 2>&1 &
```

The JSON is constructed using double-quoted strings with shell variables. If `$TOOL_NAME` contains a double-quote or curly brace, it will break the JSON:
- `TOOL_NAME='foo"bar'` → `"tool":"foo"bar"}` (invalid JSON)
- `TOOL_NAME='foo}'` → `"tool":"foo}"}` (breaks structure)

**Impact:**
- Malformed JSON sent to dashboard API
- If the tool name comes from user input or agent state (which it does), attackers could inject arbitrary JSON

**Fix:**
Use `jq` (which is already used elsewhere in the script) or proper escaping:
```bash
if curl -s -f --max-time 0.5 "http://localhost:3011/health" > /dev/null 2>&1; then
  jq -n \
    --arg agent "$AGENT_ID" \
    --arg state "$AGENT_STATE" \
    --arg tool "$TOOL_NAME" \
    --arg ts "$(date -Iseconds)" \
    '{agent: $agent, state: $state, tool: $tool, timestamp: $ts}' | \
  curl -s -X POST "http://localhost:3011/api/agents/$AGENT_ID/heartbeat" \
    -H "Content-Type: application/json" \
    -d @- > /dev/null 2>&1 &
fi
```

---

### 5. [issue-filer.ts:192] Path traversal risk in retro filename extraction

**Severity:** Critical  
**Location:** `src/lib/flywheel/issue-filer.ts:192`

**Problem:**
```typescript
triggeringRetros: proposal.triggeringRetros.map((p) => p.split('/').pop() ?? p),
```

The `proposal.triggeringRetros` array contains full paths from the synthesis module. If a malicious or corrupted retro path contains `../`, the split-and-pop logic will fail to strip it:
- Path: `../../../etc/passwd` → split gives `['..', '..', '..', 'etc', 'passwd']` → pop gives `'passwd'` ✓ (correct by accident)
- Path: `archive/../../../etc/passwd` → same result

However, the real issue is that we're stripping the path and trusting the filename as safe for display. If a retro filename itself contains `/` (which is technically possible on some filesystems after corruption), this could expose that corruption.

More critically: the code assumes absolute paths always have `/` as separator. On Windows with paths like `C:\docs\flywheel\retros\PAN-709-123456.md`, `split('/')` will NOT strip the directory part.

**Impact:**
- On Windows, full paths are displayed in the GitHub issue body instead of just the filename
- Path traversal sequences in corrupt filenames could be visible

**Fix:**
Use `basename()` from `path` module:
```typescript
import { basename } from 'path';
// ...
triggeringRetros: proposal.triggeringRetros.map((p) => basename(p)),
```

---

## Warnings

### 1. [synthesis.ts:237] Uninitialized field access without null check

**Severity:** Warning  
**Location:** `src/lib/flywheel/synthesis.ts:237`

**Problem:**
```typescript
const frictionScore = doc.frontmatter.friction_score ?? 0;
const proposedChanges = doc.frontmatter.proposed_changes ?? [];
```

The `RetroFrontmatter` interface defines `friction_score` and `proposed_changes` as required fields (non-optional). However, `parseRetroMarkdown()` returns a frontmatter that is cast `as unknown as RetroFrontmatter` without validation. If a retro file has malformed YAML, the parser may return partial data.

The null-coalescing `??` will convert `undefined` to `0` or `[]`, which masks parsing errors and silently produces garbage proposals.

**Conditions:**
- When a retro file has malformed YAML that the custom YAML parser mishandles
- When the retro file is truncated or corrupted

**Fix:**
Add validation before grouping:
```typescript
const validationResult = validateRetro(doc);
if (!validationResult.valid) {
  console.warn(`[synthesis] Skipping invalid retro at ${path}:`, validationResult.errors);
  continue;
}
```

---

### 2. [retro-inputs.ts:145-153] Missing null check on exec output

**Severity:** Warning  
**Location:** `src/lib/flywheel/retro-inputs.ts:145-153`

**Problem:**
```typescript
async function fetchPrComments(issueId: string, workspacePath: string | null): Promise<string | null> {
  try {
    const branch = `feature/${issueId.toLowerCase()}`;
    const opts = workspacePath ? { timeout: 15_000, cwd: workspacePath } : { timeout: 15_000 };
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', branch,
      '--json', 'number,body,comments,reviews',
      '--jq', '.comments[].body + "\n---\n" + .reviews[].body',
    ], opts);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
```

The `--jq` filter `.comments[].body + "\n---\n" + .reviews[].body` assumes both `comments` and `reviews` arrays exist and have `.body` fields. If a PR has no comments or reviews, this filter will return an empty string, which `stdout.trim() || null` converts to `null` (correct). But if `gh` outputs an error that contains only whitespace, it also silently becomes `null`.

**Conditions:**
- When PR comments fetch fails silently due to network issues
- When gh CLI behavior changes

**Fix:**
Check the exit code and stderr separately, or add validation:
```typescript
try {
  const { stdout, stderr } = await execFileAsync('gh', [...]);
  if (stderr) {
    console.warn(`[retro-inputs] gh pr view stderr: ${stderr}`);
  }
  return stdout.trim() || null;
} catch (err) {
  console.warn(`[retro-inputs] Failed to fetch PR comments: ${err}`);
  return null;
}
```

---

### 3. [synthesis.ts:264] O(n²) lookup in retro path deduplication

**Severity:** Warning  
**Location:** `src/lib/flywheel/synthesis.ts:264-266`

**Problem:**
```typescript
// Avoid duplicating the same retro path for multiple proposed_changes
if (!acc.retroPaths.includes(path)) {
  acc.retroPaths.push(path);
}
```

This uses `.includes()` to check if a path already exists in the array. For each proposed_change in a retro, this is O(n) where n = retroPaths.length. If a single retro has many proposed_changes and the accumulator has many retros, this becomes O(n²).

**Impact:**
- Performance degradation if a single retro proposes many changes (e.g., 10+ changes) and a proposal accumulates 100+ retros
- Not a bug, but inefficient

**Fix:**
Use a Set to track seen paths:
```typescript
// At the accumulator level (in RetroSignalAccumulator):
const retroPathsSet = new Set(acc.retroPaths);
if (!retroPathsSet.has(path)) {
  acc.retroPaths.push(path);
  retroPathsSet.add(path);
}
```

---

### 4. [retro-agent.ts:102-108] No validation of retro-agent prompt file contents

**Severity:** Warning  
**Location:** `src/lib/cloister/retro-agent.ts:102-108`

**Problem:**
```typescript
const promptFilePath = join(agentDir, 'retro-prompt.md');
await mkdir(agentDir, { recursive: true });
const retroPrompt = buildRetroPrompt(issueId, inputs);
await writeFile(promptFilePath, retroPrompt, 'utf-8');
```

The prompt is written and then immediately passed to Claude Code via `cat`. If `buildRetroPrompt()` returns an empty string or malformed markdown, Claude Code receives garbage instructions.

More critically: there's no check that the bounded inputs are actually non-empty. If `gatherRetroInputs()` returns an empty bundle (no STATE.md, no feedback, no tmux tails, etc.), the retro-agent still spawns with essentially no context and will likely time out or hallucinate.

**Conditions:**
- When `buildRetroPrompt()` is called with empty/null inputs
- When the workspace has no planning artifacts

**Fix:**
Validate that at least one meaningful input exists:
```typescript
const inputs = await gatherRetroInputs(issueId);

// Check if we have meaningful input
if (!inputs.stateMd && !inputs.vbriefJson && 
    Object.keys(inputs.feedbackFiles).length === 0 &&
    !inputs.flywheelStateRow) {
  console.warn(`[retro-agent] No meaningful inputs gathered for ${issueId}, skipping spawn`);
  return {
    success: false,
    issueId,
    error: 'No planning artifacts found — cannot write meaningful retro',
  };
}
```

---

## Suggestions

### 1. [synthesis.ts:297-299] Inefficient filter ratio calculation

**Location:** `src/lib/flywheel/synthesis.ts:297-299`

**Suggestion:**
```typescript
const filterRatio = processedRetros.length === 0
  ? 0
  : surpriseCount / processedRetros.length;
```

This recalculates `processedRetros.length` even though it's already accessed multiple times. Consider pre-computing:

```typescript
const totalProcessed = processedRetros.length;
const filterRatio = totalProcessed === 0 ? 0 : surpriseCount / totalProcessed;
```

**Benefit:**
Minor performance improvement and more readable intent.

---

### 2. [retro-archiver.ts:62-68] Unchecked sort on run directory names

**Location:** `src/lib/flywheel/retro-archiver.ts:62-68`

**Suggestion:**
```typescript
const runDirs = entries.filter(e => /^run-\d+$/.test(e));
if (runDirs.length === 0) return 1;
const nums = runDirs.map(d => parseInt(d.slice(4), 10)).filter(n => !isNaN(n));
return Math.max(...nums) + 1;
```

If all entries are filtered out as NaN, `Math.max()` returns `-Infinity`. Add a fallback:

```typescript
const nums = runDirs.map(d => parseInt(d.slice(4), 10)).filter(n => !isNaN(n));
if (nums.length === 0) return 1;
return Math.max(...nums) + 1;
```

**Benefit:**
Prevents edge case where all run directories have corrupted names.

---

### 3. [issue-filer.ts:189] Potential NaN from parseInt

**Location:** `src/lib/flywheel/issue-filer.ts:189`

**Suggestion:**
```typescript
issueNumber: parseInt(issue.url.split('/').pop() ?? '', 10),
```

If `issue.url` doesn't contain `/` (malformed URL), or the last segment is not numeric, `parseInt()` returns `NaN`. This is then stored in the FiledIssue object.

**Fix:**
```typescript
const issueNumStr = issue.url.split('/').pop() ?? '';
const issueNumber = parseInt(issueNumStr, 10) || 0;
if (isNaN(issueNumber) || issueNumber === 0) {
  console.warn(`[issue-filer] Could not extract issue number from URL: ${issue.url}`);
  continue; // Skip this issue instead of storing invalid NaN
}
```

**Benefit:**
Prevents NaN from being stored in records and failing downstream JSON serialization.

---

## Summary Statistics

- **Critical:** 5
  - Race condition in retro file detection
  - Unsafe path construction on Windows
  - List flushing array reference bug
  - JSON injection in shell script
  - Path traversal in retro filename extraction
- **Warnings:** 4
  - Unvalidated frontmatter field access
  - Missing error handling in gh CLI calls
  - O(n²) array lookup
  - Missing validation of input bundle
- **Suggestions:** 3
  - Inefficient computation
  - Unchecked Math.max() edge case
  - NaN from parseInt not validated
- **Files reviewed:** 12
  - src/lib/cloister/retro-agent.ts
  - src/lib/cloister/merge-agent.ts
  - src/lib/cloister/specialists.ts
  - src/lib/cloister/service.ts
  - src/lib/flywheel/retro-inputs.ts
  - src/lib/flywheel/retro-writer.ts
  - src/lib/flywheel/synthesis.ts
  - src/lib/flywheel/issue-filer.ts
  - src/lib/flywheel/flywheel-report.ts
  - src/lib/flywheel/retro-archiver.ts
  - src/lib/flywheel/synthesis-commit.ts
  - scripts/pre-tool-hook

## Notes on Compliance

- **CLAUDE.md blocking calls rule:** The retro-inputs.ts and retro-writer.ts correctly use `fs/promises` throughout. However, `specialists.ts` and `merge-agent.ts` contain many `readFileSync`, `writeFileSync`, `mkdirSync`, and `appendFileSync` calls. These are NOT in dashboard routes (they're specialist launch code), so they comply with the rule. Verify they are not called from dashboard server routes.
  
- **postMergeLifecycle idempotency:** The guard at line 173 in merge-agent.ts (`if (_completedPostMerge.has(issueId))`) is present and correctly prevents re-entry. The Docker cleanup step 6 is present and not removed (line 322-340).

- **AC coverage:** The plan.vbrief.json shows AC items for all major beads. Most are properly addressed, but the critical bugs found here indicate that some ACs were marked complete prematurely (e.g., retro-writer validation, synthesis thresholding).
