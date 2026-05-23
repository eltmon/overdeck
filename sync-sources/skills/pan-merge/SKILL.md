---
name: pan-merge
description: "pan merge [command] — manage merge operations and cancel pending auto-merge cooldowns"
type: cli-wrapper
triggers:
  - pan merge
  - auto merge
  - dashboard merge
  - merge button
allowed-tools:
  - Bash
  - Read
---

# pan merge

Use `pan merge` for merge-operation commands. Normal human-triggered merges still happen through the dashboard **MERGE** button; this wrapper exists because auto-merge adds a cancelable cooldown that agents need to handle correctly.

```bash
pan merge --help
```

Current subcommands:

```bash
pan merge cancel <issueId>
```

`pan merge cancel <issueId>` cancels a pending auto-merge cooldown by calling the same dashboard cancellation endpoint as the dashboard banner's **Cancel** button.

## When to use `pan merge cancel <issueId>`

Use it during the auto-merge cooldown when the operator wants to stop the scheduled merge before it executes. Common reasons include newly discovered risk, pending manual checks, or the operator deciding to merge manually from the dashboard instead.

Do not use it for normal merge approval. If no auto-merge cooldown is pending, the command is intentionally idempotent and reports that nothing was cancelled.

## Output and exit codes

Expected outputs:

```text
Cancelled auto-merge for PAN-1234
No pending auto-merge for PAN-1234
Cannot cancel — auto-merge for PAN-1234 is already executing
```

Exit codes:

- `0` — pending auto-merge cancelled
- `0` — no pending auto-merge existed
- `2` — auto-merge is already executing and cannot be cancelled
- `1` — unexpected dashboard or network error

## Help surface

`pan merge --help` shows:

```text
Usage: pan merge [options] [command]

Manage merge operations

Options:
  -h, --help        display help for command

Commands:
  cancel <issueId>  Cancel a pending auto-merge cooldown for an issue
  help [command]    display help for command
```

`pan merge cancel --help` shows:

```text
Usage: pan merge cancel [options] <issueId>

Cancel a pending auto-merge cooldown for an issue

Options:
  -h, --help  display help for command
```

## Safety rule

Treat merge consent as a human gate. For solo workflows, the operator may move that gate into configuration plus a cancelable cooldown. For shared workflows, keep the gate at the dashboard MERGE button so the person responsible for the merge explicitly acts at merge time.

Before recommending or enabling auto-merge, read [Auto-Merge Configuration](/configuration/auto-merge): it documents every `merge.autoMerge.*` key and explains why shared/team Panopticon instances must not enable it.
