---
name: pan-unstick
description: "pan unstick <id> — clear a resolved issue stuck gate without corrupting merged lifecycle state"
triggers:
  - pan unstick
  - clear stuck gate
  - unstick issue
  - stale stuck banner
allowed-tools:
  - Bash
  - Read
---

# pan unstick

Run the command after the condition that caused the stuck gate has been resolved:

```bash
pan unstick <issue-id>
```

## Usage

```bash
pan unstick PAN-123
```

## What It Does

`pan unstick <id>` clears the issue's persistent stuck marker through the dashboard write route. For an active workspace, the route first verifies that the project git state is repaired, then resets stale review/test/merge approval state so the pipeline can run again.

For an issue that is already merged, the command clears only the stale stuck fields. It preserves the merged lifecycle and every recorded review, test, verification, and merge verdict.

## When to Use

- Use `pan unstick` after resolving the condition named by the issue's stuck reason.
- Use `pan review reset <id>` only when the review/test/merge lifecycle itself is inconsistent and needs a full reset.
- Do not use `pan unstick` to clear an agent pause or repeated-crash gate; use `pan unpause <id>` or `pan untroubled <id>` for those agent-level gates.

## See Also

- `pan show <id>` — inspect the issue and agent state
- `pan review reset <id>` — reset the full review lifecycle
- `pan unpause <id>` — clear an agent pause gate
- `pan untroubled <id>` — clear an agent troubled gate
