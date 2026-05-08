# PAN-382: Inspect Specialist — Per-Step Verification (Conditional)

> **2026-05-08 design revision:** Inspection is now **opt-in per bead** via `metadata.requiresInspection: true|false` on each plan item. The original PAN-382 design made inspection mandatory after every `bd close`; in practice that turned 12-bead mechanical refactors into 12-step interviews and added compounding stall risk on the inspect-dispatch path. The new model preserves the Jidoka guarantee for the *foundational* beads where it matters (the MIN-796 class of failure) while removing the tax from mechanical beads (flag flips, file renames, isolated bug fixes) where the inspector would just rubber-stamp a 15-line diff. The planning agent now explicitly evaluates the inspection requirement for every bead during plan creation — see "Planning-Time Decision" below and `src/lib/cloister/prompts/planning.md` § "Inspection Requirement".

## Summary

The **Inspect Specialist** verifies that a completed bead's implementation matches its specification and architectural constraints before downstream beads can build on it. It runs **only** for beads the planning agent flagged with `metadata.requiresInspection: true`.

**Jidoka principle (applied selectively): never pass a *foundation-class* defect downstream.**

## Motivation

MIN-796 (Kaia Chat) demonstrated a cascading failure: the agent built `KaiaRuntime.ts` on `ChatContext` (the React state machine) instead of `ChatService.ts` (the HTTP/SSE layer) as specified in the bead description and PRD. This wrong foundation infected 7 subsequent beads (~5,800 lines). The review specialist runs on the finished MR — by then, the damage was irreversible without a full restart.

The Inspect Specialist catches this at bead 1, not bead 7.

## Pipeline Change

**Before PAN-382:**
```
Agent works all beads → Review (full MR) → Test → Merge
```

**After PAN-382 (current, conditional):**
```
Agent finishes bead → Check metadata.requiresInspection
                       │
                       ├── false → continue to next bead (default)
                       │
                       └── true  → Inspect (bead diff) → PASS → continue to next bead
                                                        → BLOCKED → fix → re-inspect
                    ...all beads done...
                    → Review (full MR) → Test → Merge
```

The existing review → test → merge pipeline is unchanged. Inspect is a stage that runs **during** the agent's work — but only for beads where the planning agent decided downstream foundation risk is real.

## Planning-Time Decision

**Every bead in the vBRIEF carries `metadata.requiresInspection: true|false`.** This is the planning agent's deliberate per-bead decision, made during plan creation, not a default-on or default-off.

The planning prompt (`src/lib/cloister/prompts/planning.md` § "Inspection Requirement") gives the planning agent the criteria. In summary:

**Set `requiresInspection: true` when:**
1. The bead lays a foundation other beads depend on (interfaces, types, file layout, module boundaries).
2. It encodes an architectural decision the team would want to checkpoint (public API naming, library boundary, event-shape choice).
3. The bead's description has spec ambiguity — the agent could plausibly produce two very different "done" diffs.
4. It touches a security/permission/auth surface.
5. It defines a cross-cutting protocol or schema (wire format, DB migration, RPC contract, event payload).

**Set `requiresInspection: false` (the default for most beads) when:**
- The work is mechanically simple (flag flip, value rename, single-file config tweak).
- The bead is a leaf — no other bead depends on its internal structure.
- It's a test, doc, or comment-only update.
- A wrong implementation surfaces immediately at typecheck/lint/verification gate, not as silent foundation rot.

Most plans will have **0–2 beads with `requiresInspection: true`.** A plan with more than 3 typically indicates under-decomposition (the beads are too large), not an unusually risky issue.

---

## How It Works

### 1. Agent Triggers Inspection (Only When Flagged)

After `bd close`, the work agent reads the closed bead's `metadata.requiresInspection` from `.pan/spec.vbrief.json`:

- **`requiresInspection: false`** — agent skips inspection entirely and moves to the next bead. This is the path most beads take.
- **`requiresInspection: true`** — agent requests inspection:

  ```bash
  pan inspect <issueId> --bead <beadId>
  ```

  This:
  1. Captures the current HEAD commit as the inspection point
  2. Computes the diff since the last passed inspection (or branch base for the first inspected bead)
  3. Reads the bead description from the beads store
  4. Queues an inspect-agent task

  The agent then **waits** for the inspection result before proceeding to the next bead.

There is no auto-trigger from `bd close` — `pan inspect` is an explicit command the agent runs only when the bead is flagged. Closing a bead never spawns the inspector on its own.

### 2. Inspect Specialist Runs

An ephemeral Claude Code session spawns (same pattern as review/test/merge specialists). It receives:

- **Bead description** — What the agent was asked to build
- **Diff** — Only the changes since the last inspection checkpoint
- **Workspace path** — To read CLAUDE.md, PRD, and other constraint files
- **Issue ID** — For context and signaling

The specialist performs three checks:

#### Check 1: Spec Fidelity
Read the bead description. Read the diff. Does the implementation match what was specified?

Example catches:
- Bead says "build on ChatService.ts" but agent imported ChatContext
- Bead says "use assistant-ui ComposerPrimitive" but agent built custom textarea
- Bead says "OKLCH tokens" but agent used hex colors

#### Check 2: Constraint Compliance
Read CLAUDE.md and any PRD files in the workspace. Check for violations:

- Prohibited imports (e.g., "no ChatContext imports in /chat components")
- Required patterns (e.g., "must use async, never execSync")
- Architectural constraints (e.g., "no MUI in new components")

Machine-checkable constraints are verified with grep/find. Judgment-based constraints are evaluated by the specialist's LLM reasoning.

#### Check 3: Compile + Smoke
Run the project's compile/lint commands:
- TypeScript: `tsc --noEmit`
- Lint: `eslint` or equivalent
- Not a full test suite — that's the test specialist's job

### 3. Inspect Specialist Reports

**On PASS:**
```bash
# 1. Store the checkpoint (current HEAD becomes the baseline for next inspection)
# 2. Send feedback to the agent
pan tell <issueId> "INSPECTION PASSED for bead <beadId>. Proceed to next bead."

# 3. Signal completion
curl -X POST <apiUrl>/api/specialists/done \
  -H "Content-Type: application/json" \
  -d '{"specialist":"inspect","issueId":"<issueId>","status":"passed","notes":"Bead <beadId> matches spec, no constraint violations"}'
```

**On BLOCKED:**
```bash
# 1. Send specific feedback to the agent
pan tell <issueId> "INSPECTION BLOCKED for bead <beadId>:

VIOLATIONS:
1. [KaiaRuntime.ts:17] Imports ChatContext — bead specifies ChatService.ts
2. [Composer.tsx:3] Uses useChat() hook — should use assistant-ui ComposerPrimitive

REQUIRED ACTIONS:
- Rewrite KaiaRuntime to build on ChatService.ts directly
- Replace custom Composer with assistant-ui primitives

Fix and re-request inspection: pan inspect <issueId> --bead <beadId>"

# 2. Signal completion
curl -X POST <apiUrl>/api/specialists/done \
  -H "Content-Type: application/json" \
  -d '{"specialist":"inspect","issueId":"<issueId>","status":"failed","notes":"Spec fidelity violation: built on ChatContext instead of ChatService"}'
```

### 4. Checkpoint System

Inspections use a **commit checkpoint** to scope the diff:

```
Branch base ──── Bead 1 commits ──── [Inspect PASS] ──── Bead 2 commits ──── [Inspect PASS] ──── ...
                                     checkpoint₁                              checkpoint₂
```

- **First inspection:** diff from `main...HEAD` (full branch diff)
- **Subsequent inspections:** diff from `checkpoint_n-1...HEAD`
- **On PASS:** current HEAD SHA stored as the new checkpoint
- **On BLOCKED + fix + re-inspect:** diff from same checkpoint (includes fix commits)

Checkpoints stored in: `~/.panopticon/specialists/<project>/inspect-agent/checkpoints/<issueId>.json`

```json
{
  "issueId": "MIN-796",
  "checkpoints": [
    { "beadId": "myn-80", "commitSha": "abc123", "passedAt": "2026-03-22T10:00:00Z" },
    { "beadId": "myn-81", "commitSha": "def456", "passedAt": "2026-03-22T11:30:00Z" }
  ]
}
```

---

## Implementation

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/cloister/inspect-agent.ts` | Agent implementation: prompt building, result parsing, checkpoint management |
| `src/lib/cloister/prompts/inspect-agent.md` | Prompt template for the inspect specialist |
| `src/cli/commands/inspect.ts` | `pan inspect <issueId> --bead <beadId>` CLI command |

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/cloister/specialists.ts` | Add `'inspect-agent'` to `SpecialistType` union. Wire into `spawnEphemeralSpecialist`. |
| `src/lib/cloister/review-status.ts` | Add `inspectStatus` field to status tracking. |
| `src/dashboard/server/index.ts` | Add `'inspect-agent'` to valid specialist names in API endpoints. |
| `src/cli/commands/specialists/wake.ts` | Add `'inspect-agent'` to `validNames` array. |
| `src/cli/commands/specialists/reset.ts` | Add `'inspect-agent'` to reset logic. |
| `src/cli/commands/specialists/done.ts` | Handle inspect completion → send feedback to agent. |

### Configuration Updates

**`cloister.toml`:**
```toml
[specialists.inspect_agent]
enabled = true
auto_wake = true
```

**`projects.yaml` specialist config:**
```yaml
specialists:
  prompts:
    inspect-agent: |
      Optional per-project custom inspection constraints...
```

**Model selection** (`cloister.toml`):
```toml
[model_selection.specialist_models]
inspect_agent = "sonnet"  # Needs reasoning but not Opus-level; must be fast
```

### Documentation Updates

| File | Change |
|------|--------|
| `docs/SPECIALIST_WORKFLOW.md` | Add Inspect Specialist section with pipeline diagram and agent instructions |
| `docs/CONFIGURATION.md` | Add inspect_agent config options |
| `docs/INDEX.md` | Update index to reference new specialist |
| GitHub issue PAN-382 | Update with implementation notes |

---

## Inspect Specialist Prompt Template (Draft)

```markdown
# Inspect Specialist — Per-Step Verification

You are verifying that a single unit of work (bead) was implemented correctly
before the agent proceeds to the next step.

## Context

- **Issue:** {{issueId}}
- **Bead:** {{beadId}}
- **Bead Description:** {{beadDescription}}
- **Workspace:** {{workspacePath}}
- **Diff scope:** Changes since {{checkpoint}} ({{diffStats}})

## Your Task

### Check 1: Spec Fidelity

Read the bead description above carefully. Then examine the diff.

**Ask yourself:** Does this diff implement what the bead asked for?

Common deviations to watch for:
- Building on a different module/service than specified
- Using a different library/component than specified
- Implementing a subset of what was asked and marking it complete
- Implementing something adjacent but not what was described

### Check 2: Constraint Compliance

Read the workspace CLAUDE.md and any PRD files:
- {{workspacePath}}/CLAUDE.md
- {{workspacePath}}/fe/CLAUDE.md (if exists)
- {{workspacePath}}/docs/ (scan for PRDs)

Check the diff for violations of stated constraints. Also grep for
any prohibited patterns mentioned in CLAUDE.md or the PRD.

### Check 3: Compile + Smoke

Run compile and lint checks:
{{compileCommand}}

Report any errors. The code must compile cleanly.

## Decision

### PASS
All three checks pass. The implementation matches the spec, no constraints
are violated, and the code compiles.

### BLOCKED
Any check fails. Be SPECIFIC about what's wrong and what the agent must fix.

## Signal Completion

{{signalInstructions}}
```

---

## What Inspect Does NOT Do

- **Full code review** — That's the review specialist on the completed MR
- **Run the test suite** — That's the test specialist
- **Security/performance audit** — That's the review specialist
- **Code style or best practices** — That's the review specialist
- **Evaluate whether the bead SHOULD have been written this way** — Inspect checks fidelity to the spec, not whether the spec is good

---

## Agent Workflow Integration

Work agents request inspection **only for beads where the planning agent set `metadata.requiresInspection: true`.** This is communicated via:

1. **Work prompt** (`src/lib/cloister/prompts/work.md`) — encodes the per-bead branching: read `metadata.requiresInspection` from the closed bead's plan item; if `true`, run `pan inspect <issueId> --bead <beadId>` and wait; if `false`, skip and move to the next bead.
2. **Planning prompt** (`src/lib/cloister/prompts/planning.md` § "Inspection Requirement") — gives the planning agent the criteria for setting the flag, and requires the field to be set explicitly on every plan item.
3. **vBRIEF schema** — `metadata.requiresInspection: boolean` is a Panopticon extension on every plan item, alongside `metadata.difficulty` and `metadata.issueLabel`.

The flag is set once at planning time and read by the work agent at run time. There is no global override; each bead's flag is the source of truth.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Bead has `requiresInspection: false` and agent skips inspection | Expected behavior. The end-of-MR review specialist still validates the full diff against all bead descriptions. |
| Bead has `requiresInspection: true` and agent skips inspection | Detectable at review time — review specialist checks that flagged beads have inspection checkpoints. |
| Plan item is missing `requiresInspection` (legacy plan from before 2026-05-08) | Work agent treats missing field as `true` for safety; planning agents writing new plans MUST set the field explicitly. |
| Inspect specialist times out | Default to BLOCKED with timeout message. Agent can re-request. |
| Bead has no code changes (documentation only) | Inspect PASSES automatically — no diff to check |
| Agent fixes and re-requests without new commits | Diff is identical to previous inspection — inspect re-evaluates |
| Multiple beads completed before inspection requested | Diff covers all uncommitted beads — inspect evaluates the aggregate |

---

## Success Criteria

1. **Architectural violations caught early** — A MIN-796-style mistake is caught at the first bead, not after 7 beads
2. **Inspect is fast** — < 5 minutes per inspection (it's reviewing one bead's diff, not a full MR)
3. **Clear feedback** — Agent receives specific, actionable feedback when blocked
4. **No false blocks** — Inspect doesn't block correct work; its checks are aligned with the spec
5. **Pipeline integrity** — Existing review → test → merge flow is completely unaffected
