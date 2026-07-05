# PAN-2167 — Pipeline-written `.pan/records` and `.pan/test/result.json` dirty the worktree and block `pan review request`

**Issue:** [PAN-2167](https://github.com/eltmon/overdeck/issues/2167)
**Verified-Against:** main @ `6681632bfe6cd2fe4eb933e225edda8d23805edf`
**Author:** orchestrating conversation via PRD agent, 2026-07-04
**Part of:** epic [PAN-2376](https://github.com/eltmon/overdeck/issues/2376) — CI/CD reliability, Phase 1

## Glossary

- **Clean-tree gate** — the check inside `getDirtyWorkspaceErrorForReviewRequest()` (review-pipeline.ts:56) that runs `git status --porcelain -uno` in the workspace and returns an error string if any tracked files are modified or staged. Returning non-null from this function causes the `POST /api/review/:issueId/trigger` route (review-pipeline.ts:82) to abort with "Workspace has uncommitted changes."
- **`git status --porcelain -uno`** — lists only tracked files with modifications (staged or unstaged); `-uno` suppresses untracked files. Gitignored files are NEVER listed regardless.
- **Pipeline-owned paths** — files written by Overdeck's own pipeline machinery that an agent should never commit: the per-issue record `<workspace>/.pan/records/<issueId-lower>.json` (written by `updateIssueRecordForReviewStatusSync` in review-status.ts:408) and the test verdict artifact `<workspace>/.pan/test/result.json` (written by the test agent per test-agent-queue.ts:44).
- **`.pan/test/` gitignore** — `ensurePanGitignoreSync()` in `src/lib/workspace-manager/migration.ts:206` adds `.pan/test/` to the workspace's `.gitignore`. However, if `.pan/test/result.json` was committed BEFORE the gitignore entry was added (or was staged and committed by an agent), `git status --porcelain -uno` still shows it as tracked-and-modified even though the gitignore entry exists, because git tracks committed files regardless of `.gitignore`.
- **`getDirtyWorkspaceErrorForReviewRequest()`** — `src/dashboard/server/routes/workspaces/review-pipeline.ts:56`; returns `null` (clean) or an error string (dirty). Called from the `POST /api/review/:issueId/trigger` route handler.
- **Review request trigger** — `POST /api/review/:issueId/trigger` (review-pipeline.ts:82); the dashboard endpoint that `pan done` POSTs to (done.ts:937) and that the deacon patrol fires to dispatch review.

## Problem (verified 2026-07-04)

### RUN-37 incident (PAN-1982)

`pan review request PAN-1982` aborted with "Workspace has uncommitted changes". `git status --short` showed:
```
MM .pan/records/pan-1982.json
MM .pan/test/result.json
```

Both files are written by the Overdeck pipeline, not by the work agent. The workspace was otherwise clean — no agent code was uncommitted. The recent commit log showed a loop of `chore: checkpoint pan-1982 conflict state` and `chore: record pan-1982 merge blocker state`, confirming the pipeline was repeatedly re-dirtying these paths.

### Root cause: no exemption for pipeline-owned paths

The clean-tree gate at review-pipeline.ts:65 runs:
```ts
const statusCmd = 'git status --porcelain -uno';
```
and at review-pipeline.ts:77 returns an error if ANY tracked file is modified:
```ts
return `Workspace has uncommitted changes. Commit the changes, explicitly discard them, or surface them to the operator before requesting review:\ncd ${workspacePath}\ngit status`;
```

There is no allowlist or exemption. Pipeline-owned files that are tracked (because they were committed in an earlier run before the gitignore was in place, or because they were staged by the work agent) are treated identically to agent-written files. The error is indistinguishable to the operator, and the recovery ("commit or discard") is wrong — neither is appropriate for pipeline-managed files.

**Why `.pan/test/` being gitignored does not solve the problem:**

`ensurePanGitignoreSync()` (migration.ts:206) adds `.pan/test/` to `.gitignore`. But if `.pan/test/result.json` was once committed (tracked), the `.gitignore` entry only prevents FUTURE additions — it does not remove the file from the index. `git status --porcelain -uno` still shows it as `MM` when the pipeline re-writes it. A full workspace rebuild would fix it, but that's destructive. The code fix must handle the already-tracked case.

**Why auto-commit is the wrong fix:**

`pan done` already auto-commits `.pan/` artifacts before calling `runPreflightChecks` (done.ts:583-593, grep anchor: `const { stdout: preDirty } = await execAsync('git status --porcelain .pan/'`). But the review request trigger (`POST /api/review/:issueId/trigger`) runs server-side and has no equivalent auto-commit. Auto-committing pipeline files from a server route is inadvisable:
- It creates a spurious commit from the dashboard process (not an agent identity).
- It interferes with the clean commit history the merge agent expects.
- The pipeline keeps re-writing these files (the "loop of checkpoint commits" in the incident proves this); auto-committing would just create an infinite commit chain.

**Decision:** Exempt `.pan/records/` and `.pan/test/` from the dirty check. These files remain dirty in the workspace; the gate simply does not count them as blocking. This is less invasive than auto-committing and correctly reflects that these paths are pipeline bookkeeping, not agent work product.

## Requirements

- **FR-1** — `getDirtyWorkspaceErrorForReviewRequest()` MUST return `null` (clean) when the ONLY dirty tracked files match pipeline-owned path prefixes: `.pan/records/` and `.pan/test/`.
- **FR-2** — The exemption MUST be applied by filtering the raw `git status --porcelain -uno` output, not by modifying git's tracking state (no `git rm --cached`, no `.gitignore` manipulation, no `git add`). The files remain dirty in the workspace; the gate ignores them.
- **FR-3** — If ANY file outside `.pan/records/` and `.pan/test/` is dirty (staged or unstaged), the gate MUST still return an error. The exemption is narrow: only these two directories.
- **FR-4** — The same exemption MUST be applied to the remote-workspace variant of the check (the `flyExecCmd` path, review-pipeline.ts:66–70) so that remote workspaces are treated identically.
- **FR-5** — Regression test: a workspace with ONLY `.pan/records/pan-1982.json` and `.pan/test/result.json` modified → gate returns null. A workspace with `.pan/records/pan-1982.json` AND `src/foo.ts` modified → gate returns the error string. An empty status → gate returns null.
- **NFR-1** — No new explicit `any`; async only (no `execSync`); no new files ≥1,000 lines.
- **NFR-2** — The filter logic MUST be expressed as a pure helper with a name that signals intent (`isPipelineOwnedPath`), lockable by a unit test independent of the route.

## Work items

### W1 — `isPipelineOwnedPath`: pure predicate for exempted paths (FR-2, NFR-2)

**File:** `src/dashboard/server/routes/workspaces/review-pipeline.ts`

Add a named pure helper near the top of the file (above `shouldTreatAsRerun`, which is at review-pipeline.ts:49):

```ts
// Pipeline-owned paths that the clean-tree gate exempts from the "uncommitted changes"
// check (PAN-2167). These files are written by the Overdeck pipeline machinery
// (per-issue record writer + test-verdict writer) and must not block review requests
// regardless of whether they are tracked by git.
const PIPELINE_OWNED_PREFIXES = ['.pan/records/', '.pan/test/'] as const;

/**
 * Returns true when a `git status --porcelain` path is pipeline-owned and should
 * be invisible to the clean-tree gate. `gitStatusPath` is the raw path field from
 * a porcelain line (e.g. `.pan/records/pan-1982.json` or `.pan/test/result.json`).
 */
export function isPipelineOwnedPath(gitStatusPath: string): boolean {
  return PIPELINE_OWNED_PREFIXES.some(prefix => gitStatusPath.startsWith(prefix));
}
```

Export `isPipelineOwnedPath` so it can be unit-tested independently of the route.

### W2 — `getDirtyWorkspaceErrorForReviewRequest`: filter pipeline paths (FR-1, FR-3, FR-4)

**File:** `src/dashboard/server/routes/workspaces/review-pipeline.ts`

**Location:** `getDirtyWorkspaceErrorForReviewRequest()` at review-pipeline.ts:56. The full current implementation (lines 56–81):

```ts
async function getDirtyWorkspaceErrorForReviewRequest(
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
): Promise<string | null> {
  try {
    if (!workspaceInfo.isRemote) {
      await Effect.runPromise(restoreTrackedBeadsExport(workspacePath));
    }

    const statusCmd = 'git status --porcelain -uno';
    const status = workspaceInfo.isRemote && workspaceInfo.vmName
      ? (await execAsync(
          flyExecCmd(workspaceInfo.vmName, `cd ${workspacePath} && ${statusCmd}`),
          { encoding: 'utf-8', timeout: 30000 },
        )).stdout
      : (await execAsync(statusCmd, { cwd: workspacePath, encoding: 'utf-8' })).stdout;

    if (!status.trim()) {
      return null;
    }

    return `Workspace has uncommitted changes. Commit the changes, explicitly discard them, or surface them to the operator before requesting review:\ncd ${workspacePath}\ngit status`;
  } catch {
    return null;
  }
}
```

**Change:** replace the `if (!status.trim()) { return null; }` block with a filter that strips pipeline-owned lines before deciding:

```ts
async function getDirtyWorkspaceErrorForReviewRequest(
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
): Promise<string | null> {
  try {
    if (!workspaceInfo.isRemote) {
      await Effect.runPromise(restoreTrackedBeadsExport(workspacePath));
    }

    const statusCmd = 'git status --porcelain -uno';
    const status = workspaceInfo.isRemote && workspaceInfo.vmName
      ? (await execAsync(
          flyExecCmd(workspaceInfo.vmName, `cd ${workspacePath} && ${statusCmd}`),
          { encoding: 'utf-8', timeout: 30000 },
        )).stdout
      : (await execAsync(statusCmd, { cwd: workspacePath, encoding: 'utf-8' })).stdout;

    // PAN-2167: filter pipeline-owned paths before deciding dirty/clean.
    // git status --porcelain -uno format: "XY <path>" where XY is a 2-char status.
    const nonPipelineLines = (status ?? '').split('\n').filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // Extract the path: columns 0–1 are status chars, column 2 is space, then path.
      const path = trimmed.length > 3 ? trimmed.slice(3) : '';
      return !isPipelineOwnedPath(path);
    });

    if (nonPipelineLines.length === 0) {
      return null;
    }

    return `Workspace has uncommitted changes. Commit the changes, explicitly discard them, or surface them to the operator before requesting review:\ncd ${workspacePath}\ngit status`;
  } catch {
    return null;
  }
}
```

The `flyExecCmd` path (remote workspace) uses the identical `statusCmd` and produces the same porcelain output format, so the filter applies equally to both local and remote variants (FR-4).

**Porcelain format note (for the executor):** `git status --porcelain` produces lines like:
```
MM .pan/records/pan-1982.json
 M src/lib/foo.ts
A  src/new-file.ts
```
The first two columns (`XY`) are status codes; column 3 is always a space; the remainder is the path. For renamed files the format is `XY old -> new` — but renamed pipeline files are not a concern here. The slice `trimmed.slice(3)` correctly extracts the path for all cases used in practice.

### W3 — Unit tests (FR-5, NFR-2)

**File:** `tests/unit/dashboard/server/routes/workspaces/review-pipeline-dirty.test.ts` (new file)

Tests for `isPipelineOwnedPath` (pure, no mocking needed) and for `getDirtyWorkspaceErrorForReviewRequest` (mock `execAsync`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isPipelineOwnedPath } from '../../../../../src/dashboard/server/routes/workspaces/review-pipeline.js';

describe('isPipelineOwnedPath', () => {
  it('exempts .pan/records/ paths', () => {
    expect(isPipelineOwnedPath('.pan/records/pan-1982.json')).toBe(true);
    expect(isPipelineOwnedPath('.pan/records/min-123.json')).toBe(true);
  });
  it('exempts .pan/test/ paths', () => {
    expect(isPipelineOwnedPath('.pan/test/result.json')).toBe(true);
    expect(isPipelineOwnedPath('.pan/test/subdir/file.json')).toBe(true);
  });
  it('does NOT exempt other .pan/ paths', () => {
    expect(isPipelineOwnedPath('.pan/specs/2026-07-01-PAN-100.vbrief.json')).toBe(false);
    expect(isPipelineOwnedPath('.pan/continue.json')).toBe(false);
  });
  it('does NOT exempt source files', () => {
    expect(isPipelineOwnedPath('src/lib/foo.ts')).toBe(false);
    expect(isPipelineOwnedPath('package.json')).toBe(false);
  });
});

describe('getDirtyWorkspaceErrorForReviewRequest (clean-tree gate)', () => {
  // Integration-style tests that mock execAsync — no fake timers needed (no delays).
  it('returns null when only pipeline-owned files are dirty', async () => {
    // Mock git status output: only .pan/records and .pan/test dirty
    // ... (mock execAsync to return the porcelain lines, mock restoreTrackedBeadsExport)
    // Assert: getDirtyWorkspaceErrorForReviewRequest returns null
  });
  it('returns error when agent-written files are also dirty', async () => {
    // Mock: .pan/records/pan-1982.json + src/lib/foo.ts dirty
    // Assert: returns the error string
  });
  it('returns null when git status is empty', async () => {
    // Mock: empty stdout
    // Assert: returns null
  });
  it('applies the same filter for remote workspaces (flyExecCmd path)', async () => {
    // Mock: workspaceInfo.isRemote=true, vmName set; only .pan/test/ dirty
    // Assert: returns null
  });
});
```

Note: `getDirtyWorkspaceErrorForReviewRequest` is not currently exported. Add `export` to it for testability. This is a minimal, non-breaking change — the function is `async` and not used outside this module.

## Explicitly out of scope

- Removing already-tracked `.pan/test/result.json` and `.pan/records/*.json` from git history in existing workspaces (the filter fix makes this irrelevant for correctness; cleanup is a separate workspace-hygiene concern).
- Adding `.pan/records/` to the workspace gitignore (via `ensurePanGitignoreSync`) — this PRD deliberately avoids gitignore changes because they don't help already-tracked files and could suppress legitimate pipeline-record commits on projects where records ARE tracked by design.
- Applying the exemption to `runPreflightChecks` in `src/lib/work/done-preflight.ts` — `pan done` already auto-commits `.pan/` artifacts at done.ts:583-593 before pre-flight, so this path is not broken by pipeline-dirty files.
- Applying the exemption to the spawn-gate dirty check in `src/dashboard/server/routes/agents/spawn.ts:611` — that check correctly rejects dirty workspaces before agent spawn.
- [PAN-806](https://github.com/eltmon/overdeck/issues/806) git-primitives epic — the broader fix to make pipeline writes atomic commits belongs there.

## Intersecting repo rules (restated for the executor)

- Async only; never `execSync` in server-reachable code. `getDirtyWorkspaceErrorForReviewRequest` already uses `execAsync = promisify(exec)` (imported at review-pipeline.ts:1–3 from `node:child_process` + `node:util`).
- No new explicit `any`.
- Full gates before `pan done`: `npm run typecheck`, `npm run lint`, `npm test` (0 failed).
- Keep `tests/unit/lib/cloister/in-flight-guard.test.ts` green (this PRD does not touch the merge path).
- Single-source-of-truth: `getDirtyWorkspaceErrorForReviewRequest` reads git state directly (correct — git IS the source of truth for workspace cleanness); the filter does not write any state.
- No `vi.useFakeTimers()` needed for these tests: no delays, retries, or backoff involved.
- Work happens in the issue's feature workspace; never `git checkout` another branch inside the worktree.

## Acceptance criteria (map 1:1 to work items)

- **AC-1 (W1):** `isPipelineOwnedPath('.pan/records/pan-1982.json')` → `true`; `isPipelineOwnedPath('.pan/test/result.json')` → `true`; `isPipelineOwnedPath('src/lib/foo.ts')` → `false`; tests pass. (FR-2, NFR-2)
- **AC-2 (W2):** With mocked git status returning only `.pan/records/pan-1982.json` and `.pan/test/result.json`: `getDirtyWorkspaceErrorForReviewRequest` returns `null`. With mocked status returning those files PLUS `src/lib/foo.ts`: returns the error string. Both local and remote paths tested. (FR-1, FR-3, FR-4)
- **AC-3 (W3):** All four test scenarios in W3 pass; `isDirtyWorkspaceError` exported for testability. (FR-5)
- **AC-4:** typecheck + lint + full suite green; no new `any`; no `execSync`.
