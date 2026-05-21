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

## What It Does

Runs the close-out ceremony after a successful merge and post-merge verification. Merge
moves the issue to canonical state `verifying_on_main`; close-out is the deliberate final
step that completes the vBRIEF, archives planning artifacts, applies final cleanup, closes
the tracker issue, and clears review status.

Close-out is lighter than `pan wipe`: it preserves history and follows the configured
cleanup policy instead of force-deleting everything.

## When to Use

- After the PR has merged and the issue is in `verifying_on_main`
- After post-merge UAT on `main` has passed
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
