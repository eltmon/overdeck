---
name: pan-plan
description: "pan plan <id> — start issue planning, including non-interactive --auto mode; also finalize/done planning artifacts"
triggers:
  - pan plan
  - plan issue
  - auto plan
  - plan finalize
  - plan done
  - finalize planning
  - complete planning
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# Overdeck Planning Lifecycle

`pan plan <id>` starts a planning session for an issue. Use `--auto` when the user wants the planning agent to run non-interactively and infer defensible defaults. Use `--probe` when the plan needs an adversarial pre-finalize self-pass; `--effort high` enables the same probe instructions automatically. Use `--auto-start` only when an autonomous orchestrator should start the work agent after planning finalizes.

## Available commands

```bash
pan plan <id> [--auto] [--auto-start] [--probe] [--model <model>] [--harness claude-code|pi|codex] [--effort low|medium|high] [--local|--remote]
pan plan finalize [-w <path>] [--json] [--no-promote] [--no-quality-lint] [--no-prd]
pan plan done <id> [--no-prd]
```

## Starting planning

```bash
pan plan PAN-1071
```

This calls the dashboard planning endpoint, creates the planning workspace, and starts the planning agent. The dashboard can also start the same flow from the issue card's **Plan…** action.

## Auto-planning

```bash
pan plan PAN-1071 --auto
```

Auto-planning runs the same planning agent without interactive questions:

- The agent must not ask the user questions.
- Ambiguous but non-contradictory choices are resolved with defensible defaults.
- Inferred choices are recorded in `plan.autoDecisions[]` with a summary and rationale.
- The agent escalates only when authoritative inputs genuinely contradict each other.

The dashboard issue card's **Auto-plan** action sends the same `auto: true` request.

## Probe pass

```bash
pan plan PAN-1071 --probe
```

`--probe` adds an adversarial self-review section to the planning prompt before finalize. The planner attacks hidden assumptions, ambiguous "done" criteria, unhandled failure modes, and missing dependency edges, then records acted-on findings in `continue.json` decisions with a `PROBE:` prefix. `--effort high` includes this section automatically.

## Auto-start after planning

```bash
pan plan PAN-1071 --auto --auto-start
```

`--auto-start` stamps `autoSpawnOnFinalize: true` into the planning agent state so `pan plan finalize` can start the work agent after it promotes the plan. This is an explicit autonomy opt-in for flywheel/orchestrator flows; default human planning leaves the issue in Planned until `pan start <id>` or Start Agent.

## Finalizing (`pan plan finalize`)

Run this from inside the planning workspace after the planning agent has produced a complete `.pan/spec.vbrief.json`.

```bash
pan plan finalize
```

What it does:

1. Reads `.pan/spec.vbrief.json` from the current workspace (walks up if needed).
2. Materializes each `plan.items[]` entry into a corresponding bead, respecting declared dependencies.
3. Flips the spec's `plan.status` from `draft` to `proposed`.
4. Calls the dashboard's complete-planning endpoint to promote the canonical spec into `<projectRoot>/.pan/specs/`, commit it on main, push, transition the tracker state to Planned, and terminate the planning session — same flow as `pan plan done` and the dashboard Done button.
5. Returns a summary of beads created and promotion status, or JSON with `--json`.

Use `-w <path>` to point at another workspace. Use `--no-promote` to leave the spec at `status=proposed` without promoting (rare; for humans who want to review the plan in the dashboard before clicking Done). Finalize runs vBRIEF quality lint by default; use `--no-quality-lint` only as a loud one-run emergency bypass when the plan must be promoted despite known quality issues.

### PRD-first gate

Finalize and complete-planning refuse to promote a plan unless a **PRD draft** of at least 20 lines exists for the issue. `roles/plan.md` has always required the PRD as the first artifact; this gate makes it mechanical. The gate searches, in order, for `<ISSUE-ID>.md` (uppercase then lowercase) under `<projectRoot>/.pan/drafts/` then `<workspace>/.pan/drafts/`; the first existing file with ≥20 lines satisfies it. A found-but-thinner draft fails with its line count; a fully missing draft fails naming the canonical path to write. `pan start <id> --auto` is structurally exempt (it synthesizes a minimal vBRIEF and never POSTs complete-planning, so the gate cannot block it). Use `--no-prd` (on `finalize` or `done`) only for a genuinely trivial issue that went through interactive planning anyway — it prints a yellow `⚠ PRD gate SKIPPED` warning and tells the endpoint to skip the check too.

## Completing planning (`pan plan done`)

`pan plan done <id>` exists for cases where finalize was run with `--no-promote`, or where a planning agent crashed between writing the spec and promoting. It calls the same complete-planning endpoint that `finalize` chains to.

```bash
pan plan done PAN-1071
```

This promotes the workspace vBRIEF to `<projectRoot>/.pan/specs/`, syncs beads, and transitions the tracker state to Planned. It is subject to the same PRD-first gate as `finalize`; pass `--no-prd` only for a genuinely trivial issue.

## Related commands

- `pan start <id>` — start implementation from an existing vBRIEF and beads.
- `pan start <id> --auto` — skip planning and synthesize a minimal vBRIEF/beads from the issue title/body before starting work.
- `pan tell <id> <message>` — send feedback to a running planning or work agent.
- `pan kill <id>` — stop a planning or work agent without deleting the workspace.

## See also

- `roles/plan.md` — planning role prompt.
- `docs/VBRIEF.md` — vBRIEF schema, artifact locations, lifecycle states.
- `docs/SKILLS-CONVENTION.md` — skill/CLI naming convention.
