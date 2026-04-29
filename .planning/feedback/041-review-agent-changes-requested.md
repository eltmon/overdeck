---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T19:52:59Z
---

CODE REVIEW BLOCKED for PAN-905:

BLOCKED — 2 correctness bugs and 2 missing tests

## Bug 1 (MUST FIX): issueIdFromBranch regex partial match — webhook-handlers.ts:44-46

Regex `/feature\/([a-z]+-\d+)/i` produces WRONG issue IDs for branches with alphanumeric suffixes.

Repro: `feature/pan-3uwo` → returns `PAN-3` (not null). The `\d+` stops at the first non-digit and the regex does not anchor to word boundary. Real branches (feature/pan-3uwo, beads task branches, or future non-numeric ID formats) can be silently misrouted to wrong issues.

Fix: anchor the end — change to:
```ts
const match = ref.match(/feature\/([a-z]+-\d+)(?=[^a-z0-9]|$)/i);
```
Alternatively: `/feature\/([a-z]+-\d+)$/i` if you know the feature branch ends there, or add a word-boundary assertion.

## Bug 2 (SHOULD FIX): shell injection via exec() in refreshMergeStateFromGitHub — webhook-handlers.ts:198-200

The `repo` value from `payload.repository.full_name` is interpolated directly into a shell command string passed to `exec()`. Even though `isTrackedRepository()` validates it first, the raw webhook value (not the sanitized allowlist value) is passed to the shell. This violates the defense-in-depth principle for webhook security code.

GitHub repo names cannot contain shell metacharacters in practice, but this pattern is dangerous and should not exist in a security-sensitive code path.

Fix: use `execFile` with an array of arguments instead of string interpolation:
```ts
const { execFile } = await import("child_process");
const { promisify } = await import("util");
const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync(
  "gh",
  ["pr", "view", String(prNumber), "--repo", repo, "--json", "mergeable,mergeableState,draft", "--jq", "[.mergeable,.mergeableState,.draft]"],
  { encoding: "utf-8", timeout: 15000 }
);
```

## Missing Test 1: issueIdFromBranch partial match edge case

The regex bug above is not covered by any test. Add a test asserting that `feature/pan-3uwo` returns null (not `PAN-3`), and that `feature/pan-905` returns `PAN-905`.

## Missing Test 2: refreshMergeStateFromGitHub is not tested

The `scheduleMergeStateReconciliation` / `refreshMergeStateFromGitHub` code path (invoked when `mergeable_state === "unknown"`) is entirely absent from the test suite in `webhook-handlers.test.ts`. This function executes a subprocess and writes to the DB — it should have at minimum one test for the success path and one for the failure path (exec throws).

---

Non-blocking observations (no action required):
- `setReviewStatusAsync` defers sync SQLite via setImmediate — architecturally this is still blocking the event loop briefly, but it satisfies the route-handler rule since HTTP responses return before the SQLite call fires. Accepted.
- `DEFAULT_MERGE_RETRY_MAX = 3` is hardcoded in ReviewPipelineSection.tsx but only used for UI badge coloring, not logic. Acceptable.
- smee.ts sync FS calls (readFileSync/writeFileSync/etc) are CLI-only path — not reachable from dashboard server. Compliant with CLAUDE.md rule.
- All major new modules have test files (smee.test.ts, smee-process.test.ts, webhook-handlers.test.ts, webhooks.test.ts, system-health.test.ts, review-status-db.test.ts additions).

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
