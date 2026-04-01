# PAN-404: Simplify Planning Pipeline

## Status: Plan Approved

## Decision Log

### D1: Service URLs after WORKSPACE.md removal
**Decision:** Move service URL section to STATE.md. Dashboard reads from STATE.md instead.
**Rationale:** Minimal change, keeps data accessible without a new file format.

### D2: PRD draft promotion flow
**Decision:** Remove `promotePRDDraft()` entirely. Human-written PRDs stay in `docs/prds/` — no need to copy into `.planning/`.
**Rationale:** The draft→workspace promotion was tied to agent-generated PRDs. With vBRIEF as the plan format, there's no `.planning/PRD.md` to promote into.

### D3: Dashboard Settings UI for removed agents
**Decision:** Remove model override cards entirely for prd-agent, triage-agent, decomposition-agent.
**Rationale:** Clean break — agents are gone, settings should be too.

### D4: Shadow mode documentation
**Decision:** Include in this issue. Document shadow mode under legacy codebase support in docs.

### D5: triage-agent — keep analyzeIssue()
**Decision:** Keep the `analyzeIssue()` utility function from triage-agent.ts (rule-based heuristics). Remove only the agent spawn path. Move the function to `plan-utils.ts` or keep in a renamed file.

### D6: FEATURE-CONTEXT.md
**Decision:** No action needed — it was never implemented. Only existed as a concept in the issue description.

## Architecture

### What's Being Removed

| Component | Files | Reason |
|---|---|---|
| PRD agent | `src/lib/planning/prd-agent.ts` | Human PRDs are input; vBRIEF is output |
| Triage agent (spawn) | `src/lib/planning/triage-agent.ts` (spawn only) | Rule-based heuristics don't need an agent |
| Decomposition agent | `src/lib/planning/decomposition-agent.ts` | `createBeadsFromVBrief()` replaces this |
| `.planning/PRD.md` | Dashboard reads, UAT agent, prd-draft.ts | vBRIEF + STATE.md replace it |
| `.planning/WORKSPACE.md` | plan-utils.ts generation, dashboard reads | Work-agent prompt template handles this |
| `runPreWorkflow()` | `src/lib/planning/index.ts` | Dead code — never called |
| `createBeadsTasks()` | `src/lib/planning/plan-utils.ts` | Replaced by `createBeadsFromVBrief()` |
| Agent registrations | work-types.ts, settings-api.ts, smart-model-selector.ts | No agents to configure |
| Dashboard agent cards | 4 Settings UI components | No agents to configure |

### What Stays

| Component | Purpose |
|---|---|
| `plan.vbrief.json` | Structured plan (source of truth) |
| `STATE.md` | Operational state, decisions log, service URLs |
| `docs/prds/*.md` | Human-written requirements (input to planning) |
| Planning agent | One agent: read PRD + codebase → produce vBRIEF |
| `analyzeIssue()` | Rule-based triage heuristics (kept as utility) |

### Key Touch Points

**Dashboard server (index.ts) — PRD.md references to update:**
- Line ~14219: Read PRD.md into `result.prd` → remove, `result.state` already populated
- Line ~14301: Read PRD.md for AI context → use STATE.md only
- Line ~14904: `hasPrd` flag → redefine using PLANNING_PROMPT.md or STATE.md
- Line ~14936: State label "Planning" → adjust condition
- Line ~14943: Title extraction from PRD.md → already has PLANNING_PROMPT.md fallback
- Line ~5463: WORKSPACE.md service URL read → read from STATE.md
- Line ~8585: `promotePRDToWorkspace()` call → remove
- Line ~8708: `git add WORKSPACE.md` → remove

**UAT agent:**
- Line ~45: Remove PRD.md from searchPaths, STATE.md is already second entry

**Lifecycle:**
- `clean-planning.ts`: Add WORKSPACE.md to EPHEMERAL_PLANNING_FILES
- `close-out.ts`: Remove PRD.md archive step (or leave — harmless if file doesn't exist)
