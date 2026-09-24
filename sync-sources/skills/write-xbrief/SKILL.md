---
name: write-xbrief
description: >
  Write an xBRIEF spec and continue.json directly — without launching the interactive
  planning agent. The workspace copy lives in the runtime dir `.overdeck/`; finalize
  reads it and promotes the canonical spec to `.pan/specs/` in the project repo. Use when the work is well-understood
  and the agent can author the plan from the issue body and codebase alone.
  Also use when you ARE the work agent and need to self-plan before implementing.
  Covers the full xBRIEF v0.8 schema, continue.json format, task sizing rules,
  and the `pan plan finalize` handoff command.
triggers:
  - write xbrief
  - create xbrief
  - write spec.vbrief.json
  - skip planning agent
  - self-plan
  - author plan
  - create plan manually
  - write plan without planning agent
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - Glob
---

# Write xBRIEF — Direct Plan Authoring

Use this skill when you want to author an xBRIEF plan directly, bypassing the interactive planning agent. This is appropriate when:

- The work is well-scoped and doesn't need a Q&A discovery session
- You are a work agent that received an issue without a pre-existing plan
- The issue is small enough that a full planning session would cost more than the work itself
- You need to rewrite or patch a broken xBRIEF before continuing work

After writing the plan, run `pan plan finalize` to materialize xBRIEF tasks and promote the spec to `.pan/specs/` in the project repo (or the configured plan-home repo for polyrepo projects).

---

## Step 1 — Explore First

Before writing a single line of JSON, read the issue and explore the relevant code. A plan written without codebase context will have wrong file paths, wrong difficulty estimates, and spurious edges.

Minimum exploration:
- Read the issue body and the canonical PRD at `.pan/drafts/<issue-id-lowercase>.md` in the project repo
- Grep for the primary symbols, commands, or files the issue mentions
- Identify which subsystems are affected and how many files will change
- Check `.pan/specs/` in the project repo for an existing issue spec

---

## Step 2 — Write `.overdeck/spec.vbrief.json`

The file goes at `.overdeck/spec.vbrief.json` in the workspace root and MUST conform to xBRIEF v0.8. The workspace copy lives in the runtime dir `.overdeck/`; finalize reads it and promotes the canonical spec to `.pan/specs/` in the project repo with the `.xbrief.json` extension, committed on the feature branch.

### Full schema

```json
{
  "xBRIEFInfo": {
    "version": "0.8",
    "created": "<ISO 8601 timestamp>",
    "author": "overdeck/<VERSION>",
    "description": "Plan for <ISSUE-ID>: <issue title>"
  },
  "plan": {
    "id": "<issue-id-lowercase>",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<UUID v4>",
    "author": "agent:<model-slug>",
    "sequence": 1,
    "created": "<ISO 8601 timestamp>",
    "updated": "<ISO 8601 timestamp>",
    "references": [
      { "uri": "<issue URL>", "label": "<ISSUE-ID>", "type": "issue" }
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>",
      "NonGoals": "<explicitly out of scope; behaviors this issue must NOT introduce — one per line, prefixed '- '>"
    },
    "autoDecisions": [],
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "kind": "docs|api|backend|frontend|infra|test|refactor|design|spike",
          "issueLabel": "<issue-id-lowercase>",
          "files_scope": ["src/path/to/file.ts"],
          "files_scope_confidence": "high",
          "verify_commands": ["npm run typecheck"],
          "expected_outputs": ["typecheck completes without errors"],
          "readiness": "ready",
          "traces": ["FR-1", "NFR-2"],
          "requiresInspection": false,
          "inspectionDepth": "fast",
          "foundationFor": []
        },
        "narrative": { "Action": "<what needs to be done>" },
        "items": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
```

### Field rules

| Field | Rule |
|-------|------|
| `plan.id` | Issue ID in **lowercase** — e.g. `"pan-1234"`. Never `issueId`, never `issue_id`. |
| `plan.uid` | Fresh UUID v4. Generate with `node -e "console.log(crypto.randomUUID())"`. |
| `plan.status` | Must be `"approved"` when written by a self-planning agent (skip `draft`/`proposed`). |
| `items[].status` | One of: `draft`, `proposed`, `approved`, `pending`, `running`, `completed`, `blocked`, `cancelled`, `failed`. Use `"pending"` for new items. |
| `items[].metadata.kind` | Required routing category: `docs`, `api`, `backend`, `frontend`, `infra`, `test`, `refactor`, `design`, or `spike`. |
| `plan.narratives.NonGoals` | Required narrative. List everything discovery established as out of scope (`"none"` if genuinely nothing); review enforces these as must-not constraints. |
| `items[].metadata.files_scope` | Required `string[]` of files/globs this item is expected to touch. Use concrete paths or narrow globs, not broad repo-wide patterns. |
| `items[].metadata.files_scope_confidence` | Required confidence in `files_scope`: `"high"`, `"medium"`, or `"low"`. |
| `items[].metadata.verify_commands` | Required for slot-eligible items. List commands that verify this item before slot merge, e.g. `["npm run typecheck", "npx vitest run tests/unit/foo.test.ts"]`. |
| `items[].metadata.expected_outputs` | Required for slot-eligible items. List the observable evidence expected from `verify_commands`, e.g. `["foo.test.ts passes"]`. |
| `items[].metadata.readiness` | Required static parallel-safety classification: `"ready"` when the item can run in its own slot after DAG blockers complete, `"sequential"` only when it must remain serialized after prerequisites, and `"needs_refinement"` when it must be split or clarified. Incoming `blocks` edges do not imply `"sequential"`; edges control dispatch order. |
| `items[].metadata.traces` | Optional `string[]` of PRD requirement IDs (`FR-1`, `NFR-2`) this item satisfies. |
| `items[].metadata.requiresInspection` | Required boolean. There is no blocking inspection gate anymore (PAN-3917) — this only decides whether a standing tier-supervisor subscribes to this item's commits (`flagged` subscription policy). Default `false`; set `true` for genuinely risky items (schema/migration changes, auth, money paths). |
| `items[].metadata.inspectionDepth` | Required when `requiresInspection` is `true`: `"fast"` or `"deep"`, how closely the supervisor should read commits. |
| `items[].metadata.foundationFor` | Required non-empty `string[]` when `requiresInspection` is `true`: the downstream item IDs that build on this one. `quality-lint.ts` rejects `requiresInspection: true` with an empty or missing list. |
| nested `items` with `metadata.kind: "acceptance_criterion"` | Each item must have at least one acceptance-criterion child item. |

---

## Step 3 — Write `.overdeck/continue.json`

The continue file records decisions and hazards so the work agent (and review/test agents) have context that isn't in the xBRIEF narrative.

```json
{
  "version": "1",
  "issueId": "<ISSUE-ID-UPPERCASE>",
  "created": "<ISO 8601 timestamp>",
  "updated": "<ISO 8601 timestamp>",
  "gitState": { "branch": "<current branch>", "sha": "<short sha>", "dirty": false },
  "decisions": [
    { "id": "D1", "summary": "<decision text>", "recordedAt": "<ISO 8601 timestamp>" }
  ],
  "hazards": [
    { "id": "H1", "summary": "<risk or edge case>", "mitigation": "<how to handle it>" }
  ],
  "tasksMapping": {},
  "agentModel": "agent:<model-slug>"
}
```

Rules:
- `version` must be `"1"`
- `issueId` must be uppercase (e.g. `"PAN-1234"`)
- `tasksMapping` stays `{}` — `pan plan finalize` populates it

---

## Step 4 — Finalize

From the workspace root, run:

```bash
pan plan finalize
```

This atomically:
1. Reads the workspace spec at `.overdeck/spec.vbrief.json`
2. Creates xBRIEF tasks through the canonical writer (one per `items[]` entry, edges respected)
3. Sets `plan.status` to `"proposed"`
4. Promotes the canonical spec to `.pan/specs/<YYYY-MM-DD>-<ISSUE>-<slug>.xbrief.json` in the project repo
5. Commits and pushes the feature branch, then transitions the tracker issue to Planned


---

## Task sizing rules

Default to **many small xBRIEF tasks** over a few large ones. A well-sized task:

- Has one focused change (if you need "and" in the title, it's two xBRIEF tasks)
- Is independently reviewable from its diff alone
- Leaves the tree in a working state if merged alone
- Has a testable acceptance criterion

**Heuristics:**
- One renamed command = one task
- One moved file = one task (unless mechanically identical batch → sub-items under one task)
- One new API endpoint = one task
- One schema migration = one task
- One doc update = one task (or one per logical cluster, not "update all docs")

When in doubt, split. Too-small xBRIEF tasks: mild overhead. Too-large xBRIEF tasks: reviewers can't reason about them and agents deliver partial results.

---

## Edge semantics

Add an edge only when there is a **real** dependency:

| When to add `blocks` edge | When NOT to add |
|---------------------------|-----------------|
| B consumes a file/type/value A produces | Narrative flow ("feels like it should come second") |
| Both items modify the same file | Readability preference |
| B can't start until A reaches a specific state | Defensive sequencing "just in case" |

Absent edges = permission for the work agent to run items in parallel. A spurious edge silently forces serialization that was never intended.

Edge types: `blocks` (hard), `informs` (soft/advisory), `invalidates`, `suggests`

---

## Difficulty rubric

| Level | When |
|-------|------|
| `trivial` | Typo, comment, formatting only |
| `simple` | Bug fix, single file, obvious change |
| `medium` | New feature, 3–5 files, standard patterns |
| `complex` | Refactor, migration, 6+ files, some risk |
| `expert` | Architecture, security, performance, high risk |

---

## Quick checklist

Before running `pan plan finalize`:

- [ ] `.overdeck/spec.vbrief.json` has exactly two top-level keys: `xBRIEFInfo` and `plan`
- [ ] `plan.id` is lowercase issue ID
- [ ] `plan.uid` is a fresh UUID v4
- [ ] `plan.status` is `"approved"`
- [ ] Every item has `metadata.kind`
- [ ] Every item has `metadata.files_scope`, `metadata.files_scope_confidence`, and `metadata.readiness`
- [ ] Every slot-eligible item has `metadata.verify_commands` and `metadata.expected_outputs`
- [ ] Every item has `metadata.requiresInspection`; items with `requiresInspection: true` also have `metadata.inspectionDepth` and a non-empty `metadata.foundationFor`
- [ ] Every item has at least one nested `items` AC entry
- [ ] No spurious edges
- [ ] `.overdeck/continue.json` written with at least one `decisions[]` entry

---

## See also

- `docs/XBRIEF.md` — full schema reference and lifecycle states
- `/pan-plan` — start the interactive planning agent instead
- `pan plan finalize --help` — finalization flags
