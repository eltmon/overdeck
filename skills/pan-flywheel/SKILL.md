---
name: pan-flywheel
description: "pan flywheel — orchestrator lifecycle, status, stats, and reporting helpers"
triggers:
  - pan flywheel
  - flywheel status
  - flywheel stats
  - flywheel report
allowed-tools:
  - Bash
  - Read
---

# pan flywheel

Manage the Fix-All Flywheel orchestrator and inspect its run output.

## Common commands

```bash
pan flywheel start
pan flywheel status
pan flywheel status --json
pan flywheel stats
pan flywheel stats --window 7d
pan flywheel stats --json
pan flywheel pause
pan flywheel resume
pan flywheel report
pan flywheel report --force
pan flywheel abort
```

## Stats

Use `pan flywheel stats` for the v1.0 readiness criteria summary. It queries the dashboard stats endpoint with a default 30-day window and prints one row per criterion.

```text
Flywheel stats (30d)
Generated: 2026-05-25T10:00:00.000Z

| Criterion | Value | Target | Status | Trend | Sample |
|---|---:|---:|---|---|---:|
| Substrate-bug discovery rate | 1.0% | 2.0% | ● green | ↘ down | 120 |
| Critical/P0 substrate bugs | 0 | 0 | ● green | — | 120 |
```

Use `--window <duration>` to request another duration such as `7d` or `24h`. Use `--json` when another tool needs the raw `FlywheelStats` payload.

## Lifecycle safety

`pan flywheel report` finalizes the active run by writing `report.md` and clearing the active-run gate. Pause or abort the orchestrator first unless the orchestrator itself is calling `pan flywheel report --force` at end of run.
