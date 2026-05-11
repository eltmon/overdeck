# Agent Types Index

High-level map of the roles, sub-roles, and helper agents you will encounter in Panopticon.

This document is for someone who is new to Panopticon and wants to understand:
- which lifecycle roles exist,
- what each role does,
- when each role shows up in the workflow,
- and which instruction source it runs on.

If you want implementation details, routing settings, or workflow internals, use the related docs linked at the end.

## The big picture

Panopticon no longer models the issue pipeline as a flat collection of named agent types. The runtime primitive is the issue-scoped role:

```ts
export type Role = 'plan' | 'work' | 'review' | 'test' | 'ship'
```

There are three layers to keep distinct:

- **Lifecycle roles** advance issue state and own pipeline transitions.
- **Sub-roles** are model/configuration slots inside a lifecycle role.
- **Claude Code subagents** are short-lived helpers launched from inside a role session.

## Runtime role inventory

These are the roles a new Panopticon user is most likely to care about first.

| Role | Status | When it runs | Instruction basis |
|---|---|---|---|
| `plan` | Active | Turns an issue or request into an execution plan | `roles/plan.md` plus the planning template in `src/lib/cloister/prompts/planning.md` |
| `work` | Active | Implements beads in the issue workspace | `roles/work.md`, `.pan/continue.json`, and the active vBRIEF |
| `review` | Active | Reviews the completed branch and decides approve vs changes requested | `roles/review.md` plus review convoy subagents |
| `test` | Active | Runs automated checks and required browser UAT | `roles/test.md` |
| `ship` | Active | Rebases, verifies, and pushes approved work for human merge | `roles/ship.md` |

## Sub-roles

Sub-roles are not standalone Panopticon pipeline stages. They are model and instruction slots that a parent role may invoke.

| Sub-role | Parent role | Purpose |
|---|---|---|
| `work.inspect` | `work` | Per-bead spec verification for beads flagged `metadata.requiresInspection: true` |
| `work.inspect-deep` | `work` | Stronger inspection path for high-risk beads |
| `review.security` | `review` | Security-focused review lens |
| `review.correctness` | `review` | Correctness and edge-case review lens |
| `review.performance` | `review` | Performance and scalability review lens |
| `review.requirements` | `review` | Acceptance-criteria and vBRIEF fulfillment review lens |

A useful mental model is: lifecycle roles move the issue forward; sub-roles help one lifecycle role do its job.

## Typical workflow

A newcomer-friendly way to think about the normal flow is:

1. **`plan`** turns the issue into a vBRIEF plan and beads.
2. **`work`** implements the planned beads.
3. **`work.inspect` / `work.inspect-deep`** verify flagged beads during implementation.
4. **`review`** performs code review and synthesizes the convoy findings.
5. **`test`** runs project verification and any required browser UAT.
6. **`ship`** prepares the branch for human merge.

Not every project or run will emphasize every sub-role equally, but the five lifecycle roles are the core mental model.

## Important distinction: roles vs helper subagents

Some names you will see in settings or `.claude/agents/` are not lifecycle roles.

Examples:
- `review:security`
- `review:requirements`
- `subagent:explore`
- `cli:interactive`

These are real and important, but they are better understood as **role-internal helpers or routed contexts** than as the primary Panopticon roles a newcomer should picture first.

## Where model selection fits

Model choice is configured separately from this document.

Panopticon uses three workhorse model slots (`expensive`, `mid`, `cheap`) plus per-role and per-sub-role overrides. Role launch resolves the final model at spawn time, so changing a workhorse slot changes every role that references it.

If you want to tune or override models, use the routing/configuration docs rather than this page.

## Related docs

- [HARNESSES.md](./HARNESSES.md) — harness selection and ToS rules
- [CONFIGURATION.md](./CONFIGURATION.md) — provider setup, overrides, and routing behavior
- [KANBAN-MODEL.md](./KANBAN-MODEL.md) — issue lifecycle states and dashboard columns
