---
specialist: review-agent
issueId: PAN-850
outcome: changes-requested
timestamp: 2026-04-27T04:15:00Z
---

# Verdict: CHANGES_REQUESTED

## Summary
The PR implements three correct fixes (no-op rebase pre-check, 15-min timeout, `readyForMerge` preservation on transient failure) and all 6 requirements are verified implemented. However, a critical command-injection vulnerability was introduced in the new `isBranchAlreadyRebased()` helper — `issueId` flows from the HTTP route directly into shell command strings via `execAsync` string interpolation. This is a MUST-fix blocker that cannot be approved regardless of the correctness of the surrounding logic. One additional high-priority finding (fragile non-null assertion) must also be addressed before merge.

## Blockers (MUST fix before merge)

### 1. Command injection in `isBranchAlreadyRebased` — `src/dashboard/server/routes/workspaces.ts:159-174` — `!`
**Raised by**: security
**Why it blocks**: `issueId` from the HTTP route parameter is interpolated into shell command strings without sanitization, allowing an attacker who can reach `POST /api/issues/:issueId/merge` to execute arbitrary commands on the server.

<fix instruction>
Replace all `execAsync` calls in `isBranchAlreadyRebased()` with `execFile`-style argument arrays so shell interpolation cannot occur. Additionally, add an allowlist validation at the route boundary enforcing `/^[A-Z]+-\d+$/i` on `issueId` before any branch-name derivation.

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

// Use execFile with separate argument array — no shell interpolation:
await execFileAsync('git', ['fetch', 'origin', targetBranch], { cwd: workspacePath });
await execFileAsync('git', ['fetch', 'origin', branchName], { cwd: workspacePath });
await execFileAsync('git', ['merge-base', '--is-ancestor', `origin/${targetBranch}`, `origin/${branchName}`], { cwd: workspacePath });
await execFileAsync('git', ['rev-parse', `origin/${branchName}`], { cwd: workspacePath });
```

Also add at merge route entry:
```ts
if (!/^[A-Z]+-\d+$/i.test(issueId)) {
  return Response.json({ error: 'Invalid issue ID format' }, { status: 400 });
}
```
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Non-null assertion on `currentHead` is fragile — `src/dashboard/server/routes/workspaces.ts:3947` — `~`
**Raised by**: correctness
**Why it blocks**: The type signature `currentHead?: string` does not enforce the invariant that `currentHead` is always present when `alreadyRebased === true`. A future modification to `isBranchAlreadyRebased` would silently produce `{ newHead: undefined }`.

<fix instruction>
Remove the non-null assertion and add a runtime guard:
```typescript
if (alreadyRebased && currentHead) {
  rebaseResult = { success: true, newHead: currentHead };
}
```
</fix>

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/workspaces.ts:4114-4118` — `?` — Transient error detection could be extracted into a helper (`isTransientMergeError`) for future extensibility. Not a blocker. (correctness)
- `src/dashboard/server/routes/workspaces.ts:165` — `?` — Duplicate fetches on repeated no-op rebase checks. Acceptable for current usage (admin-only, user-triggered), but note the scaling concern if this helper is reused in bulk contexts. Not a blocker. (performance)

## Cross-cutting groups

**Command injection in `isBranchAlreadyRebased`** (root cause: `execAsync` shell interpolation with route-derived input):
- [blocker-1] Command injection in `isBranchAlreadyRebased` — security

## What's good
- All 6 requirements verified implemented by requirements reviewer — no missing scope.
- No-op rebase pre-check is logically sound (correctness verified all 3 branches of `isBranchAlreadyRebased`).
- Timeout increase to 15 minutes correct and tested.
- `readyForMerge` preservation on transient failures correctly distinguishes transient vs permanent errors.
- All existing tests pass (9 passing in targeted run).

## Review stats
- Blockers: 1   High: 1   Medium: 0   Nits: 2
- By reviewer: correctness=2, security=1, performance=1, requirements=0 (PASS)
- Files touched: 6   Files with findings: 2

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-850 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

