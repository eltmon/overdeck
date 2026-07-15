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
--accept-verification Row 3: branch verification passed at lastVerifiedCommit
--accept-merged       Row 4: PR merged on the forge
--accept-post-merge   Row 5: post-merge lifecycle completed
--accept-main-verify  Row 6: merge commit verified on main
--accept-deploy       Row 7: live dashboard build includes the merge
```

An acceptance records the flag, operator/agent identity, and timestamp in the
issue close-out record. Use it only when the missing evidence is understood:

```bash
pan close PAN-1234 --force
# Row 7 deploy: MISS — live server build predates the merge
pan close PAN-1234 --force --accept-deploy
# Row 7 deploy: MISS-ACCEPTED — override is now durable and auditable
```

## What It Does

Runs the close-out ceremony after mechanically checking review, tests, branch verification,
forge merge, post-merge lifecycle, main verification, deployment, and teardown. Merge
moves the issue to canonical state `verifying_on_main`; close-out is the deliberate final
step that completes the vBRIEF, archives planning artifacts, applies final cleanup, closes
the tracker issue, and clears review status.

Close-out is lighter than `pan wipe`: it preserves history and follows the configured
cleanup policy instead of force-deleting everything.

## When to Use

- After the PR has merged and the issue is in `verifying_on_main`
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
- `auto` — let Deacon run close-out automatically for eligible `verifying_on_main` issues when true.
- `auto_delay_minutes` — minimum age after merge before automatic close-out is eligible.

## See Also

- `pan approve <id>` — approve and prepare merge flow before close-out
- `pan wipe <id>` — forceful cleanup including branches (for abandoned work)
