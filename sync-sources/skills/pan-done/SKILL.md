---
name: pan-done
description: "pan done <id> — mark work complete and signal the review pipeline"
triggers:
  - pan done
  - mark done
  - work complete
  - signal done
  - complete issue
allowed-tools:
  - Bash
---

# pan done

Run the command now:

```bash
pan done <issue-id>
```

## What It Does

Signals that work on an issue is complete. Runs quality gates (typecheck, lint, tests)
and, if they pass, opens or updates the pull request and requests review. `pan done`
writes nothing else — no pipeline record, no status field; the PR and its review state
are the whole answer to "is this in review." The agent's tmux session remains alive for
follow-up.

### Test-requirement gate

Before handing off, `pan done` scans the issue body for test-shaped keywords
(`test`, `regression test`, `unit test`, `Test:`, `## Test plan`, `vitest`,
`playwright`) and counts new lines added to `*.test.ts`, `*.spec.ts`,
`*.test.tsx`, and `*.spec.tsx` files in the rebased diff. If the issue asks for
tests but zero new test-file lines were added, the command refuses to close and
lists the matched keywords with their line numbers.

Use `--test-waived "<reason + sha of existing test that covers this>"` to skip
the gate when an existing test already covers the requirement. For example:

```bash
pan done PAN-1501 --test-waived "Regression coverage exists in src/lib/work/__tests__/test-requirement-gate.test.ts at abc1234"
```

`--test-waived` skips only the test-requirement gate; `--force` skips all
pre-flight checks.

## When to Use

- An agent has finished implementing a feature and all work is committed
- Manually signaling completion after direct edits to a workspace
- Re-signaling after fixing verification gate failures

## See Also

- `gh pr view <issue-branch>` — see what's queued for review
- Dashboard MERGE button — merge after approvals and checks are green
- `pan show <id>` — inspect the current state before signaling done
