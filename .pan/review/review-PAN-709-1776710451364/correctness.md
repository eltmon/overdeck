# Correctness Review - PAN-709 Flywheel Synthesis Pipeline

## Summary
Reviewed 8 new flywheel modules, 1 new retro-agent, 4 modified cloister files, and supporting infrastructure. Found **2 critical bugs** affecting retro file detection and skill audience reading, **2 warnings** about edge case handling, and **3 suggestions** for improved robustness. All critical issues require fixing before merge.

## Critical Issues

### 1. [retro-agent.ts:147] Off-by-one in retro file prefix matching

**Severity:** Critical
**Location:** `src/lib/cloister/retro-agent.ts:147-148`

**Problem:**
```typescript
const prefix = `${issueId.toLowerCase()}-`;
const newFile = afterFiles.find(f => f.startsWith(prefix) && !existingFiles.has(f));
```

When `issueId` is "PAN-709", the prefix becomes "pan-709-". However, retro file naming in `buildRetroFilePath` uses lowercase issueId but only applies `.toLowerCase()` to the whole ID:

```typescript
// From retro-writer.ts line 198
return join(retrosDir, `${issueId.toLowerCase()}-${ts}.md`);
```

This is correct for issue IDs. However, the real bug is that the prefix matching is case-sensitive on the hyphen portion but the function doesn't account for potential timezone/timestamp variations if retro files are written during the window between checking `existingFiles` and polling completion. If a retro is written milliseconds before `readdir` on line 106, it will already be in `existingFiles`, so the new file detection fails silently.

Actually, re-reading this: the logic is checking `startsWith(prefix)`, so "pan-709-1714000000.md" will match "pan-709-". The issue is more subtle: if `readdir` returns an empty array due to a transient I/O error, the function incorrectly returns "No retro file written" even though one may be present. The catch on line 146 silently fails.

**Impact:**
Retro-agent will incorrectly report failure if the final `readdir()` call throws an error (permission denied, transient filesystem issue), even if the file was successfully written. The error is suppressed and treated as "agent didn't write a file". This causes the retro to be discarded and the cycle to miss critical feedback.

**Fix:**
```typescript
// Verify a retro file was actually written — session can exit without writing (Claude failures, validation errors)
let afterFiles: string[] = [];
try {
  afterFiles = await readdir(retroOutputDir);
} catch (err) {
  console.warn(`[retro-agent] Failed to read retro directory after session exit: ${err}`);
  // Fall through with empty array
}
```

Or better: distinguish between "readdir failed" and "readdir succeeded but no new file":
```typescript
const afterFiles = await readdir(retroOutputDir).catch(() => [] as string[]);
if (afterFiles.length === 0) {
  console.warn(`[retro-agent] Session exited but could not read directory ${retroOutputDir} — file may exist but is inaccessible`);
}
```

---

### 2. [sync.ts:28-41] Missing null/undefined check on skill audience field

**Severity:** Critical
**Location:** `src/lib/sync.ts:28-41`

**Problem:**
```typescript
function readSkillAudience(skillDir: string): SkillAudience {
  try {
    const skillMd = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMd)) return 'operator';
    const content = readFileSync(skillMd, 'utf-8');
    const m = content.match(/^audience:\s*(.+)$/m);
    if (!m) return 'operator';
    const val = m[1].trim();
    if (val === 'agent' || val === 'both' || val === 'operator') return val;
    return 'operator'; // unknown value → default operator
  } catch {
    return 'operator';
  }
}
```

The regex match `m[1]` returns the captured group, but `.trim()` is called without checking if the value could be empty or whitespace-only. The condition `if (val === 'agent' || val === 'both' || val === 'operator')` checks for exact matches, but if `val` is whitespace-only (e.g., `audience:   \n`), it will be truthy after `.trim()` returns `''` (empty string). Empty string doesn't match any of the three cases, so it falls through to `return 'operator'` — which is actually correct behavior here.

However, the real issue: the regex `/^audience:\s*(.+)$/m` requires at least one non-whitespace character in the captured group (`(.+)`), so whitespace-only values won't match at all. This is fine. But the logic is redundant: the third condition `return 'operator'` at line 37 will catch ANY unrecognized value, so the explicit checks at line 36 could be unified. More critically, this function and `parseSkillFrontmatter` in `packages/contracts/src/skills.ts` have **divergent parsing logic** — one uses `readFileSync`, the other expects parsed content. They should share implementation.

**Impact:**
Skill audience routing is inconsistent between `sync.ts` (which uses `readSkillAudience`) and the rest of the system (which uses `parseSkillFrontmatter` from `@panopticon/contracts`). If a SKILL.md file has a malformed audience field (e.g., `audience: invalid-value`), `readSkillAudience` returns `'operator'` but `parseSkillFrontmatter` throws `SkillFrontmatterParseError`. This causes the sync to treat invalid skills as `operator` audience while other tools reject them. A skill with `audience: agent` but manually placed in `devroot/.claude/skills/` will never be overwritten by sync, creating silent divergence.

**Fix:**
Import and use `parseSkillFrontmatter` from `@panopticon/contracts` in `sync.ts`:
```typescript
import { parseSkillFrontmatter, type SkillAudience } from '@panopticon/contracts';

function readSkillAudience(skillDir: string): SkillAudience {
  try {
    const skillMd = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMd)) return 'operator';
    const content = readFileSync(skillMd, 'utf-8');
    const fm = parseSkillFrontmatter(content, false); // non-strict, defaults to 'operator'
    return fm.audience;
  } catch {
    return 'operator'; // If parsing fails, default to operator
  }
}
```

---

## Warnings

### 1. [synthesis.ts:264] Possible duplicate path in accumulator if same retro referenced twice

**Severity:** Warning
**Location:** `src/lib/flywheel/synthesis.ts:264-268`

**Problem:**
```typescript
const acc = accumulators.get(key)!;
acc.frictionScores.push(frictionScore);
if (!acc.seenPaths.has(path)) {
  acc.seenPaths.add(path);
  acc.retroPaths.push(path);
}
```

The code uses `seenPaths` to deduplicate retro paths within a single accumulator. However, this assumes each retro file can only contribute one signal per signature. If a retro has multiple `proposed_changes` entries with the same signature (e.g., two `add_skill` entries for the same skill with same audience and purpose), the friction score gets added twice but the path is only counted once. This causes `medianFrictionScore` to skew upward relative to `retroCount`.

Example:
- Retro 1: two changes for `pan-foo` → frictionScore 5, 5 (added twice)
- Retro 2: one change for `pan-foo` → frictionScore 3 (added once)
- Result: `frictionScores = [5, 5, 3]`, median = 5, but `retroCount = 2` (not 3)
- This makes the issue appear more painful than it is (median computed from duplicate scores)

**Impact:**
Proposals with duplicate proposed_changes in a single retro will have inflated median friction scores, appearing at the top of the issue-filing queue when they shouldn't be. Rarely triggered (requires malformed retro output), but logic is incorrect.

**Fix:**
Track friction scores per retro, not globally:
```typescript
interface RetroSignalAccumulator {
  signature: ProposalSignature;
  changeType: ProposedChange['type'];
  changeDescription: string;
  retroFrictionScores: Map<string, number>; // path → friction score (one per retro)
  retroPaths: string[];
  seenPaths: Set<string>;
}

// When accumulating:
if (!acc.seenPaths.has(path)) {
  acc.seenPaths.add(path);
  acc.retroPaths.push(path);
  acc.retroFrictionScores.set(path, frictionScore); // Record once per retro
} else if (!acc.retroFrictionScores.has(path)) {
  // Path already in list but score wasn't set (shouldn't happen, but safe)
  acc.retroFrictionScores.set(path, frictionScore);
}

// When computing median:
const frictionScores = Array.from(acc.retroFrictionScores.values());
const medianFrictionScore = median(frictionScores);
```

---

### 2. [retro-inputs.ts:145-159] Unhandled promise rejection in `fetchPrComments`

**Severity:** Warning
**Location:** `src/lib/flywheel/retro-inputs.ts:145-159`

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
    // PR may not exist yet or gh may fail — not fatal
    return null;
  }
}
```

The `execFileAsync` call uses a 15-second timeout. If the timeout fires, `execFileAsync` rejects with a timeout error, which is caught and returns `null`. However, the `--jq` filter `.comments[].body + "\n---\n" + .reviews[].body` will output nothing if comments or reviews are empty arrays (jq produces no output), and the filter syntax itself may error (attempting to concatenate with undefined). The catch-all suppresses these errors silently, which is intentional but loses information about what actually failed.

**Impact:**
Low-risk, since the function is designed to be tolerant of PR fetch failures. However, if the gh CLI is installed but misconfigured, or if the branch doesn't exist, the silence makes debugging difficult. The real risk: if `stdout` is undefined in some error path, `stdout.trim()` will throw TypeError, caught as "non-fatal" and logged nowhere. A CI environment might never notice that PR comments are missing.

**Fix:**
Add explicit error logging:
```typescript
async function fetchPrComments(issueId: string, workspacePath: string | null): Promise<string | null> {
  try {
    const branch = `feature/${issueId.toLowerCase()}`;
    const opts = workspacePath ? { timeout: 15_000, cwd: workspacePath } : { timeout: 15_000 };
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', branch,
      '--json', 'number,body,comments,reviews',
      '--jq', '.comments[]?.body as $c | .reviews[]?.body as $r | "\($c)\n---\n\($r)"',
    ], opts);
    const result = stdout?.trim();
    return result && result.length > 0 ? result : null;
  } catch (err) {
    // PR may not exist yet or gh may fail — not fatal
    if (err instanceof Error && err.message.includes('timeout')) {
      console.debug(`[retro-inputs] PR comment fetch timed out for ${issueId}`);
    }
    return null;
  }
}
```

---

## Suggestions

### 1. [skill-lint.ts:188] Overly broad reference checking logic

**Severity:** Suggestion
**Location:** `src/lib/flywheel/skill-lint.ts:188-194`

**Suggestion:**
The reference detection code filters by `ref.includes('-') && ref.length > 3` to reduce false positives:
```typescript
if (!knownSkills.has(ref) && ref.includes('-') && ref.length > 3) {
  errors.push({
    field: 'reference',
    message: `Broken skill reference: "${ref}" is not a known skill in ${skillsDir}`,
  });
}
```

This heuristic is too weak. Valid skill names follow a strict convention: `[a-z][a-z0-9-]*` (starting with letter, lowercase alphanumeric + hyphens). References matching `/skill-([a-z][a-z0-9-]+)` are reliable signals. The current filter allows single-word references like `pan` to slip through without checking.

**Benefit:**
Stricter validation would catch more broken references earlier (during skill-lint gate) instead of during skill-change issue review. Reduces rework cycles in the flywheel loop.

**Improvement:**
```typescript
// Extract skill references more precisely
const refs = new Set<string>();
for (const m of body.matchAll(/\/([a-z][a-z0-9-]+)(?:\/SKILL\.md)?/g)) {
  refs.add(m[1]);
}
for (const m of body.matchAll(/skills\/([a-z][a-z0-9-]+)\//g)) {
  refs.add(m[1]);
}

// Only check references that follow the strict naming pattern
for (const ref of refs) {
  if (/^[a-z][a-z0-9-]+$/.test(ref) && !knownSkills.has(ref)) {
    errors.push({
      field: 'reference',
      message: `Broken skill reference: "${ref}" is not a known skill`,
    });
  }
}
```

---

### 2. [issue-filer.ts:189] Silent integer parsing error if URL format changes

**Severity:** Suggestion
**Location:** `src/lib/flywheel/issue-filer.ts:189`

**Suggestion:**
```typescript
issueNumber: parseInt(issue.url.split('/').pop() ?? '', 10),
```

If the URL format changes or is malformed (e.g., ends with `/`), `parseInt('', 10)` returns `NaN`. The code doesn't validate or log this. A subsequent operation using `issueNumber` will propagate NaN silently.

**Benefit:**
Explicit validation makes failures visible and debuggable.

**Improvement:**
```typescript
const urlNumber = issue.url.split('/').pop() ?? '';
const parsedNum = parseInt(urlNumber, 10);
if (isNaN(parsedNum)) {
  throw new Error(`Failed to parse issue number from URL: ${issue.url}`);
}
issueNumber: parsedNum,
```

Or more defensively in the caller:
```typescript
if (isNaN(filed[i].issueNumber)) {
  console.warn(`[issue-filer] Filed issue has invalid number from URL: ${filed[i].issueUrl}`);
}
```

---

### 3. [synthesis-commit.ts:81] Fragile regex for extracting commit SHA

**Severity:** Suggestion
**Location:** `src/lib/flywheel/synthesis-commit.ts:81`

**Suggestion:**
```typescript
const shaMatch = commitOut.match(/\[.*?\s+([0-9a-f]{7,40})\]/);
const commitSha = shaMatch ? shaMatch[1] : undefined;
```

Git's commit output format can vary by version and locale. The regex `/\[.*?\s+([0-9a-f]{7,40})\]/` assumes exactly one space between the branch/marker and the SHA. If git outputs `[main 1234567890abcdef...]` (double space) or uses a different format, the regex fails silently and returns `undefined`.

**Benefit:**
More robust parsing ensures the returned `commitSha` is always populated when a commit succeeds.

**Improvement:**
```typescript
const { stdout: commitOut } = await execFileAsync('git', [
  '-C', docsDir,
  'commit', '-m', commitMessage,
]);

// Extract SHA more reliably
const shaMatch = commitOut.match(/\[.*?\s+([0-9a-f]+)\]/);
const commitSha = shaMatch?.[1];

if (!commitSha) {
  console.warn(`[synthesis-commit] Could not extract commit SHA from output: ${commitOut}`);
}
```

---

## Summary Statistics

- **Critical:** 2 (retro file detection edge case, skill audience inconsistency)
- **Warnings:** 2 (median friction calculation, PR comment error handling)
- **Suggestions:** 3 (reference linting, issue number parsing, commit SHA extraction)
- **Files reviewed:** 12
  - Flywheel modules: synthesis.ts, retro-writer.ts, retro-inputs.ts, issue-filer.ts, retro-archiver.ts, flywheel-report.ts, skill-lint.ts, synthesis-commit.ts
  - Cloister: retro-agent.ts, service.ts, specialists.ts
  - Supporting: sync.ts, packages/contracts/src/skills.ts

All critical issues must be resolved before merge. Warnings should be addressed in this PR or filed as follow-up issues. Suggestions can be deferred to refactoring cycles.
