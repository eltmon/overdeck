# Correctness Review - PAN-709

## Summary
Reviewed 7 flywheel core modules, retro-agent spawn/run lifecycle, tmux enhancements, sync/template updates, and hook scripts. Found 2 critical bugs (logic errors with runtime impact), 4 warnings (edge cases and potential failures), and 2 suggestions for robustness. The flywheel synthesis pipeline is well-structured with comprehensive test coverage, but has issues with error handling, boundary conditions, and file operation atomicity that need addressing.

**Critical Issues Found:** 2
**Warnings:** 4
**Suggestions:** 2
**Files Reviewed:** 15

---

## Critical Issues

### 1. [retro-writer.ts:133] Silent Swap of List Items in Parser

**Severity:** Critical
**Location:** `src/lib/flywheel/retro-writer.ts:133`

**Problem:**
In the `parseRetroMarkdown()` function, when parsing YAML frontmatter lists (like `proposed_changes`), the code uses:
```typescript
fm[currentKey] = listItems.splice(0);  // LINE 133
```

The `Array.splice(0)` call **mutates** `listItems` by removing all elements, then returns the removed elements. This causes:
1. First list assignment succeeds but empties `listItems`
2. If the same key appears again (edge case), it assigns an empty array
3. More critically, if parsing fails or the frontmatter has multiple lists, the second list flush at line 172 will assign an **empty array** instead of the accumulated items

Example buggy flow:
```
Line 131: if (currentKey && inList) fm[currentKey] = listItems.splice(0)  // listItems now []
Line 135: currentKey = kvMatch[1]  // new key
Line 172: if (currentKey && inList) fm[currentKey] = listItems  // assigns [] (already emptied)
```

**Impact:**
If a retro markdown has multiple list fields (e.g., `proposed_changes` followed by another field with a list), the second list will be lost or empty, causing validation failures or incorrect data in the frontmatter.

**Fix:**
Change line 133 to use `slice()` instead of `splice()`:
```typescript
fm[currentKey] = listItems.slice();  // Create copy without mutation
```

Or better, reset `listItems` properly:
```typescript
if (currentKey && inList) {
  fm[currentKey] = [...listItems];  // Non-mutating copy
  listItems = [];  // Clear for next list
  inList = false;
}
```

---

### 2. [retro-inputs.ts:118-139] Incomplete Error Handling in readTmuxTails()

**Severity:** Critical
**Location:** `src/lib/flywheel/retro-inputs.ts:118-139`

**Problem:**
The `readTmuxTails()` function reads tmux history files but doesn't properly handle errors inside the directory iteration loop:

```typescript
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  if (!entry.endsWith(`-${issueLower}`) && entry.name !== issueLower) continue;

  const tailFile = join(agentsDir, entry.name, 'tmux-tail.txt');
  const tail = await readTailLines(tailFile, TMUX_TAIL_LINES);  // LINE 131
  if (tail) {
    tails[entry.name] = tail;
  }
}
```

The `readTailLines()` function at line 67 returns null on error but doesn't catch unexpected errors. More critically, in `gatherRetroInputs()` at line 204, the entire Promise.all() will fail if `readTmuxTails()` throws an unexpected error:

```typescript
readTmuxTails(issueId),  // If this throws, entire gather fails
```

This happens when:
1. A tmux tail file exists but is unreadable (permission denied)
2. The directory has an unusual state (race condition with other processes)

**Impact:**
If even one agent's tmux tail is unreadable, the entire retro-agent spawn fails. The error message is vague ("Failed to spawn retro for PAN-709") rather than specific. The retro-agent never runs, leaving no record of which input caused the problem.

**Fix:**
Add explicit error handling to ensure `readTmuxTails()` never throws:
```typescript
async function readTmuxTails(issueId: string): Promise<Record<string, string>> {
  const tails: Record<string, string> = {};
  const agentsDir = join(PANOPTICON_HOME, 'agents');
  const issueLower = issueId.toLowerCase();

  try {
    const entries = await fsPromises.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      try {  // Add try-catch here
        if (!entry.isDirectory()) continue;
        if (!entry.endsWith(`-${issueLower}`) && entry.name !== issueLower) continue;

        const tailFile = join(agentsDir, entry.name, 'tmux-tail.txt');
        const tail = await readTailLines(tailFile, TMUX_TAIL_LINES);
        if (tail) {
          tails[entry.name] = tail;
        }
      } catch (err) {
        console.warn(`[retro-inputs] Failed to read tmux tail for ${entry.name}:`, err);
        // Continue to next agent
      }
    }
  } catch (err) {
    console.warn('[retro-inputs] Failed to list agents directory:', err);
  }

  return tails;  // Always return, never throw
}
```

---

## Warnings

### 1. [synthesis.ts:250-268] Duplicate Friction Score Accumulation

**Severity:** Warning
**Location:** `src/lib/flywheel/synthesis.ts:250-268`

**Problem:**
In the synthesis accumulation loop, friction scores are added for every `proposed_change`, but the deduplication check only applies to the path:
```typescript
for (const change of proposedChanges) {
  const signal = extractSignal(change);
  if (!signal) continue; // skip no_op
  
  const sig: ProposalSignature = { ... };
  const key = signatureKey(sig);
  
  if (!accumulators.has(key)) {
    accumulators.set(key, { ... });
  }
  
  const acc = accumulators.get(key)!;
  acc.frictionScores.push(frictionScore);  // ADDED FOR EVERY CHANGE
  if (!acc.seenPaths.has(path)) {
    acc.seenPaths.add(path);
    acc.retroPaths.push(path);
  }
}
```

**Issue:** A single retro file can have multiple `proposed_changes` for the same skill/audience/purpose (edge case). If it does:
- The path is added once (correct)
- But friction score is added multiple times

Example: A retro with friction=5 and 2 `add_skill` entries for skill X results in `frictionScores=[5, 5]`, inflating the median calculation.

**Impact:**
Median friction score is skewed upward when a single retro contributes multiple matching proposed changes. This affects proposal priority ranking, potentially causing misclassified friction levels.

**Fix:**
Add friction score only once per unique path per signature:
```typescript
const acc = accumulators.get(key)!;
if (!acc.seenPaths.has(path)) {
  acc.frictionScores.push(frictionScore);  // Move inside the "not seen" block
  acc.seenPaths.add(path);
  acc.retroPaths.push(path);
}
```

---

### 2. [issue-filer.ts:189] Integer Parse Without Validation

**Severity:** Warning
**Location:** `src/lib/flywheel/issue-filer.ts:189`

**Problem:**
When parsing the GitHub issue number from the URL:
```typescript
issueNumber: parseInt(issue.url.split('/').pop() ?? '', 10),
```

If the URL is malformed or doesn't end with a number, `parseInt()` returns `NaN`. The code doesn't validate. For example:
- URL: `https://api.github.com/repos/eltmon/panopticon-cli/issues/invalid`
- Result: `issueNumber: NaN`

**Impact:**
A malformed GitHub issue URL results in `NaN` stored in `FiledIssue[]`, which breaks downstream code that expects a valid number (e.g., issue linking, dashboard display, provenance tracking).

**Fix:**
Validate before assignment:
```typescript
const urlParts = issue.url.split('/');
const issueNumStr = urlParts[urlParts.length - 1] ?? '';
const issueNum = parseInt(issueNumStr, 10);

if (isNaN(issueNum) || issueNum <= 0) {
  const error = `Malformed GitHub issue URL: ${issue.url}`;
  console.warn(`[issue-filer] ${error}`);
  errors.push({ proposal, error });
  continue;
}

filed.push({
  // ...
  issueNumber: issueNum,
  // ...
});
```

---

### 3. [retro-archiver.ts:143-149] Potential Data Loss in Concurrent Wontfix Move

**Severity:** Warning
**Location:** `src/lib/flywheel/retro-archiver.ts:143-149`

**Problem:**
The wontfix archiving sequence is not atomic:
```typescript
const content = await fsPromises.readFile(fullPath, 'utf-8');
if (content.includes('wontfix: true')) continue;

const wontfixDir = join(archiveBaseDir, 'wontfix');
await fsPromises.mkdir(wontfixDir, { recursive: true });
const updatedContent = appendWontfix(content);
const destPath = join(wontfixDir, entry);
await fsPromises.writeFile(destPath, updatedContent, 'utf-8');
await fsPromises.unlink(fullPath);  // Original file deleted here
```

If synthesis and archiver run concurrently:
1. Archiver reads retro A
2. Synthesis processes retro A (same file)
3. Archiver writes wontfix and deletes original
4. Synthesis processes duplicate of the same retro

**Impact:**
In concurrent scenarios, retros could be processed twice or synthesis could fail with file-not-found errors. Low probability but high impact.

**Fix:**
Use atomic rename or add a lock:
```typescript
const markedContent = appendWontfix(content);
await fsPromises.writeFile(fullPath, markedContent, 'utf-8');
// Atomic move — no race window
await fsPromises.mkdir(wontfixDir, { recursive: true });
await fsPromises.rename(fullPath, destPath);
```

---

### 4. [synthesis-commit.ts:81] Unreliable SHA Extraction from Git Output

**Severity:** Warning
**Location:** `src/lib/flywheel/synthesis-commit.ts:81`

**Problem:**
The commit SHA is extracted using a fragile regex:
```typescript
const shaMatch = commitOut.match(/\[.*?\s+([0-9a-f]{7,40})\]/);
const commitSha = shaMatch ? shaMatch[1] : undefined;
```

Git commit output varies:
- `[main 1a2b3c4]` (matches)
- `[main commit 1a2b3c4]` (may not match depending on git version)
- Localized output (may not match)

If the regex doesn't match, `commitSha = undefined`, but the function returns `committed: true` — misleading success.

**Impact:**
Callers relying on `commitSha` for provenance tracking get `undefined`. The result appears successful but provides no usable SHA.

**Fix:**
Query the SHA directly after a successful commit:
```typescript
// After commit succeeds, get the SHA directly
const { stdout: shaOut } = await execFileAsync('git', [
  '-C', docsDir,
  'rev-parse', 'HEAD',
]);
const commitSha = shaOut.trim();
```

---

## Suggestions

### 1. [tmux.ts:12-18] Counter Overflow Risk

**Location:** `src/lib/tmux.ts:12-18`

**Suggestion:**
The `_sendKeysCallCounter` is incremented globally without bounds:
```typescript
let _sendKeysCallCounter = 0;
function uniqueCallId(): number {
  return ++_sendKeysCallCounter;
}
```

Over a long session (weeks of continuous use), this can theoretically overflow JavaScript's safe integer range, though practically unlikely. More importantly, it's not truly unique across process restarts.

**Benefit:**
More robust for long-running processes and multiple restarts.

**Suggested Fix:**
Use timestamp-based uniqueness:
```typescript
function uniqueCallId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
```

Then update `uniqueTmpFile()` to handle string IDs.

---

### 2. [retro-writer.ts:114-186] Fragile YAML Frontmatter Parser

**Location:** `src/lib/flywheel/retro-writer.ts:114-186`

**Suggestion:**
The custom YAML parser doesn't handle:
1. Values containing colons (e.g., `purpose: "fix: the issue"`)
2. Quoted strings with escaped quotes
3. Multiline values

The regex at line 129:
```typescript
const kvMatch = line.match(/^([\w_]+):\s*(.*)?$/);
```

This will incorrectly parse `purpose: "fix: the issue"` as key="purpose", value='"fix'.

**Benefit:**
Resilient to varied agent output. Currently works because retro-agent outputs simple YAML, but this is fragile.

**Suggested Fix:**
Document the limitation and add a note that proposed_changes values must not contain unquoted colons. Or consider using a proper YAML library like `js-yaml`.

---

## Summary Statistics

- **Critical:** 2 (list mutation, error propagation)
- **Warnings:** 4 (score duplication, NaN parsing, race condition, SHA extraction)
- **Suggestions:** 2 (counter overflow, YAML parsing)
- **Files reviewed:** 15
  - Flywheel modules: 7 (synthesis, retro-writer, retro-inputs, retro-archiver, issue-filer, synthesis-commit, flywheel-report)
  - Cloister/core: 4 (retro-agent, specialists, tmux, spawn-planning-session)
  - Utilities: 2 (sync, template)
  - Scripts: 2 (heartbeat-hook, others)

### Distribution by File
| File | Issues |
|------|--------|
| retro-writer.ts | 1 Critical, 1 Suggestion |
| retro-inputs.ts | 1 Critical |
| synthesis.ts | 1 Warning |
| issue-filer.ts | 1 Warning |
| retro-archiver.ts | 1 Warning |
| synthesis-commit.ts | 1 Warning |
| tmux.ts | 1 Suggestion |
| Other files | No issues |

---

## Recommendations for Fix Priority

1. **Fix Critical #1 immediately** (retro-writer list mutation) — affects all retros with multiple proposed changes
2. **Fix Critical #2 immediately** (retro-inputs error handling) — impacts retro-agent reliability and robustness
3. **Fix Warnings #1 and #2 together** (synthesis scoring and issue-filer validation) — improve accuracy and prevent downstream bugs
4. **Fix Warning #3** (archiver race condition) — low probability but add atomic move for correctness
5. **Fix Warning #4** (synthesis-commit SHA) — improve provenance tracking with direct query
6. Suggestions are lower priority but improve long-term robustness
