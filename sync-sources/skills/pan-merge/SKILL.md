---
name: pan-merge
description: "pan merge — cancel actionable Flywheel auto-merge rows"
triggers:
  - pan merge
  - cancel auto-merge
  - flywheel auto-merge cancel
allowed-tools:
  - Bash
  - Read
---

# pan merge

Use this skill when cancelling a pending, blocked, or failed Flywheel auto-merge row.

## Commands

```bash
pan merge cancel <id>
```

## Cancel

```bash
pan merge cancel PAN-123
```

Cancels one actionable Flywheel auto-merge row for the issue id. The command calls the dashboard `DELETE /api/flywheel/auto-merge/:id` endpoint, removes that row from the active or problems list, and announces `auto-merge cancelled for <issueId>`.

An issue can hold duplicate rows from separate scheduling attempts. When more actionable rows remain, the success message reports the count and tells you to re-run `pan merge cancel <id>` to clear the next row; repeat until the normal success message contains no remaining-row notice.

If the cooldown has already expired and the selected row transitioned to `merging`, the command exits non-zero and reports that the merge is already in progress. If there is no actionable auto-merge row for the issue, it exits non-zero with `No pending auto-merge for <id>`.

## Guardrails

- A pending row is cancellable during the five-minute cooldown; blocked and failed rows remain cancellable afterward.
- Do not use raw HTTP when the CLI is available; the CLI supplies the dashboard internal token.
- A `merging` entry cannot be cancelled safely; let the merge pipeline finish or fail visibly.
