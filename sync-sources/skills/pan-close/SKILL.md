---
name: pan-close
description: "pan close <id> — close-out ceremony for a completed and merged issue"
triggers:
  - pan close
  - close issue
  - close out
  - finalize issue
allowed-tools:
  - Bash
---

# pan close

Run the command now:

```bash
pan close <issue-id>
```

Useful options:

```bash
pan close <issue-id> --json
pan close <issue-id> --force
```

`pan close` first prints the Definition-of-Done gate table: row number, gate ID,
expected evidence, observed evidence, and `PASS`, `MISS`, `SKIP`, or
`MISS-ACCEPTED`. An unaccepted `MISS` blocks every archive, teardown, and tracker
mutation. `--force` skips the confirmation prompt; it never bypasses this gate.

Each overridable row has one explicit acceptance flag:

```text
--accept-review       Row 1: review passed
--accept-tests        Row 2: tests passed
--accept-verification Row 3: branch verification passed
--accept-merged       Row 4: PR merged on the forge
--accept-post-merge   Row 5: post-merge lifecycle completed
--accept-main-verify  Row 6: merge commit verified on main
--accept-deploy       Row 7: live dashboard build includes the merge
```

An acceptance records the flag, operator identity, and timestamp as a durable,
auditable trail (commit trailer or PR comment) — never a pipeline record. The
autonomous flywheel may run a clean close-out, but it cannot use `--accept-*`;
an operator must apply every override after reviewing the miss.
Use an override only when the missing evidence is understood:

```bash
pan close PAN-1234 --force
# Row 7 deploy: MISS — live server build predates the merge
pan close PAN-1234 --force --accept-deploy
# Row 7 deploy: MISS-ACCEPTED — override is now durable and auditable
```

## Residue Disposition

For tracker-closed issues with stale convention PRs/MRs (PAN-3396), use `--residue`:

```bash
pan close PAN-1234 --residue "pre-record-era stale PR cleanup"
```

`--residue` records a residue disposition: closes stale convention PRs/MRs with an honest "no merge claim"
comment, verifies the tracker issue is closed, skips the Definition-of-Done gate with verified evidence,
and marks the issue terminal without asserting a merge claim. Residue is operator-conversation-only and
cannot be combined with `--abandon` or `--accept-*` flags.

## What It Does

Runs the close-out ceremony after mechanically checking review, tests, branch verification,
forge merge, post-merge lifecycle, main verification, deployment, and teardown — all derived
from the PR, checks, and git, never a stored field. Merge puts the issue in the derived
`merged` state; close-out is the deliberate final step that completes the xBRIEF, archives
planning artifacts, applies final cleanup, and closes the tracker issue.

Close-out is lighter than `pan wipe`: it preserves history and follows the configured
cleanup policy instead of force-deleting everything.

## When to Use

- After the PR has merged and the issue is in the derived `merged` state
- After post-merge verification on `main` has passed and the live build includes the merge
- Completing the lifecycle for a finished issue

## Close-Out Configuration

The `close_out` section in Cloister config controls what close-out is allowed to do:

```yaml
close_out:
  remove_workspace: false
  delete_feature_branch: false
  auto: false
  auto_delay_minutes: 60
```

- `remove_workspace` — delete the worktree/workspace during close-out when true.
- `delete_feature_branch` — delete local/remote feature branches during close-out when true.
- `auto` — let deacon-lite's closed-issue reaper run close-out automatically for eligible merged issues when true.
- `auto_delay_minutes` — minimum age after merge before automatic close-out is eligible.

## See Also

- `gh pr view <issue-branch>` — check approvals and checks before close-out
- `pan wipe <id>` — forceful cleanup including branches (for abandoned work)
