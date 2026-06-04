---
name: write-vbrief
description: >
  Write a vBRIEF spec (.pan/spec.vbrief.json) and continue.json directly — without
  launching the interactive planning agent. Use when the work is well-understood
  and the agent can author the plan from the issue body and codebase alone.
  Also use when you ARE the work agent and need to self-plan before implementing.
  Covers the full vBRIEF v0.5 schema, continue.json format, bead sizing rules,
  inspection gates, and the `pan plan finalize` handoff command.
triggers:
  - write vbrief
  - create vbrief
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

# Write vBRIEF — Direct Plan Authoring

Use this skill when you want to author a vBRIEF plan directly, bypassing the interactive planning agent. This is appropriate when:

- The work is well-scoped and doesn't need a Q&A discovery session
- You are a work agent that received an issue without a pre-existing plan
- The issue is small enough that a full planning session would cost more than the work itself
- You need to rewrite or patch a broken vBRIEF before continuing work

After writing the plan, run `pan plan finalize` to materialize beads and promote the spec to main.

---

## Step 1 — Explore First

Before writing a single line of JSON, read the issue and explore the relevant code. A plan written without codebase context will have wrong file paths, wrong difficulty estimates, and spurious edges.

Minimum exploration:
- Read the issue body and any linked PRDs in `<projectRoot>/.pan/drafts/<ISSUE-ID>.md`
- Grep for the primary symbols, commands, or files the issue mentions
- Identify which subsystems are affected and how many files will change
- Check for existing specs: `find <projectRoot>/.pan/specs -name "*<issue-id>*"`

---

## Step 2 — Write `.pan/spec.vbrief.json`

The file goes at `.pan/spec.vbrief.json` in the workspace root. It MUST conform to vBRIEF v0.5.

### Full schema

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/<VERSION>",
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
      "Proposal": "<the approach chosen>"
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
          "issueLabel": "<issue-id-lowercase>",
          "requiresInspection": false,
          "inspectionDepth": "fast"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
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
| `items[].status` | One of: `draft`, `proposed`, `approved`, `pending`, `running`, `completed`, `blocked`, `cancelled`. Use `"pending"` for new items. |
| `items[].metadata.requiresInspection` | **Required on every item.** See inspection rules below. |
| `items[].metadata.inspectionDepth` | `"fast"` (default) or `"deep"`. Only matters when `requiresInspection: true`. |
| `subItems` with `metadata.kind: "acceptance_criterion"` | Each item must have at least one AC sub-item. |

---

## Step 3 — Write `.pan/continue.json`

The continue file records decisions and hazards so the work agent (and review/test agents) have context that isn't in the vBRIEF narrative.

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
  "resumePoint": null,
  "beadsMapping": {},
  "agentModel": "agent:<model-slug>",
  "sessionHistory": [
    {
      "timestamp": "<ISO 8601 timestamp>",
      "reason": "planning",
      "note": "Self-authored plan (no planning agent)",
      "agentModel": "agent:<model-slug>"
    }
  ]
}
```

Rules:
- `version` must be `"1"`
- `issueId` must be uppercase (e.g. `"PAN-1234"`)
- `resumePoint` stays `null` — the work agent populates it when it begins
- `beadsMapping` stays `{}` — `pan plan finalize` populates it

---

## Step 4 — Finalize

From the workspace root, run:

```bash
pan plan finalize
```

This atomically:
1. Reads `.pan/spec.vbrief.json`
2. Creates beads via `bd create` (one per `items[]` entry, edges respected)
3. Sets `plan.status` to `"proposed"`
4. Promotes the canonical spec into `<projectRoot>/.pan/specs/<YYYY-MM-DD>-<ISSUE>-<slug>.vbrief.json`
5. Commits on main, pushes, transitions the tracker issue to Planned

Do **not** run `bd create` yourself — `pan plan finalize` is the only sanctioned path.

---

## Bead sizing rules

Default to **many small beads** over a few large ones. A well-sized bead:

- Has one focused change (if you need "and" in the title, it's two beads)
- Is independently reviewable from its diff alone
- Leaves the tree in a working state if merged alone
- Has a testable acceptance criterion

**Heuristics:**
- One renamed command = one bead
- One moved file = one bead (unless mechanically identical batch → sub-items under one bead)
- One new API endpoint = one bead
- One schema migration = one bead
- One doc update = one bead (or one per logical cluster, not "update all docs")

When in doubt, split. Too-small beads: mild overhead. Too-large beads: reviewers can't reason about them, agents deliver partial results, and the inspection gate can't verify mid-implementation.

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

## Inspection gate (`requiresInspection`)

Set `requiresInspection: true` **only** when a wrong implementation would cascade into downstream beads before the verification gate catches it:

- **Foundation for downstream beads** — subsequent beads depend on this bead's interfaces, types, or module boundaries
- **Architectural decision crystallizing in code** — naming a public API, choosing a library boundary, picking an event shape
- **Spec ambiguity risk** — the description is broad enough that two very different diffs could both look "done"
- **Security/auth surface** — defects here propagate into later beads assuming the security posture
- **Cross-cutting protocol or schema** — wire format, DB migration, RPC contract, event payload

Set `requiresInspection: false` for:
- Mechanical changes (flag flip, rename, single-file tweak)
- Leaf beads (no downstream bead depends on their internals)
- Tests, docs, comment-only updates
- Wrongs that surface immediately at typecheck/lint

When `requiresInspection: true`, you **must** also set `metadata.foundationFor: ["<bead-id>", ...]` listing the downstream beads that would need to be redone if this one were wrong. An empty `foundationFor` on an inspection bead is a planning error — flip it back to `false`.

Most plans have 0–2 inspection beads. More than 3 suggests the beads are too large.

---

## Difficulty rubric

| Level | When | Typical model |
|-------|------|---------------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3–5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

---

## Quick checklist

Before running `pan plan finalize`:

- [ ] `.pan/spec.vbrief.json` has exactly two top-level keys: `vBRIEFInfo` and `plan`
- [ ] `plan.id` is lowercase issue ID
- [ ] `plan.uid` is a fresh UUID v4
- [ ] `plan.status` is `"approved"`
- [ ] Every item has `metadata.requiresInspection` (boolean)
- [ ] Every item has at least one `subItems` AC entry
- [ ] `foundationFor` populated on every `requiresInspection: true` item
- [ ] No spurious edges
- [ ] `.pan/continue.json` written with at least one `decisions[]` entry

---

## See also

- `docs/VBRIEF.md` — full schema reference and lifecycle states
- `/pan-plan` — start the interactive planning agent instead
- `pan plan finalize --help` — finalization flags
