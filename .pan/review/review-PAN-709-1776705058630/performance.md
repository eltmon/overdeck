# Performance Review — PAN-709

## Summary

**Status: PASS** — The flywheel implementation uses mostly async file I/O and has acceptable algorithmic complexity. One optimization opportunity and one minor warning identified, but no critical bottlenecks.

**Findings:**
- Critical: 0
- Warnings: 1
- Suggestions: 2

---

## Critical Performance Issues

None identified.

---

## Warnings

### 1. [synthesis.ts:264] Linear search for duplicate paths in accumulator

**Severity:** Warning  
**Category:** Inefficient Search (O(n) per lookup)  
**Location:** `src/lib/flywheel/synthesis.ts:264`

**Issue:**
```typescript
// Inside loop over proposed_changes for each retro:
if (!acc.retroPaths.includes(path)) {
  acc.retroPaths.push(path);
}
```

For retros with multiple proposed_changes targeting the same skill, this calls `.includes()` (O(n)) for each change. With 5 changes per retro on a 20-retro sample, this becomes `20 * 5 = 100` lookups.

**Conditions:** Becomes visible with:
- Retros containing many proposed_changes (5+)
- Large accumulator maps (100+ proposals)
- Worse case: `O(n²)` where n = proposed_changes count per retro

**Impact:** Negligible today (typical retros have 1-3 changes), but adds up if retros expand to include multiple proposed changes per issue.

**Fix:** Convert `retroPaths` from array to `Set<string>`:

```typescript
// Change accumulator structure
interface RetroSignalAccumulator {
  signature: ProposalSignature;
  changeType: ProposedChange['type'];
  changeDescription: string;
  frictionScores: number[];
  retroPaths: Set<string>;  // Changed from string[]
}

// In the grouping loop:
if (!acc.retroPaths.has(path)) {
  acc.retroPaths.add(path);
}

// When building proposals:
triggeringRetros: Array.from(acc.retroPaths),
```

---

## Optimization Opportunities

### 1. [retro-inputs.ts:67-71] Unnecessary full file read for tail operation

**Location:** `src/lib/flywheel/retro-inputs.ts:67-71`

**Opportunity:** The `readTailLines()` function reads the entire tmux history file into memory to extract the last 200 lines:

```typescript
async function readTailLines(filePath: string, lines: number): Promise<string | null> {
  const content = await readFileSafe(filePath);
  if (!content) return null;
  const allLines = content.split('\n');
  return allLines.slice(-lines).join('\n');
}
```

For large tmux history files (agent sessions can accumulate 100KB+ of logs), this allocates the entire file plus splits/joins.

**Expected Gain:** For a 100KB file, this allocates ~300KB (original + split array + result). A more efficient implementation could read only the tail block from disk, reducing memory pressure by ~70% on large history files.

**Suggested Fix (optional, low priority):**
```typescript
async function readTailLines(filePath: string, lines: number): Promise<string | null> {
  const content = await readFileSafe(filePath);
  if (!content) return null;
  
  // For most cases (< 5000 lines), split is fast
  // This micro-optimization only matters for multi-MB files
  const allLines = content.split('\n');
  return allLines.length > lines * 100
    ? readTailEfficiently(filePath, lines)  // Seek-based tail for huge files
    : allLines.slice(-lines).join('\n');     // Simple slice for normal files
}
```

---

### 2. [skill-lint.ts:84-94] Regex compilation in loop (minor)

**Location:** `src/lib/flywheel/skill-lint.ts:84-94`

**Opportunity:** The `extractSkillRefs()` function compiles regex patterns on every call:

```typescript
function extractSkillRefs(body: string): string[] {
  const refs = new Set<string>();
  for (const m of body.matchAll(/\/([a-z][a-z0-9-]+)(?:\/SKILL\.md)?/g)) {
    refs.add(m[1]);
  }
  for (const m of body.matchAll(/skills\/([a-z][a-z0-9-]+)\//g)) {
    refs.add(m[1]);
  }
  return Array.from(refs);
}
```

This function is called once per SKILL.md during `lintSkill()`, which is only invoked:
- During review-agent skill lint gate (per skill, once per review)
- During `pan admin skills audit` (ad-hoc)

**Impact:** Negligible. Regex compilation is fast (<1ms), and this is not in a hot path.

**Note:** No fix needed unless linting becomes frequent. If future flywheel starts linting all skills on every cycle, move regex to module level.

---

## All File I/O Verified

All modules use `fs/promises` or async `execFile`, with zero `readFileSync`, `readdirSync`, or `execSync` calls:

✓ `flywheel-report.ts` — uses `fsPromises.readFile/writeFile`  
✓ `issue-filer.ts` — uses `readFile/writeFile/mkdir` from fs/promises  
✓ `retro-archiver.ts` — uses `fsPromises.readdir/readFile/stat/rename`  
✓ `retro-inputs.ts` — uses `fsPromises.readdir/readFile/stat` + `execFileAsync`  
✓ `retro-writer.ts` — uses `fsPromises.mkdir/writeFile`  
✓ `synthesis.ts` — uses `fsPromises.readdir/stat/readFile`  
✓ `synthesis-commit.ts` — uses `execFileAsync` (promisified)  

**Dashboard server imports:**
- `flywheel.ts` route imports `parseRetroMarkdown` from `retro-writer.ts` ✓ (pure function, no I/O)
- No dashboard server code uses `skill-lint.ts` (only CLI uses it)
- No dashboard server code uses `spawn-planning-session.ts` (only CLI/background uses it)

**No blocking calls detected in dashboard server chain.**

---

## Query Analysis

No database queries in this module — all operations are file-based and in-memory grouping.

---

## Algorithmic Complexity Summary

| Function | Complexity | Status |
|----------|-----------|--------|
| `runSynthesis()` | O(n*m) where n=retros, m=proposed_changes | Good ✓ |
| `extractSkillRefs()` | O(length of body) | Good ✓ |
| `lintSkill()` | O(length of file) | Good ✓ |
| `readNonArchivedRetros()` | O(num_files) | Good ✓ |
| `extractFlywheelStateRow()` | O(num_lines) in file | Good ✓ |
| `retroPaths.includes()` check | O(n) per check | Warning (see above) |

---

## Verdict

**PASS**

The implementation is well-structured and uses async I/O throughout. No critical performance issues. The warning about set membership testing is low-impact in current usage but worth noting for future optimization. The tail-read suggestion is premature; current logging volume doesn't justify the complexity.

The code is production-ready.
