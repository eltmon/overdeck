# PAN-2372 — Slot `pan done` writes statusOverrides atomically + verified; deacon needs-attention fallback

**Issue:** [PAN-2372](https://github.com/eltmon/overdeck/issues/2372)
**Verified-Against:** main @ `6681632bfe6cd2fe4eb933e225edda8d23805edf`
**Author:** orchestrating conversation via PRD agent
**Part of:** [PAN-2376](https://github.com/eltmon/overdeck/issues/2376) epic, Phase 2 — strike + swarm merge-path hardening

---

## Glossary

- **Slot agent** — a work agent in `workspaces/feature-<id>-slot-N` on branch `feature/<id>-slot-N`; identified by `agent-<id>-slot-N`. Its assigned item is `agentState.slotItemId`.
- **Feature workspace** — `workspaces/feature-<id>` (no slot suffix); the directory `coordinateSwarmSlots` operates on. NOT the same directory as the slot workspace.
- **Feature workspace record** — `workspaces/feature-<id>/.pan/records/<issueId-lowercase>.json`; the file `readIssueRecordForWorkspaceSync(featureWorkspacePath, issueId)` reads from. Contains `statusOverrides`.
- **statusOverrides** — the `{ [itemId]: 'completed' }` map in the feature workspace record. The authoritative signal for `coordinateSwarmSlots` that a slot's item is done: `defaultReadStatusOverrides(workspacePath, issueId)` returns `readIssueRecordForWorkspaceSync(workspacePath, issueId)?.statusOverrides` (deacon-swarm.ts:210).
- **`completeSlotWork`** — the function in `src/cli/commands/done.ts:434` called when a slot agent runs `pan done`. Currently it stops the agent and emits an activity entry but does NOT write `statusOverrides`. Writing happens later, in `mergeReadySlots` (via `applyTaskOperationToPlanFile`), only after a successful merge.
- **Turn-completed marker** — the `idle/completed` resolution written to `~/.overdeck/agents/<agentId>/runtime.json` by `saveAgentRuntimeState` when `pan done` is called. If this exists but statusOverrides are absent, the slot "completed" its `pan done` path but the swarm coordinator cannot see the work.
- **`writeIssueRecordSync`** — `src/lib/pan-dir/record.ts:196`; calls `writeFileSync` (not atomic — a crash mid-write produces a corrupt zero-byte or partial file). Every `writeStatusOverrideSync` call chains through this.
- **Atomic write** — write to a sibling temp file (e.g., `<path>.tmp.<pid>`) then `fs.renameSync(tmp, path)`. `rename` is atomic on POSIX; the file is never in a half-written state.

---

## Problem (verified 2026-07-04 against main @ `6681632b`)

`completeSlotWork` in `src/cli/commands/done.ts:434`:

```ts
async function completeSlotWork(issueId: string, slot: SlotCompletionContext, comment?: string): Promise<void> {
  const now = new Date().toISOString();
  const { saveAgentStateSync } = await import('../../lib/agents.js');

  if (slot.agentState) {
    slot.agentState.status = 'stopped';
    slot.agentState.stoppedByUser = true;
    slot.agentState.lastActivity = now;
    saveAgentStateSync(slot.agentState);
  }

  saveAgentRuntimeState(slot.agentId, {
    state: 'idle',
    resolution: 'completed',
    ...
  });

  emitActivityEntrySync({ ... });
  console.log(chalk.green(`✓ Slot ${slot.slotIndex} work complete for ${issueId}`));
```

It does NOT write `statusOverrides`. The swarm coordinator will call `mergeReadySlots` → `applyTaskOperationToPlanFile` which writes statusOverrides AFTER the slot branch merges. But:

1. The merge happens on a later deacon patrol, not at `pan done` time. Between `pan done` and the next patrol, the feature workspace record shows 0 completed items.
2. `writeIssueRecordSync` uses `writeFileSync` (non-atomic). A crash or OOM between open and close leaves a zero-byte or partial JSON file.
3. The PAN-2253 incident: slot-1's feature workspace record's `statusOverrides` were never written (9 commits + turn-completed marker present). The deacon reported `0/8 items complete` on every patrol and never finalized. The swarm stranded with no PR.

The `writeIssueRecordSync` function (record.ts:196) is the non-atomic writer used by all `writeStatusOverrides*` call sites.

---

## Requirements

- **FR-1** — `completeSlotWork` MUST write `{ [slot.slotItemId]: 'completed' }` into `statusOverrides` in the feature workspace record as part of the `pan done` call, before returning successfully. This is an early durable signal that does not replace the post-merge write; it adds a pre-merge checkpoint.
- **FR-2** — The write MUST be atomic: write to a temp file, then `renameSync` to the target. The feature workspace record is never in a half-written state.
- **FR-3** — After the write, `completeSlotWork` MUST read the record back and verify `statusOverrides[slot.slotItemId] === 'completed'`. If verification fails, `pan done` MUST exit with a non-zero code and a clear error message (not silently succeed with a corrupt/missing write).
- **FR-4** — If `slot.slotItemId` is undefined (edge case: slot agent state has no assigned item), `completeSlotWork` MUST warn loudly (stderr + activity log) but not fail — the agent state stop path must still complete.
- **FR-5** — The deacon's swarm coordination MUST detect the case: a slot with `in_flight` reconciled state + agent runtime `idle/completed` + ≥1 commit on the slot branch + no `statusOverrides` entry for the slot's item → flag the issue as `needs-attention` and emit a deacon log line, instead of silently re-classifying as `in_flight` on every patrol.
- **NFR-1** — No new explicit `any`; async only; no `execSync`; no new files ≥ 1,000 lines.
- **NFR-2** — Fake timers (`vi.useFakeTimers()`) for any test that uses simulated delays; none expected here.

---

## Work items

### W1 — Add `writeIssueRecordSyncAtomic` utility (FR-2)

**File:** `src/lib/pan-dir/record.ts`

Add a sibling to `writeIssueRecordSync` that uses a temp+rename pattern:

Grep anchor for insertion point: `export function writeIssueRecordSync(` (line 196).

```ts
/**
 * Atomic variant of writeIssueRecordSync: writes to a temp file then renames.
 * POSIX rename is atomic — the file is never seen half-written.
 * Use this for any write that must not corrupt on crash (e.g. statusOverrides
 * at slot pan-done time — PAN-2372).
 */
export function writeIssueRecordSyncAtomic(
  project: ProjectConfig,
  issueId: string,
  record: PanIssueRecord,
): string {
  const path = getIssueRecordPath(project, issueId);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const now = new Date().toISOString();
  const next: PanIssueRecord = {
    ...record,
    issueId: issueId.toUpperCase(),
    schemaVersion: RECORD_SCHEMA_VERSION,
    created: record.created || now,
    updated: now,
  };
  const tmpPath = `${path}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
  renameSync(tmpPath, path);
  return path;
}
```

Add `renameSync` to the existing `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'` import line in `record.ts` (search for this exact import string).

Export `writeIssueRecordSyncAtomic` alongside `writeIssueRecordSync` — no changes to existing callers.

---

### W2 — Add `writeStatusOverridesSyncAtomic` in `record.ts` (FR-2)

**File:** `src/lib/pan-dir/record.ts`

Add after `writeStatusOverridesSync` (grep anchor: `export function writeStatusOverridesSync(`):

```ts
/**
 * Atomic variant of writeStatusOverridesSync.
 * Use for writes that must not corrupt on crash (PAN-2372: slot pan-done).
 */
export function writeStatusOverridesSyncAtomic(
  project: ProjectConfig,
  issueId: string,
  overrides: Record<string, string>,
): string {
  const existing = readIssueRecordSync(project, issueId);
  const next: PanIssueRecord = {
    ...(existing ?? createMinimalIssueRecord(issueId)),
    statusOverrides: { ...(existing?.statusOverrides ?? {}), ...overrides },
  };
  return writeIssueRecordSyncAtomic(project, issueId, next);
}
```

`createMinimalIssueRecord` is already imported in `record.ts` callers; verify it exists in the file or import from `./deacon-swarm-record.js` if needed. If not available in `record.ts`, inline a minimal fallback: `{ issueId: issueId.toUpperCase(), schemaVersion: RECORD_SCHEMA_VERSION, created: now, updated: now, ... }` using the existing `RECORD_SCHEMA_VERSION` constant in `record.ts`.

---

### W3 — Write + verify statusOverrides in `completeSlotWork` (FR-1, FR-3, FR-4)

**File:** `src/cli/commands/done.ts`

Add imports near the top of `done.ts` (grep anchor for existing imports: `import { resolveProjectFromIssueSync } from '../../lib/projects.js';`):

```ts
import { resolveProjectForWorkspace } from '../../lib/vbrief/io.js';
import { readIssueRecordForWorkspaceSync, writeStatusOverridesSyncAtomic } from '../../lib/pan-dir/record.js';
```

`resolveProjectForWorkspace` is already in `io.ts` (grep anchor: `export function resolveProjectForWorkspace`). If it is not exported, add `export` to its declaration.

**Modify `completeSlotWork` in `done.ts:434`** (add the block after `saveAgentRuntimeState` and before `emitActivityEntrySync`):

```ts
  // PAN-2372: Write statusOverrides immediately at pan-done time so the
  // swarm coordinator sees completion even if the post-merge applyTaskOperation
  // write is delayed or fails. This is a pre-merge checkpoint; the coordinator
  // will also write overrides after a successful merge (durable double-write).
  if (slot.slotItemId) {
    const featureWorkspacePath = deriveFeatureWorkspacePath(slot.workspacePath ?? process.cwd(), issueId);
    const project = featureWorkspacePath ? resolveProjectForWorkspace(featureWorkspacePath) : null;
    if (featureWorkspacePath && project) {
      writeStatusOverridesSyncAtomic(project, issueId, { [slot.slotItemId]: 'completed' });

      // FR-3: verify the write landed — a corrupt file or permission error should block pan done.
      const verified = readIssueRecordForWorkspaceSync(featureWorkspacePath, issueId);
      if (verified?.statusOverrides?.[slot.slotItemId] !== 'completed') {
        console.error(chalk.red(
          `[pan done] FATAL: statusOverrides write failed for slot ${slot.slotIndex} (item ${slot.slotItemId}).` +
          ` Check disk space and permissions at ${featureWorkspacePath}/.pan/records/.`
        ));
        emitActivityEntrySync({
          source: 'work-agent',
          level: 'error',
          issueId,
          message: `Slot ${slot.slotIndex} pan-done statusOverrides verification failed — item ${slot.slotItemId} not found after write`,
        });
        process.exit(1);
      }
    } else {
      // FR-4: warn but do not fail — still stop the agent.
      console.warn(chalk.yellow(
        `[pan done] Warning: could not resolve feature workspace for slot ${slot.slotIndex}; ` +
        `statusOverrides not written. Swarm coordinator will write them after branch merge.`
      ));
      emitActivityEntrySync({
        source: 'work-agent',
        level: 'warn',
        issueId,
        message: `Slot ${slot.slotIndex} pan-done: could not write statusOverrides — slotItemId=${slot.slotItemId ?? 'undefined'}`,
      });
    }
  } else {
    // FR-4: undefined slotItemId is unexpected but must not hard-fail.
    console.warn(chalk.yellow(`[pan done] Warning: slot ${slot.slotIndex} has no assigned slotItemId — statusOverrides skipped.`));
  }
```

**Add `deriveFeatureWorkspacePath` helper** (private to `done.ts`):

```ts
/** Derive the feature workspace path from a slot workspace path by stripping the `-slot-N` suffix. */
function deriveFeatureWorkspacePath(slotWorkspacePath: string, issueId: string): string | null {
  const normalized = slotWorkspacePath.replace(/[\\/]+$/, ''); // trim trailing slash
  const suffix = `-slot-${parseSlotWorkspacePath(issueId, normalized)?.slotIndex ?? -1}`;
  if (!normalized.endsWith(suffix)) return null;
  return normalized.slice(0, -suffix.length);
}
```

`parseSlotWorkspacePath` is already defined earlier in `done.ts` (grep anchor: `function parseSlotWorkspacePath(`). This reuses it without duplication.

---

### W4 — Deacon needs-attention fallback for completed-but-no-override slots (FR-5)

**File:** `src/lib/cloister/deacon-swarm.ts`

The `classifyInFlightSlots` function at line 341 classifies `reconciled.inFlight` slots. Add a pass BEFORE the existing classification logic: detect slots where the agent's runtime state shows `completed` but no `statusOverrides` entry exists.

Grep anchor for the function: `export async function classifyInFlightSlots(` (search this string in the file).

Within `classifyInFlightSlots`, after `const sessionNames = new Set(await deps.listSessionNames());`, add:

```ts
// PAN-2372: Detect slots that completed pan-done but statusOverrides were never
// written. This is the "completed-but-no-override" stall class.
for (const slot of slots) {
  if (!slot.agentId) continue;
  // Agent is idle/completed (pan done ran) but no statusOverrides confirm the item.
  const runtimeResolution = await deps.getAgentRuntimeResolution?.(slot.agentId);
  if (runtimeResolution !== 'completed') continue;
  if (statusOverrides?.[slot.itemId] === 'completed') continue; // already covered
  // Also require ≥1 commit on the slot branch (rules out agents that stopped before committing).
  const commitCount = await deps.getSlotBranchCommitCount?.(slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`, workspacePath);
  if (!commitCount || commitCount === 0) continue;

  actions.push(`[swarm] needs-attention ${issueId} slot ${slot.slotIndex} (item ${slot.itemId}): agent completed but statusOverrides absent — run 'pan swarm recover ${issueId} ${slot.slotIndex} --action retry'`);
  // Do not auto-recover; surface to the operator.
}
```

Add to `CoordinateSwarmSlotsDeps` (grep anchor: `export interface CoordinateSwarmSlotsDeps {`):

```ts
/** Optional: returns the runtime resolution for a slot agent ('completed' | 'failed' | ...). */
getAgentRuntimeResolution?: (agentId: string) => Promise<string | null>;
/** Optional: returns the number of commits on a slot branch relative to the feature branch tip. */
getSlotBranchCommitCount?: (branch: string, workspacePath: string) => Promise<number>;
```

Wire defaults in `defaultDeps`:

```ts
getAgentRuntimeResolution: async (agentId) => {
  const { getAgentRuntimeState } = await import('../agents/queries.js');
  return getAgentRuntimeState(agentId)?.resolution ?? null;
},
getSlotBranchCommitCount: async (branch, workspacePath) => {
  try {
    const { stdout } = await execAsync(
      `git rev-list --count HEAD..${branch}`,
      { cwd: workspacePath, encoding: 'utf-8' },
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
},
```

`classifyInFlightSlots` must also receive `statusOverrides` and `workspacePath` as new context parameters. Grep for the existing call site in `coordinateSwarmSlots` (line ~314: `const classified = await classifyInFlightSlots(reconciled.inFlight, deps, {`) and thread them through. The existing `options.workspacePath` and `options.issueId` are already passed; add `statusOverrides: overrides` to the options object.

---

### W5 — Regression tests (FR-1, FR-3, FR-5)

**File:** `tests/unit/cli/commands/done-slot.test.ts` (create; closest existing test to model after: search for `completeSlotWork\|slot.*done\|done.*slot` in `src/cli/commands/__tests__/`):

- `completeSlotWork writes statusOverrides atomically`: mock `writeStatusOverridesSyncAtomic` and `readIssueRecordForWorkspaceSync`; invoke `completeSlotWork` with a slot that has `slotItemId` set; assert `writeStatusOverridesSyncAtomic` was called with `{ [slotItemId]: 'completed' }` and that the verification read was called.
- `completeSlotWork exits non-zero when verification fails`: mock `readIssueRecordForWorkspaceSync` to return a record WITHOUT the itemId in statusOverrides (simulating a failed write); assert `process.exit(1)` is called.
- `completeSlotWork warns without failing when slotItemId is undefined`: slot has `slotItemId: undefined`; assert no `process.exit` and that a warning is emitted to stderr.

**File:** `tests/unit/lib/pan-dir/record-atomic.test.ts` (create):

- `writeIssueRecordSyncAtomic writes and the result is parseable`: write a record; read back; assert `JSON.parse` succeeds and the overrides field matches.
- `writeStatusOverridesSyncAtomic merges without losing existing overrides`: existing record has `{ a: 'completed' }`; write `{ b: 'completed' }`; assert result has both.

---

## Explicitly out of scope

- Making ALL `writeIssueRecordSync` callers atomic (the non-atomic writer is legacy; W1 adds the atomic variant without changing existing callers).
- Fixing the parallel race between two callers writing to the same record file simultaneously — that's the `withIssueRecordLock` concern (existing machinery).
- Fixing the slot GC fresh-branch class (PAN-2363).
- Auto-recovery for the needs-attention stall (W4 surfaces it; operator runs `pan swarm recover` to resolve).

---

## Intersecting repo rules (restated for the executor)

- Async only; never `execSync` in server-reachable code. The new `getSlotBranchCommitCount` dep uses `execAsync`.
- No new explicit `any`.
- Full gates before `pan done`: `npm run typecheck`, `npm run lint`, `npm test` (0 failed).
- Keep `tests/unit/lib/cloister/in-flight-guard.test.ts` green.
- Two-door state rule: `writeStatusOverridesSyncAtomic` writes through `writeIssueRecordSyncAtomic` → the record writer — no direct DB or state.json access.
- Fake timers: none needed here (no delays); if any future callsite introduces a retry delay, use `vi.useFakeTimers()`.
- Work in the feature workspace; never checkout another branch inside the worktree.

---

## Acceptance criteria (map 1:1 to work items)

- **AC-1 (W1, W2):** `writeStatusOverridesSyncAtomic` produces a valid JSON record readable back; writes to a temp file first then renames. Unit test passes. (FR-2)
- **AC-2 (W3):** `completeSlotWork` calls `writeStatusOverridesSyncAtomic` with `{ [slotItemId]: 'completed' }` and reads back to verify. Test proves it exits non-zero when verification fails. (FR-1, FR-3)
- **AC-3 (W3):** When `slotItemId` is undefined, `completeSlotWork` warns to stderr and still stops the agent. No `process.exit`. (FR-4)
- **AC-4 (W4):** `classifyInFlightSlots` emits `needs-attention` for a slot whose agent runtime shows `completed` but whose `statusOverrides` entry is missing and whose branch has ≥1 commit. (FR-5)
- **AC-5:** `npm run typecheck && npm run lint && npm test` all pass; no new `any`; no `execSync`.
