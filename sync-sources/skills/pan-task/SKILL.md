---
name: pan-task
description: "pan task <verb> <issue> — claim and complete vBRIEF checklist items"
triggers:
  - pan task
  - claim task
  - complete task
allowed-tools:
  - Bash
---

# pan task

Run the requested task command now. Task state belongs to one issue's vBRIEF checklist.

```bash
pan task next PAN-123
pan task show PAN-123 PAN-123-a
pan task claim PAN-123 PAN-123-a
pan task done PAN-123 PAN-123-a
pan task block PAN-123 PAN-123-a --reason "Waiting for API access"
pan task unblock PAN-123 PAN-123-a
pan task cancel PAN-123 PAN-123-a --reason "Removed from scope"
```

After claiming an item, implement it, commit it, push it, and only then run `pan task done`.
