# Agent Types Index

High-level map of the kinds of agents and routed jobs you will encounter in Panopticon.

This document is for someone who is new to Panopticon and wants to understand:
- what kinds of agents exist,
- what role each one plays,
- when each one shows up in the workflow,
- and what kind of instructions it runs on.

If you want implementation details, routing settings, or workflow internals, use the related docs linked at the end.

## The big picture

Panopticon has a few different layers of "agent types," and they are easy to mix up if everything is listed in one flat table.

- **Primary agents** do the main planning and implementation work.
- **Specialist agents** validate work at important checkpoints.
- **Convoy reviewers** are parallel review lenses, not the main workflow engine.
- **Subagents** are short-lived helpers for focused tasks.
- **Workflow jobs and CLI contexts** are routable slots used by the system, but they are not standalone Panopticon runtime agents in the same sense as the planning, work, or specialist agents.

## Runtime agent inventory

These are the agent types a new Panopticon user is most likely to care about first.

| Type | Category | Status | When it runs | Instruction basis |
|---|---|---|---|---|
| `planning-agent` | primary | Active | Runs when Panopticon is turning an issue or request into an execution plan | Uses planning instructions, project context, and planning artifacts to produce a vBRIEF-backed plan |
| `work-agent` | primary | Active | Runs when actual issue work begins and code needs to be implemented | Uses the main work prompt plus the current phase context, issue context, and workspace state |
| `inspect-agent` | specialist | Active | Runs during implementation when a bead is explicitly inspected before work continues | Uses per-bead inspection instructions focused on spec fidelity, constraints, and quick verification |
| `review-agent` | specialist | Active | Runs after implementation is submitted for review | Uses review instructions focused on code quality, correctness, security, and change coverage |
| `test-agent` | specialist | Active | Runs after review approval to verify the work through tests | Uses test-focused instructions for running checks, interpreting failures, and reporting test status |
| `uat-agent` | specialist | Active | Runs after tests pass when Panopticon wants real-browser validation | Uses browser/UAT instructions for requirement verification, visual checks, auth flows, and real-user behavior |
| `merge-agent` | specialist | Active | Runs at the end of the pipeline when work is ready for merge preparation and completion steps | Uses merge-focused instructions for final validation, merge prep, and post-merge lifecycle work |

## What each category is for

### Primary agents

These are the main workers in the system.

- **planning-agent** decides what should be done and how the work should be broken down.
- **work-agent** does the actual implementation work once planning is complete.

If you are trying to understand the normal day-to-day Panopticon workflow, start here.

### Specialist agents

These are quality gates and validation stages around the main implementation flow.

- **inspect-agent** checks work incrementally during implementation.
- **review-agent** performs a dedicated review pass.
- **test-agent** verifies the work through automated checks.
- **uat-agent** validates the result in a real browser from a user perspective.
- **merge-agent** handles the final merge-stage responsibilities.

A useful mental model is: the work agent builds, and the specialists decide whether that work is actually ready to move forward.

### Support and routing-only types

Panopticon also has other routed job types that matter for configuration and model selection, but are easier to misunderstand if they are treated as full runtime agent types.

- **Convoy reviewers** are parallel review lenses such as security, performance, correctness, and requirements review.
- **Subagents** are helper jobs used for focused side tasks such as exploration, planning assistance, or shell-heavy work.
- **Workflow jobs** like `status-review` are system jobs with their own model slot, not a main Panopticon runtime agent you directly think of as part of the agent roster.
- **CLI contexts** like `cli:interactive` and `cli:quick-command` describe direct user interaction modes, not autonomous workflow agents.

## Typical workflow

A newcomer-friendly way to think about the normal flow is:

1. **planning-agent** turns the issue into a plan.
2. **work-agent** implements the planned work.
3. **inspect-agent** may verify progress bead by bead during implementation.
4. **review-agent** performs a dedicated review pass.
5. **test-agent** verifies the work through tests.
6. **uat-agent** checks the result in a real browser.
7. **merge-agent** handles the final merge-stage checks and completion work.

Not every project or run will emphasize every stage equally, but this is the core mental model.

## Important distinction: runtime agents vs routed work types

Some names you will see in settings are not part of the main runtime agent roster.

Examples:
- `status-review`
- `convoy:security-reviewer`
- `convoy:requirements-reviewer`
- `subagent:explore`
- `cli:interactive`

These are still real and important, but they are better understood as **routed job types or contexts** than as the primary Panopticon agents a newcomer should picture first.

## Where model selection fits

Model choice is configured separately from this document.

Panopticon uses work types and settings to decide which model should handle each kind of job. That is an important system concept, but it is separate from the question of **what each agent type is for**.

If you want to tune or override models, use the routing/configuration docs rather than this page.

## Related docs

- [SPECIALIST_WORKFLOW.md](./SPECIALIST_WORKFLOW.md) — deeper explanation of how specialist stages work together
- [WORK-TYPES.md](./WORK-TYPES.md) — model-routing slots, overrides, and what each routed work type controls
- [CONFIGURATION.md](./CONFIGURATION.md) — provider setup, overrides, and routing behavior
