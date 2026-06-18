# Overdeck Job Agent Types Audit Report
**Date:** 2026-04-13  
**Scope:** Complete inventory of all agent types, their usage, spawning locations, prompt configuration, and model selection

---

## Executive Summary

Overdeck has **7 active agent types** across two categories:
- **Primary agents:** work-agent, planning-agent
- **Specialist agents:** review-agent, test-agent, merge-agent, inspect-agent, uat-agent

**Critical findings:**
1. ✅ **All 7 agents ARE actively used** in the workflow
2. ❌ **Two agents (inspect-agent, uat-agent) have missing prompt handlers** in buildTaskPrompt()
3. ❌ **uat-agent.md prompt template does NOT exist** (only inspect-agent.md exists)
4. ❌ **inspect-agent and uat-agent are NOT in SpecialistsConfig** for model selection (hardcoded in modelDefaults.ts instead)
5. ✅ **Model selection uses config-driven approach** (modelDefaults.ts) — no hardcoded models in spawn logic
6. ✅ **Documentation and code are mostly aligned** but need correlation improvements

---

## Agent Type Inventory

### PRIMARY AGENTS

#### 1. **work-agent**
- **Type:** Primary implementation agent
- **Status:** ✅ ACTIVE & FULLY CONFIGURED
- **Default Model:** `claude-sonnet-4-6` (routed via work-type-router based on phase)
- **Model Selection:** `determineModel()` in agents.ts uses work-type-router
- **Spawning:**
  - Entry point: CLI `pan start <ID> [--phase <phase>]` or Dashboard POST `/api/agents`
  - Location: `src/dashboard/server/services/agent-spawner.ts` line 127 (`startWork()`)
  - With explicit agentType option in StartWorkOptions
- **Lifecycle:** Long-running, resumable (--resume), manual start/stop
- **Phases:** exploration | implementation | testing | documentation | review-response
- **Prompt:** Via `work.md` + phase-specific instructions embedded in work.ts

#### 2. **planning-agent**
- **Type:** Primary planning agent
- **Status:** ✅ ACTIVE & FULLY CONFIGURED
- **Default Model:** `claude-opus-4-6`
- **Model Selection:** Via work-type-router as `planning-agent` WorkTypeId
- **Spawning:**
  - Entry point: CLI `pan plan <ID>` or Dashboard POST `/api/issues/:id/start-planning`
  - Location: `src/lib/planning/spawn-planning-session.ts` line ~100+
  - Function: `spawnPlanningSession()`
- **Lifecycle:** Long-running, user-initiated, user stops when ready (via "Start Agent" button)
- **Prompt:** Via `planning.md` rendered in spawn-planning-session.ts
- **Prerequisites:** None (creates .planning directory on first run)

---

### SPECIALIST AGENTS (Ephemeral, Queue-Based)

All specialists are spawned via `spawnEphemeralSpecialist()` in `src/lib/cloister/specialists.ts` line 617.

#### 3. **review-agent**
- **Type:** Specialist (code review)
- **Status:** ✅ ACTIVE & FULLY CONFIGURED
- **Default Model:** `claude-sonnet-4-6` (can be overridden via cloister.yaml)
- **Model Selection:** ✅ CONFIGURABLE in `SpecialistsConfig.specialist_models.review_agent`
- **Spawning:**
  - Auto-triggered by Cloister handoff gate after all beads complete
  - Location: `src/lib/cloister/handoff.ts` line ~260 (`performHandoff()`)
  - Triggered by: work-agent signals `.planning-complete` marker
- **Prompt Handler:** ✅ Dedicated case in buildTaskPrompt() lines 990-1021 (uses review.md)
- **Lifecycle:** Ephemeral, fresh session per dispatch (no --resume)
- **Purpose:** Full MR code review, security checks, test coverage analysis

#### 4. **test-agent**
- **Type:** Specialist (test execution)
- **Status:** ✅ ACTIVE & FULLY CONFIGURED
- **Default Model:** `claude-haiku-4-5` (can be overridden via cloister.yaml)
- **Model Selection:** ✅ CONFIGURABLE in `SpecialistsConfig.specialist_models.test_agent`
- **Spawning:**
  - Auto-triggered after review-agent approval
  - Queued by: Verification runner in src/lib/cloister/verification-runner.ts
  - Triggered by: review-agent signals 'passed' status
- **Prompt Handler:** ✅ Dedicated case in buildTaskPrompt() lines 1024-1028 (uses test.md + buildTestAgentPromptContent)
- **Lifecycle:** Ephemeral, fresh session per dispatch
- **Purpose:** Execute test suite, analyze failures, provide feedback

#### 5. **merge-agent**
- **Type:** Specialist (merge operations)
- **Status:** ✅ ACTIVE & FULLY CONFIGURED
- **Default Model:** `claude-sonnet-4-6` (can be overridden via cloister.yaml)
- **Model Selection:** ✅ CONFIGURABLE in `SpecialistsConfig.specialist_models.merge_agent`
- **Spawning:**
  - Auto-triggered after all specialists (review, test, uat) approve
  - Location: `src/lib/cloister/handoff.ts` line ~310 (final gate)
  - Triggered by: UAT passes or test-agent passes (if no UAT configured)
- **Prompt Handler:** ✅ Dedicated case in buildTaskPrompt() lines 1031-1050 (uses merge.md)
- **Lifecycle:** Ephemeral, fresh session per dispatch
- **Special:** Uses `--dangerously-skip-permissions --permission-mode bypassPermissions` (line 753)
- **Purpose:** Merge conflict resolution, CI validation, branch push

#### 6. **inspect-agent** ⚠️ PARTIAL CONFIGURATION
- **Type:** Specialist (per-bead verification)
- **Status:** ⚠️ ACTIVE BUT MISSING PROMPT HANDLER
- **Default Model:** `claude-sonnet-4-6` (hardcoded in modelDefaults.ts line 14)
- **Model Selection:** ❌ NOT in SpecialistsConfig (only in modelDefaults.ts as 'specialist-inspect-agent')
- **Spawning:**
  - Manual trigger: CLI `pan inspect <issueId> --bead <beadId>`
  - Location: `src/lib/cloister/inspect-agent.ts` line ~200+ (requestInspection())
  - Or via: `src/lib/cloister/service.ts` line ~1101 (specialist dispatch)
- **Prompt Handler:** ❌ **MISSING from buildTaskPrompt() switch statement** (lines 989-1052)
  - inspect-agent.md prompt template EXISTS but is NOT called by buildTaskPrompt()
  - Currently falls through to generic message at line 1054
- **Prompt File:** ✅ `src/lib/cloister/prompts/inspect-agent.md` exists with full content
- **Lifecycle:** Ephemeral, per-bead during implementation
- **Purpose:** Spec fidelity check, constraint compliance, compile/smoke test
- **Documentation:** ✅ Fully documented in SPECIALIST_WORKFLOW.md lines 79-124

#### 7. **uat-agent** ⚠️ CRITICAL GAPS
- **Type:** Specialist (user acceptance testing)
- **Status:** ⚠️ ACTIVE BUT SEVERELY UNDER-CONFIGURED
- **Default Model:** `claude-sonnet-4-6` (hardcoded in modelDefaults.ts line 15)
- **Model Selection:** ❌ NOT in SpecialistsConfig (only in modelDefaults.ts as 'specialist-uat-agent')
- **Spawning:**
  - Auto-triggered after test-agent passes
  - Location: Triggered via trigger system in handoff.ts (line ~300+)
  - Called from: test-agent completion checkpoint
- **Prompt Handler:** ❌ **MISSING ENTIRELY from buildTaskPrompt() switch statement**
  - Currently receives ONLY generic message at line 1054: "When you complete your task, report your findings and status."
  - NO uat-agent-specific instructions whatsoever
- **Prompt File:** ❌ **DOES NOT EXIST** — only inspect-agent.md exists, no uat-agent.md
- **Lifecycle:** Ephemeral, after test phase
- **Purpose:** Real browser E2E verification, CORS validation, visual quality, console audit
- **Documentation:** ✅ Documented in SPECIALIST_WORKFLOW.md lines 126-159 BUT prompt is missing

---

## Model Selection Audit

### Configuration Hierarchy (Correct Order)

1. **Explicit override** (command-line flag `--model <name>`)
2. **Work-type router config** (`config.yaml` overrides per work-type)
3. **Project-specific config** (projects.yaml: specialist_model override)
4. **Specialist config** (cloister.yaml: specialist_models section)
5. **Frontend defaults** (modelDefaults.ts: DEFAULT_MODELS_BY_WORK_TYPE)

### Current Implementation

✅ **Work agents:** Fully routed via work-type-router.ts (determineModel function)

✅ **Review/Test/Merge specialists:** Configurable in SpecialistsConfig.specialist_models, with fallback to modelDefaults.ts

❌ **Inspect-agent:** Only in modelDefaults.ts, NOT in SpecialistsConfig → **cannot be configured per-project**

❌ **UAT-agent:** Only in modelDefaults.ts, NOT in SpecialistsConfig → **cannot be configured per-project**

### No Hardcoded Models in Spawn Logic

✅ **Verified:** All specialist spawning uses getModelId(workTypeId) or lookups from modelDefaults.ts  
✅ **No `--model claude-opus-4-6` hardcoded anywhere in spawn paths**  
✅ **Exception:** modelDefaults.ts itself contains static defaults, but these are configuration, not hardcoded logic

---

## Documentation Audit

### What Exists ✅
- **SPECIALIST_WORKFLOW.md** — Complete pipeline with diagrams (lines 1-300+)
  - Covers all 5 specialists with timing and triggers
  - Per-specialist sections with purpose and checklist
  - Clear pipeline diagrams

### What's Incomplete ❌
- **Model selection documentation** not correlated with where models are actually selected
  - modelDefaults.ts exists but is "invisible" to users
  - No doc explaining work-type-router + fallback chain
  
- **Prompt template documentation** missing
  - No doc listing which prompt files correspond to which agents
  - inspect-agent.md exists but missing from handoff.ts buildTaskPrompt()
  - uat-agent.md doesn't exist at all
  
- **Agent spawning locations** scattered across multiple files
  - Users don't know where to look to understand "when is specialist X spawned?"
  - Handoff.ts, verify-gate.ts, checkpoint-trigger.ts all involved but not documented together

---

## Issues Found (Ranked by Severity)

### CRITICAL 🔴

**Issue C1: uat-agent has no prompt handler AND no prompt template**
- Location: buildTaskPrompt() line 989-1052 (missing uat-agent case)
- Impact: UAT agent receives only generic fallback message, no instructions for browser testing, Playwright setup, or requirement verification
- Root cause: UAT agent was added to SpecialistType enum but prompt handler was never implemented
- Fix: Create src/lib/cloister/prompts/uat-agent.md + add case in buildTaskPrompt()

---

### MAJOR 🟠

**Issue M1: inspect-agent prompt handler missing from buildTaskPrompt()**
- Location: buildTaskPrompt() switch statement (line 989-1052)
- Impact: inspect-agent.md template exists but is never called; agent gets generic message instead of detailed verification checklist
- Root cause: Prompt handler was never wired up when specialists were refactored into ephemeral dispatches
- Fix: Add case for 'inspect-agent' in buildTaskPrompt() that calls renderPrompt({name: 'inspect-agent', ...})

**Issue M2: inspect-agent and uat-agent missing from SpecialistsConfig model selection**
- Location: src/lib/cloister/config.ts lines 76-99
- Impact: Cannot configure these agent models via cloister.yaml like other specialists; must hardcode if override needed
- Root cause: Config schema was designed for original 3 specialists, not extended when inspect/uat were added
- Fix: Add to SpecialistsConfig interface:
  ```typescript
  inspect_agent?: SpecialistConfig;
  uat_agent?: SpecialistConfig;
  ```

**Issue M3: Agent type lists are inconsistent**
- StartWorkOptions (agent-spawner.ts:25) only lists: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent'
- SpecialistType (specialists.ts:121) lists: 'merge-agent' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent'
- Impact: User-facing types vs internal specialist types don't match; confusing API surface
- Root cause: agent-spawner.ts only handles work agents that can be started from dashboard, not specialists
- Note: This may be intentional (specialists are auto-dispatched), but should be documented

---

### MINOR 🟡

**Issue N1: Model selection strategy not documented**
- Location: docs/
- Impact: Users/developers don't understand the precedence chain for model selection
- Fix: Create docs/MODEL_ROUTING.md explaining work-type-router + modelDefaults.ts fallback

**Issue N2: No correlation docs between agent types and their prompts**
- Location: docs/
- Impact: When adding a new agent type, it's unclear which files need to be modified
- Fix: Create docs/AGENT_TYPES_INDEX.md with table: Agent | Prompt | Spawn Location | Config Key

---

## Workflow Spawning Map

### Visual Spawning Sequence

```
User starts issue
  ↓
[planning-agent spawned]
  ├─ reads: PLANNING_PROMPT.md
  ├─ writes: .planning/STATE.md, .planning/plan.vbrief.json
  ├─ creates: beads via bd create
  └─ user clicks "Start Agent" → [planning-agent stopped]

[work-agent spawned]
  ├─ reads: .planning/STATE.md, PLANNING_PROMPT.md.archived (reference)
  ├─ during beads: [per-bead] → pan inspect → [inspect-agent spawned]
  ├─ after all beads: writes .planning-complete marker
  └─ cloister detects completion marker

[Verification Gate triggered]
  ├─ [review-agent spawned] (full MR review)
  │  ├─ reads: review.md prompt
  │  ├─ result: APPROVED | CHANGES_REQUESTED
  │  └─ if approved → continue
  │
  ├─ [test-agent spawned] (test suite)
  │  ├─ reads: test.md prompt
  │  ├─ result: PASSED | FAILED
  │  └─ if passed → continue
  │
  ├─ [uat-agent spawned] (browser testing) ⚠️ MISSING PROMPT
  │  ├─ reads: ??? (uat-agent.md DOESN'T EXIST)
  │  ├─ result: PASSED | BLOCKED
  │  └─ if passed → continue
  │
  └─ [merge-agent spawned] (final push)
     ├─ reads: merge.md prompt
     ├─ resolves conflicts
     ├─ pushes to main
     └─ post-merge cleanup (Docker, branches)
```

### Spawning Locations Reference Table

| Agent | Type | Trigger | Location | Function | Default Model |
|-------|------|---------|----------|----------|---|
| work-agent | Primary | Manual (CLI/Dashboard) | agent-spawner.ts | startWork() line 127 | sonnet (routed) |
| planning-agent | Primary | Manual (CLI/Dashboard) | spawn-planning-session.ts | spawnPlanningSession() ~100+ | opus |
| review-agent | Specialist | Auto (bead completion) | handoff.ts | performHandoff() ~260 | sonnet |
| test-agent | Specialist | Auto (review approved) | verification-runner.ts | via queue | haiku |
| uat-agent | Specialist | Auto (tests passed) | handoff.ts | via checkpoint ~300+ | sonnet ⚠️ |
| merge-agent | Specialist | Auto (UAT passed) | handoff.ts | final gate ~310 | sonnet |
| inspect-agent | Specialist | Manual (CLI) | inspect-agent.ts | requestInspection() ~200+ | sonnet ⚠️ |

---

## Configuration Files Involved

### Type Definitions
- **Agent type enums:** specialists.ts:121 (SpecialistType)
- **Agent type options:** agent-spawner.ts:25 (StartWorkOptions)
- **Model mapping defaults:** modelDefaults.ts lines 5-28
- **Config schema:** config.ts lines 61-99 (SpecialistsConfig)

### Prompt Files
- ✅ planning.md
- ✅ work.md
- ✅ review.md
- ✅ test.md
- ✅ merge.md
- ✅ inspect-agent.md
- ❌ uat-agent.md (MISSING)
- ✅ resume-work.md
- ✅ handoff-to-work.md
- ✅ identity-wake.md
- ❌ sync-main.md (specialist context, not primary prompt)

### Model Selection Code
- **Work-type router:** work-type-router.ts (getModelId function)
- **Agent spawning:** agents.ts:537-586 (determineModel)
- **Specialist spawning:** specialists.ts:722-729 (model lookup)
- **Frontend defaults:** modelDefaults.ts
- **User config:** config.yaml (overrides)
- **Project config:** projects.yaml (specialist_model per project)
- **Workspace config:** .planning/cloister.yaml (specialist_models)

---

## Action Items (Prioritized)

### IMMEDIATE (Blocks Correct Functionality)

1. **Create uat-agent.md prompt template**
   - File: src/lib/cloister/prompts/uat-agent.md
   - Content: Instructions for browser testing, Playwright setup, CORS verification, visual quality audit, requirement check, console audit
   - Based on: SPECIALIST_WORKFLOW.md lines 126-159 + PAN-383 PRD
   - Task time: ~1-2 hours

2. **Add uat-agent case to buildTaskPrompt()**
   - File: src/lib/cloister/specialists.ts line 989 (switch statement)
   - Add case for 'uat-agent' that calls renderPrompt({name: 'uat-agent', ...})
   - Include: workspace path, frontend URL, API URL, test token fetch command
   - Task time: ~30 minutes

3. **Add inspect-agent case to buildTaskPrompt()**
   - File: src/lib/cloister/specialists.ts line 989 (switch statement)
   - Add case for 'inspect-agent' that calls renderPrompt({name: 'inspect-agent', ...})
   - Include: bead description, diff base, checkpoint path, compile command detection
   - Task time: ~30 minutes

### HIGH PRIORITY (Enables Configuration)

4. **Extend SpecialistsConfig to include inspect-agent and uat-agent**
   - File: src/lib/cloister/config.ts lines 76-99
   - Add fields:
     ```typescript
     inspect_agent?: SpecialistConfig;
     uat_agent?: SpecialistConfig;
     ```
   - Update DEFAULT_CLOISTER_CONFIG to include defaults
   - Task time: ~15 minutes

5. **Update specialist model resolution to check config first**
   - File: src/lib/cloister/specialists.ts line 722-729
   - Current: hardcoded 'claude-sonnet-4-6' with fallback to getModelId
   - Should: Check SpecialistsConfig first, then modelDefaults.ts
   - Task time: ~20 minutes

### MEDIUM PRIORITY (Documentation & Discovery)

6. **Create docs/AGENT_TYPES_INDEX.md**
   - Table: Agent Name | Purpose | Prompt File | Spawn Location | Config Key | Default Model
   - For each agent, list all related files
   - Task time: ~30 minutes

7. **Update SPECIALIST_WORKFLOW.md**
   - Add "Prompt" section to each specialist explaining what instructions they receive
   - Cross-link to prompt file locations
   - Task time: ~30 minutes

8. **Create docs/MODEL_ROUTING.md**
   - Explain work-type-router + modelDefaults.ts precedence
   - Show configuration examples (config.yaml, cloister.yaml, projects.yaml)
   - Show override precedence diagram
   - Task time: ~1 hour

---

## Verification Checklist

### Code Changes
- [ ] Create uat-agent.md with full prompt content
- [ ] Add uat-agent case to buildTaskPrompt() with proper variable rendering
- [ ] Add inspect-agent case to buildTaskPrompt() with proper variable rendering
- [ ] Extend SpecialistsConfig with inspect_agent and uat_agent fields
- [ ] Update specialist model resolution to check config first
- [ ] Verify all agent types have prompts (no fallthrough to generic message)
- [ ] Run tests: `npm test` (focus on specialists, model routing)

### Documentation Updates
- [ ] Create AGENT_TYPES_INDEX.md with all agent metadata
- [ ] Update SPECIALIST_WORKFLOW.md with prompt details
- [ ] Create MODEL_ROUTING.md with full precedence chain
- [ ] Update README or main docs with pointer to these guides

### Integration Verification
- [ ] Manual test: pan plan <issue> → verify planning prompt loads
- [ ] Manual test: pan start <issue> → verify work prompt loads  
- [ ] Manual test: trigger review-agent → verify review.md loads
- [ ] Manual test: trigger test-agent → verify test.md loads
- [ ] Manual test: trigger merge-agent → verify merge.md loads
- [ ] Manual test: pan inspect <issue> --bead <bead> → verify inspect-agent.md loads ⚠️
- [ ] Manual test: trigger uat-agent → verify uat-agent.md loads (after created) ⚠️

---

## Recommendations

### Immediate
1. **DO NOT** launch any features that depend on uat-agent or inspect-agent prompts until templates are created and wired up
2. The UAT agent is currently running without proper instructions — this is a critical gap

### Short-term
1. Create AGENT_TYPES_INDEX.md as the "source of truth" for agent metadata
2. Maintain this index as a contract: whenever you add/remove an agent, update the index first
3. Index should include: agent name, purpose, prompt file, config key, default model, spawn trigger

### Long-term
1. Consider consolidating agent type definitions into a single source file instead of scattered across agent-spawner.ts, specialists.ts, and config.ts
2. Add a build-time validation that checks:
   - Every SpecialistType has a prompt file
   - Every SpecialistType has a buildTaskPrompt() case
   - Every prompt file is referenced somewhere
3. Consider adding an agent registry that can be queried at runtime

---

## Summary Table

| Agent | Status | Prompt | Config | Model | Spawning | Docs |
|-------|--------|--------|--------|-------|----------|------|
| work-agent | ✅ Active | ✅ work.md | ✅ work-type-router | ✅ Routed | ✅ CLI/Dashboard | ✅ |
| planning-agent | ✅ Active | ✅ planning.md | ✅ work-type-router | ✅ Opus | ✅ CLI/Dashboard | ✅ |
| review-agent | ✅ Active | ✅ review.md | ✅ Config | ✅ Sonnet | ✅ Auto | ✅ |
| test-agent | ✅ Active | ✅ test.md | ✅ Config | ✅ Haiku | ✅ Auto | ✅ |
| merge-agent | ✅ Active | ✅ merge.md | ✅ Config | ✅ Sonnet | ✅ Auto | ✅ |
| **inspect-agent** | ⚠️ Active | ✅ inspect-agent.md | ❌ Missing | ⚠️ Hardcoded | ✅ Manual | ✅ |
| **uat-agent** | ⚠️ Active | ❌ Missing | ❌ Missing | ⚠️ Hardcoded | ✅ Auto | ✅ |

---

## Glossary

- **Ephemeral specialist:** Fresh session per dispatch, no --resume, task-based lifecycle
- **Checkpoint:** Saved commit hash used by inspect-agent to scope diffs
- **Grace period:** Timer allowing specialist to finish task before termination
- **Handoff:** Automatic transition from work-agent to specialist pipeline via checkpoint trigger
- **Build prompt:** Dynamic rendering of prompt template with task-specific variables (Mustache templating)
- **Work-type:** Classification used for model routing (e.g., 'issue-agent:implementation', 'specialist-review-agent')
