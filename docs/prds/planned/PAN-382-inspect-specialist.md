# PAN-382: Inspect Specialist — Per-Step Verification

## Summary

Introduce an **Inspect Specialist** into the Panopticon specialist pipeline. It runs after each completed unit of work (bead), verifying the implementation matches its specification and architectural constraints before the agent proceeds to the next unit.

**Jidoka principle: never pass a defect downstream.**

## Motivation

MIN-796 (Kaia Chat) demonstrated a cascading failure: the agent built `KaiaRuntime.ts` on `ChatContext` (the React state machine) instead of `ChatService.ts` (the HTTP/SSE layer) as specified in the bead description and PRD. This wrong foundation infected 7 subsequent beads (~5,800 lines). The review specialist runs on the finished MR — by then, the damage was irreversible without a full restart.

The Inspect Specialist catches this at bead 1, not bead 7.

## Pipeline Change

**Before:**
```
Agent works all beads → Review (full MR) → Test → Merge
```

**After:**
```
Agent finishes bead → Inspect (bead diff) → PASS → agent continues next bead
                                           → BLOCKED → agent fixes → re-inspect
                    ...all beads done...
                    → Review (full MR) → Test → Merge
```

The existing review → test → merge pipeline is unchanged. Inspect is a new stage that runs **during** the agent's work, not after.

---

## How It Works

### 1. Agent Triggers Inspection

After completing a bead, the agent requests inspection:

```bash
pan inspect <issueId> --bead <beadId>
```

This:
1. Captures the current HEAD commit as the inspection point
2. Computes the diff since the last passed inspection (or branch base for the first bead)
3. Reads the bead description from the beads store
4. Queues an inspect-agent task

The agent then **waits** for the inspection result before proceeding to the next bead.

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
pan work tell <issueId> "INSPECTION PASSED for bead <beadId>. Proceed to next bead."

# 3. Signal completion
curl -X POST <apiUrl>/api/specialists/done \
  -H "Content-Type: application/json" \
  -d '{"specialist":"inspect","issueId":"<issueId>","status":"passed","notes":"Bead <beadId> matches spec, no constraint violations"}'
```

**On BLOCKED:**
```bash
# 1. Send specific feedback to the agent
pan work tell <issueId> "INSPECTION BLOCKED for bead <beadId>:

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

Work agents need to know they must request inspection after each bead. This is communicated via:

1. **Workspace CLAUDE.md** — Include instruction: "After completing each bead, run `pan inspect <issueId> --bead <beadId>` and wait for the result before proceeding."
2. **Planning agent output** — The planning agent's beads should include this instruction in the workflow notes.
3. **Bead descriptions** — Each bead can include a reminder: "Request inspection after completion."

The agent's skill/instructions are updated to include the inspect step in the standard workflow.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Agent skips inspection and moves to next bead | Detectable at review time — review specialist checks that all beads have inspection checkpoints |
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
