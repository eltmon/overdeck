# Agent Types Index

High-level map of the roles, sub-roles, and helper agents you will encounter in Overdeck.

This document is for someone who is new to Overdeck and wants to understand:
- which lifecycle roles exist,
- what each role does,
- when each role shows up in the workflow,
- and which instruction source it runs on.

If you want implementation details, routing settings, or workflow internals, use the related docs linked at the end.

## The big picture

Overdeck no longer models the issue pipeline as a flat collection of named agent types. The runtime primitive is the issue-scoped role, with server-side shipping handling merge preparation after review and test pass.

There are three layers to keep distinct:

- **Lifecycle roles** advance issue state and own pipeline transitions.
- **Sub-roles** are model/configuration slots inside a lifecycle role.
- **Claude Code subagents** are short-lived helpers launched from inside a role session.

## Runtime role inventory

These are the roles a new Overdeck user is most likely to care about first.

| Role | Status | When it runs | Instruction basis |
|---|---|---|---|
| `plan` | Active | Turns an issue or request into an execution plan | `roles/plan.md` plus the planning template in `src/lib/cloister/prompts/planning.md` |
| `work` | Active | Implements beads in the issue workspace | `roles/work.md`, `.pan/continue.json`, and the active xBRIEF |
| `review` | Active | Reviews the completed branch and decides approve vs changes requested | `roles/review.md` plus review convoy subagents |
| `test` | Active | Runs automated checks and required browser UAT | `roles/test.md` |
| server-side shipping | Active | Rebases approved work; the human Merge button follows the derived `ready` state (approved PR, green checks, mergeable) | `rebaseFeatureBranch()` + `evaluateIssueMergeGate()` (`src/lib/cloister/merge-gate.ts`); no spawned role file |

## Sub-roles

Sub-roles are not standalone Overdeck pipeline stages. They are model and instruction slots that a parent role may invoke.

| Sub-role | Parent role | Purpose |
|---|---|---|
| `review.security` | `review` | Security-focused review lens |
| `review.correctness` | `review` | Correctness and edge-case review lens |
| `review.performance` | `review` | Performance and scalability review lens |
| `review.requirements` | `review` | Acceptance-criteria and xBRIEF fulfillment review lens |

A useful mental model is: lifecycle roles move the issue forward; sub-roles help one lifecycle role do its job.

## Typical workflow

A newcomer-friendly way to think about the normal flow is:

1. **`plan`** turns the issue into an xBRIEF plan and beads.
2. **`work`** implements the planned beads.
3. **`review`** performs code review and synthesizes the convoy findings.
4. **`test`** runs project verification and any required browser UAT.
5. Server-side shipping prepares the branch for human merge.

The `work.inspect` and `work.inspect-deep` sub-roles were deleted with the inspection gate and `pan inspect` (PAN-3917 FR-14); see [THE-CUT.md](THE-CUT.md).

Not every project or run will emphasize every sub-role equally, but the spawned roles plus server-side shipping are the core mental model.

## Important distinction: roles vs helper subagents

Some names you will see in settings or `.claude/agents/` are not lifecycle roles.

Examples:
- `review:security`
- `review:requirements`
- `subagent:explore`
- `cli:interactive`

These are real and important, but they are better understood as **role-internal helpers or routed contexts** than as the primary Overdeck roles a newcomer should picture first.

## Where model selection fits

Model choice is configured separately from this document.

Overdeck uses three workhorse model slots (`expensive`, `mid`, `cheap`) plus per-role and per-sub-role overrides. Role launch resolves the final model at spawn time, so changing a workhorse slot changes every role that references it.

If you want to tune or override models, use the routing/configuration docs rather than this page.

## Related docs

- [HARNESSES.md](./HARNESSES.md) — harness selection and ToS rules
- [CONFIGURATION.md](./CONFIGURATION.md) — provider setup, overrides, and routing behavior
- [KANBAN-MODEL.md](./KANBAN-MODEL.md) — issue lifecycle states and dashboard columns
