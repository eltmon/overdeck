# Performance Review - PAN-709

## Summary
Reviewed the flywheel pipeline additions (`src/lib/flywheel/*`), hook scripts, and skill markdown edits. The PR is dominated by docs/skill content and a new synthesis/retro pipeline. No critical performance issues found. A few minor suggestions around serial I/O and repeated disk reads that are acceptable at current scale but worth noting.

## Critical Issues
None.

## Warnings

### 1. [synthesis.ts:170-191] Sequential file reads in retros directory
**Severity:** Warning (low impact at current scale)
**Location:** `src/lib/flywheel/synthesis.ts:170-191`
**Problem:** `readNonArchivedRetros` awaits `stat` + `readFile` for each entry in a serial `for` loop. For a retros directory with many files, this serializes N round-trips to the filesystem.
**Conditions:** If the retros directory grows to hundreds/thousands of entries (unbounded over project lifetime), synthesis wall-clock time grows linearly with per-file latency rather than total bytes.
**Fix:** Use `Promise.all(entries.map(...))` for the per-entry stat+read, or `fs.readdir(dir, { withFileTypes: true })` to skip a separate `stat` call entirely:
```typescript
const dirents = await fsPromises.readdir(retrosDir, { withFileTypes: true });
const mdFiles = dirents.filter(d => d.isFile() && d.name.endsWith('.md') && d.name !== 'archive');
const results = await Promise.all(mdFiles.map(async d => {
  const fullPath = join(retrosDir, d.name);
  return { path: fullPath, content: await fsPromises.readFile(fullPath, 'utf-8') };
}));
```
This removes one stat per entry and parallelizes reads.

### 2. [synthesis.ts:143] Defensive copy before sort in `median`
**Severity:** Suggestion
**Location:** `src/lib/flywheel/synthesis.ts:143`
**Problem:** `[...values].sort(...)` allocates a new array every call. `median` is called once per accumulator, so the impact is tiny, but if friction-score arrays grow large the copy is wasted when the caller never reuses `frictionScores` afterward.
**Fix:** If input mutation is acceptable (it is here — the accumulator is not reused), sort in place: `values.sort((a,b)=>a-b)`. Negligible gain, filed for completeness.

### 3. [synthesis.ts:241-269] Map.get after Map.has
**Severity:** Suggestion (micro)
**Location:** `src/lib/flywheel/synthesis.ts:252-263`
**Problem:** `accumulators.has(key)` followed by `accumulators.get(key)!` performs two hash lookups per change. Minor, but avoidable.
**Fix:**
```typescript
let acc = accumulators.get(key);
if (!acc) {
  acc = { ... };
  accumulators.set(key, acc);
}
```

## Suggestions

### 1. Hook scripts (scripts/pre-tool-hook, notification-hook, heartbeat-hook)
These run on every tool invocation. Did not spot blocking issues in the diffs viewed, but any added `curl`/`gh`/sync FS work in these scripts multiplies by tool-call frequency. Keep them short and non-blocking; prefer fire-and-forget over sync network calls.

### 2. CLAUDE.md rule on no sync FS in dashboard server code
The repo already forbids `execSync`/`readFileSync` in dashboard server paths. None of the new `src/lib/flywheel/*` modules appear to be imported from dashboard server routes (they look CLI-only). If any of them get wired into a route handler later, the current `fs/promises` usage is fine — just don't swap it for `fs` sync counterparts.

## Best Practices

### 1. Bound retros directory growth
**Benefit:** `readNonArchivedRetros` reads every non-archived `.md`. An explicit archive step after synthesis (appears to exist via `retro-archiver.ts`) is critical for keeping this pipeline O(active retros) rather than O(all retros ever). Confirm the archiver moves processed retros out of the scan path.

## Summary Statistics
- Critical: 0
- Warnings: 1 (serial I/O in retro reader)
- Suggestions: 3 (micro-optimizations)
- Files reviewed: flywheel pipeline (`synthesis.ts`, plus structure of siblings), hook scripts, skill markdown

No blockers from a performance standpoint.
