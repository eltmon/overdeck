---
name: pan-merge
description: "pan merge — cancel pending Flywheel auto-merges during the cooldown window"
triggers:
  - pan merge
  - cancel auto-merge
  - flywheel auto-merge cancel
allowed-tools:
  - Bash
  - Read
---

# pan merge

Use this skill when cancelling a pending Flywheel auto-merge before its cooldown expires.

## Commands

```bash
pan merge cancel <id>
```

## Cancel

```bash
pan merge cancel PAN-123
```

Cancels a pending Flywheel auto-merge for the issue id. The command calls the dashboard `DELETE /api/flywheel/auto-merge/:id` endpoint, removes the entry from the active pending list, and announces `auto-merge cancelled for <issueId>`.

If the cooldown has already expired and the executor transitioned the entry to `merging`, the command exits non-zero and reports that the merge is already in progress. If there is no active pending auto-merge for the issue, it exits non-zero with `No pending auto-merge for <id>`.

## Guardrails

- Use this only during the five-minute auto-merge cooldown window.
- Do not use raw HTTP when the CLI is available; the CLI supplies the dashboard internal token.
- A `merging` entry cannot be cancelled safely; let the merge pipeline finish or fail visibly.
