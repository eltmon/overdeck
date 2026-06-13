# `pan done`

Signal that work on an issue is complete and hand it off to the review pipeline.

## Usage

```bash
pan done <issue-id> [options]
```

## Preflight checks

Before `pan done` submits an issue to review, it runs four soft-failure gates
against the agent workspace. Any gate that fails prints diagnostics and aborts
the command. Use `--force` to bypass **all** gates (not recommended for routine
use). Use `--test-waived` to bypass only gate 4.

### 1. Open beads

`pan done` checks the workspace beads database for any open beads scoped to the
issue. Open beads mean unfinished tasks, so the command aborts until they are
closed or cancelled.

### 2. Uncommitted changes

The workspace must have a clean git status. Uncommitted source changes are not
allowed because the review pipeline needs a committed HEAD to review. Planning
artifacts under `.pan/` are auto-committed first.

### 3. vBRIEF acceptance criteria

If the workspace has a `.pan/spec.vbrief.json`, `pan done` checks that every
acceptance-criteria item is completed or cancelled. Incomplete ACs block
completion.

### 4. Test-requirement gate

If the issue body asks for tests but the branch adds no new lines under the
test-file globs, the gate fails. The body is scanned for these keywords
(case-insensitive, word boundaries where noted):

- `\btest\b`
- `regression test`
- `unit test`
- `Test:`
- `## Test plan`
- `vitest`
- `playwright`

Test-file globs checked in the rebased diff:

- `*.test.ts`
- `*.spec.ts`
- `*.test.tsx`
- `*.spec.tsx`

If the issue mentions tests and the diff adds zero lines in those globs, the
gate blocks `pan done` and prints the matched keywords.

### Bypassing the test gate

Use `--test-waived` with a reason when an existing test already covers the
requirement:

```bash
pan done PAN-1501 --test-waived "Covered by src/lib/work/__tests__/test-requirement-gate.test.ts at 9f3187eca"
```

The reason is persisted to `.pan/continue.json` as a `D-test-waived` decision
and appended to the tracker comment for human reviewers. `--test-waived` only
skips gate 4; `--force` skips all gates.

## What happens after the gates pass

1. The workspace is rebased onto the target branch and pushed.
2. The tracker is moved to the `in_review` state (GitHub labels or Linear).
3. Review artifacts (PRs) are created.
4. Review and test specialists are triggered automatically if the dashboard is
   running.

## See also

- [`pan review`](./pan-review.md) — manage the review lifecycle
- [Dashboard MERGE button](./MISSION-CONTROL.md) — merge after review passes
