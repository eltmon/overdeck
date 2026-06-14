---
scope: dev
---
### Enforce no-inspection policies mechanically

When the operator sets a no-inspection policy on an issue,
`requiresInspection` must be false on every bead and no `pan inspect` path may
run, including PostToolUse hooks or other automatic triggers.

If a bead would need inspection to pass, mark it blocked. Disable the
auto-trigger path; do not rely on restraint.
