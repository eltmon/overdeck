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

# Panopticon Planning Lifecycle

`pan plan <id>` starts a planning session for an issue. Use `--auto` when the user wants the planning agent to run non-interactively and infer defensible defaults.

## Available commands

```bash
pan plan <id> [--auto] [--model <model>] [--harness claude-code|pi] [--effort low|medium|high] [--local|--remote]
pan plan finalize [-w <path>] [--json]
pan plan done <id>
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

## Finalizing (`pan plan finalize`)

Run this from inside the planning workspace after the planning agent has produced a complete `.pan/spec.vbrief.json`.

```bash
pan plan finalize
```

What it does:

1. Reads `.pan/spec.vbrief.json` from the current workspace (walks up if needed).
2. Materializes each `plan.items[]` entry into a corresponding bead, respecting declared dependencies.
3. Flips the spec's `plan.status` from `draft` to `proposed`.
4. Returns a summary of beads created, or JSON with `--json`.

Use `-w <path>` to point at another workspace.

## Completing planning (`pan plan done`)

After `finalize`, run:

```bash
pan plan done PAN-1071
```

This promotes the workspace vBRIEF to `<projectRoot>/.pan/specs/`, syncs beads, and transitions the tracker state to Planned.

## Related commands

- `pan start <id>` — start implementation from an existing vBRIEF and beads.
- `pan start <id> --auto` — skip planning and synthesize a minimal vBRIEF/beads from the issue title/body before starting work.
- `pan tell <id> <message>` — send feedback to a running planning or work agent.
- `pan kill <id>` — stop a planning or work agent without deleting the workspace.

## See also

- `roles/plan.md` — planning role prompt.
- `docs/VBRIEF.md` — vBRIEF schema, artifact locations, lifecycle states.
- `docs/SKILLS-CONVENTION.md` — skill/CLI naming convention.
