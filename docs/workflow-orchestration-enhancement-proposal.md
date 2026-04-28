# Workflow Orchestration Enhancement Proposal

**Author:** Edward Becker (eltmon)
**Date:** 2026-04-28
**Based on:** [workflow-orchestration-landscape.md](./workflow-orchestration-landscape.md)
**Status:** Draft

---

## 1. Overview

This proposal specifies the concrete changes to implement four high-value patterns identified in the landscape survey:

1. **Ralph Wiggum Self-Assessment Loop** — Work agents self-verify before signaling completion
2. **Two-Stage Inspect Gate** — Spec compliance checked before code quality
3. **Principles Pre-PRD Phase** — Governing rules established before planning
4. **Verification Ladder Integration** — Map specialists to 4-tier verification model

These changes reduce review cycles, improve spec fidelity, prevent scope creep, and make the specialist pipeline more rigorous.

---

## 2. Ralph Wiggum Self-Assessment Loop

### 2.1 What It Is

Before signaling `pan done`, the work agent internally runs a quality self-assessment. If any check fails, the agent fixes it internally without involving specialists. The user never sees broken code.

### 2.2 Implementation

**Location:** `src/lib/work-agent/self-assessment.ts` (new file) + prompt updates in `src/lib/cloister/prompts/work.md`

**The self-assessment checklist:**

```typescript
interface SelfAssessment {
  passed: boolean;
  iterations: number;
  checks: AssessmentCheck[];
}

interface AssessmentCheck {
  name: string;
  passed: boolean;
  details?: string;
}
```

**Checks to perform:**

| # | Check | Method | Failure action |
|---|-------|--------|---------------|
| 1 | **Spec fidelity** | Diff vs bead narrative + acceptance criteria | Fix to match spec |
| 2 | **No stubs** | Scan for `TODO`, `FIXME`, `unimplemented`, `return null`, `pass`, `panic("not implemented")` | Remove stubs |
| 3 | **Tests exist** | Match test files to changed source files | Write missing tests |
| 4 | **Tests pass** | Run test suite | Fix failing tests |
| 5 | **Lint clean** | Run linter | Fix lint errors |
| 6 | **Type check** | Run tsc/mypy | Fix type errors |
| 7 | **Formatting** | Run formatter | Auto-format |
| 8 | **No debug code** | Scan for `console.log`, `print`, `debugger` | Remove |
| 9 | **Coverage ≥ threshold** | Run coverage, compare to project minimum | Add/improve tests |

**Flow:**

```
Work agent completes bead
       │
       ▼
Ralph self-assessment (internal)
       │
       ├── Any check fails?
       │     │
       │     ├── YES → Fix internally
       │     │         └── Re-run self-assessment
       │     │              (iteration += 1)
       │     │              (max 3 iterations)
       │     │              │
       │     │              ├── Still failing after 3 → escalate to user
       │     │              └── All pass → continue
       │     │
       │     └── NO → Signal pan done
```

**Prompt addition to work.md:**

```
## Ralph Wiggum Self-Assessment

Before signaling completion (pan done), you MUST run the self-assessment checklist:

1. Verify your diff matches the bead narrative and acceptance criteria
2. Scan for stubs: TODO, FIXME, unimplemented, return null, pass, panic
3. Verify test files exist for all changed source files
4. Run tests — all must pass
5. Run lint — must be clean
6. Run type check — must pass
7. Run formatter — apply if needed
8. Scan for debug code (console.log, print, debugger) — remove if found
9. Check test coverage meets project minimum

If ANY check fails:
- Fix the issue yourself
- Re-run the checklist
- Maximum 3 internal iterations
- After 3 failed iterations: present the issue to the user and ask for guidance

You MUST NOT signal pan done until all checks pass.
```

**Max iterations:** 3 (configurable in `projects.yaml`)

**Config in projects.yaml:**

```yaml
projects:
  panopticon-cli:
    # ...
    ralph_loop:
      enabled: true
      max_iterations: 3
      checks:
        - stub_detection
        - test_existence
        - test_passing
        - lint_clean
        - type_check
        - formatter
        - no_debug_code
        - coverage
```

**Side effects:**

- Agents will take slightly longer per bead (self-assessment adds 1–3 min)
- Review cycles will shorten significantly (far fewer fix requests)
- Quality baseline will rise

---

## 3. Two-Stage Inspect Gate

### 3.1 What It Is

The current inspect-agent checks spec fidelity AND constraint compliance in one pass. This proposal splits it into two sequential stages:

1. **Stage 1 — Spec Compliance** — Does the diff implement what the bead described?
2. **Stage 2 — Quality** — Does the code meet CLAUDE.md standards?

Stage 2 only runs if Stage 1 passes. This prevents spending quality review effort on code that doesn't implement the right thing.

### 3.2 Current State

Currently in `SPECIALIST_WORKFLOW.md`:

```
Agent finishes bead
       │
       ▼
  inspect-agent
  ├── Spec fidelity check
  ├── Constraint compliance
  └── Compile + smoke
       │
       ├── BLOCKED → Agent fixes
       └── PASS → continue
```

### 3.3 Proposed State

```
Agent finishes bead
       │
       ▼
  inspect-agent: Stage 1 (Spec Compliance)
  ├── Diff vs bead narrative
  ├── Diff vs acceptance criteria
  └── SubItems completion check
       │
       ├── BLOCKED → Agent fixes, re-request Stage 1
       │
       ▼ (only if Stage 1 passed)
  inspect-agent: Stage 2 (Quality)
  ├── CLAUDE.md compliance
  ├── Security scan
  ├── Performance scan
  └── Compile + smoke
       │
       ├── BLOCKED → Agent fixes, re-request Stage 2
       └── PASS → continue to next bead
```

### 3.4 Implementation

**Location:** `src/lib/cloister/specialists/inspect-agent/stages.ts` (new), or refactor existing `inspect-agent.ts`

**New types:**

```typescript
interface InspectStage1Result {
  stage: 'spec_compliance';
  passed: boolean;
  issues: SpecComplianceIssue[];
}

interface InspectStage2Result {
  stage: 'quality';
  passed: boolean;
  issues: QualityIssue[];
  skipped: boolean; // true if Stage 1 didn't pass
}

interface SpecComplianceIssue {
  type: 'narrative_mismatch' | 'missing_acceptance_criterion' | 'extra_implementation';
  description: string;
  diff_excerpt?: string;
}

interface QualityIssue {
  type: 'security' | 'performance' | 'style' | 'compile';
  description: string;
  location: string;
  severity: 'critical' | 'major' | 'minor';
}
```

**Changes to inspect-agent:**

1. Split `inspect()` function into `stage1SpecCompliance()` and `stage2Quality()`
2. Stage 2 only runs if Stage 1 returned `passed: true`
3. Each stage writes to `~/.panopticon/specialists/<project>/inspect-agent/stages/<issue>.json`
4. Stage status shown in dashboard UI

**Dashboard UI changes:**

In the workspace inspector, show two-stage status:

```
Inspect: [✓ Stage 1: Spec Compliance] [○ Stage 2: Quality]
```

If Stage 1 fails, Stage 2 shows as "Not reached".

**CLI changes:**

```bash
pan inspect <issueId> --bead <beadId>          # Runs both stages
pan inspect <issueId> --bead <beadId> --stage 1  # Run Stage 1 only
pan inspect <issueId> --bead <beadId> --stage 2  # Run Stage 2 only
```

**Prompt changes:**

The inspect-agent prompt template (`inspect-agent.md`) is split into two sections:

```
## Stage 1: Spec Compliance

Check ONLY whether the diff implements the bead narrative and acceptance criteria.
Do NOT check code quality, style, or security.
...
## Stage 2: Quality

Stage 2 runs ONLY if Stage 1 passed.
Check code quality, CLAUDE.md compliance, security, and performance.
...
```

---

## 4. Principles Pre-PRD Phase

### 4.1 What It Is

Before the planning agent writes a vBRIEF plan, establish 3–5 governing principles for the issue. These define what the implementation WILL and WILL NOT do, preventing scope creep.

### 4.2 Implementation

**New prompt template:** `src/lib/cloister/prompts/principles.md` (new)

**Trigger:** Runs before `planning.md` when a new issue is being planned.

**Output:** `.planning/principles.md`

```
# Principles: <issue-id>

**Principles (MUST):**
1. [Principle 1]
2. [Principle 2]
3. [Principle 3]

**Anti-Principles (MUST NOT):**
1. [What this will NOT do]
2. [What this will NOT use]
3. [What this will NOT compromise]

**Principles established by:** <author>
**Date:** <timestamp>
```

**Planning agent flow:**

```
User runs: pan plan <issue-id>
       │
       ▼
  Phase 0: Principles
  ├── Check if .planning/principles.md exists
  │     ├── EXISTS → read and apply
  │     └── NOT EXISTS → prompt user to define principles
  │                    (or auto-generate from PRD if available)
  │
  ▼
  Phase 1: Planning (existing)
  └── Read PRD + principles → generate vBRIEF plan
```

**When principles are auto-generated:**

If the user skips explicit principles definition, the planning agent extracts them from the PRD:

```typescript
function extractPrinciplesFromPRD(prdContent: string): Principles {
  // Look for:
  // - "will" statements → positive principles
  // - "will not" / "must not" statements → anti-principles
  // - Constraint statements in PRD
  // - Explicit scope statements
}
```

**Config in projects.yaml:**

```yaml
projects:
  panopticon-cli:
    # ...
    planning:
      require_principles: false  # true = block planning without principles
      auto_extract_principles: true  # extract from PRD if not defined
```

**Dashboard UI:**

In the planning dialog, show a "Principles" step before the vBRIEF plan:

```
[1. Principles] → [2. Discovery] → [3. vBRIEF Plan] → [4. Beads]
     ↑
     New step
```

---

## 5. Verification Ladder Integration

### 5.1 What It Is

Map Panopticon's existing specialist stages to Deft's 4-tier verification model:

| Tier | Type | Panopticon Specialist | What it verifies |
|------|------|----------------------|------------------|
| 1 | Static | **inspect-agent** | Files exist, exports present, imports wired, no stubs |
| 2 | Command | **test-agent** | Tests pass, build succeeds, lint clean |
| 3 | Behavioral | **uat-agent** | Browser flows work, API responses correct, CORS enforced |
| 4 | Human | **merge-agent** + human | Final review, merge decision |

### 5.2 Changes per Stage

**Tier 1 — inspect-agent:**

Explicitly add to the prompt:

```
## Tier 1 Verification (Static)

You are performing Tier 1 verification ONLY.
Check:
- Files exist at specified paths
- Files have minimum substance (not empty stubs)
- Required exports are present
- Required imports are wired
- No TODO/FIXME/HACK/XXX placeholders
- No return null/return {} placeholders

You MUST NOT check:
- Code style or formatting
- Test coverage
- Security (that's Tier 3)
- Performance (that's Tier 3)
```

**Tier 2 — test-agent:**

Explicitly add to the prompt:

```
## Tier 2 Verification (Command)

You are performing Tier 2 verification ONLY.
Run:
- Full test suite
- Build for all targets
- Linter

You MUST report:
- Tests run / passed / failed
- Build success / failure
- Lint errors

You MUST attempt fixes for:
- Simple failures (< 5 min)
- Flaky tests (retry once, report if still failing)

You MUST NOT:
- Restructure architecture
- Add major features
- Fix complex test failures (report only)
```

**Tier 3 — uat-agent:**

Explicitly add to the prompt:

```
## Tier 3 Verification (Behavioral)

You are performing Tier 3 verification ONLY.
Verify in a real browser:
- CORS works (not just API direct calls)
- Visual quality (desktop, tablet, mobile viewports)
- Auth flow (real login, not test-token bypass)
- Console errors absent
- Network errors absent

You MUST NOT:
- Check code quality (that's Tier 1)
- Run unit tests (that's Tier 2)
```

**Tier 4 — Human + merge-agent:**

```
## Tier 4 Verification (Human)

Human reviews:
- Does the change make sense architecturally?
- Are there better approaches?
- Is the scope appropriate?
- Should this be merged?

merge-agent provides:
- Conflict resolution
- Final build verification
- Push to remote
```

### 5.3 Ladder Enforcement in Pipeline

**Current state:** Any specialist can pass/fail independently.

**Proposed state:** Tier N cannot pass if Tier N-1 hasn't been run or failed.

```
pan done
  │
  ▼
inspect-agent (Tier 1)
  │
  ├── FAIL → blocked, agent fixes
  └── PASS
        │
        ▼
  review-agent (Tier 1-2 overlap)
        │
        ├── FAIL → blocked, agent fixes
        └── PASS
              │
              ▼
        test-agent (Tier 2)
              │
              ├── FAIL → blocked, agent fixes
              └── PASS
                    │
                    ▼
              uat-agent (Tier 3)
                    │
                    ├── FAIL → blocked, agent fixes
                    └── PASS
                          │
                          ▼
                    merge-agent (Tier 4)
```

**Config in projects.yaml:**

```yaml
projects:
  panopticon-cli:
    # ...
    verification_ladder:
      enabled: true
      enforce_tier_order: true  # Tier N can't pass if Tier N-1 failed
      tier_labels: true  # Show tier labels in dashboard UI
```

---

## 6. Implementation Phases

### Phase 1: Ralph Loop + Two-Stage Inspect (Priority: High)

**Files to create:**
- `src/lib/work-agent/self-assessment.ts`
- `src/lib/cloister/specialists/inspect-agent/stages.ts`

**Files to modify:**
- `src/lib/cloister/prompts/work.md` — add Ralph loop section
- `src/lib/cloister/prompts/inspect-agent.md` — split into two stages
- `src/dashboard/server/services/inspect-service.ts` — stage 1 / stage 2 routing
- `src/dashboard/frontend/src/components/inspect-panel/` — two-stage UI

**Steps:**
1. Add `self-assessment.ts` with checklist logic
2. Add Ralph loop section to `work.md` prompt
3. Split `inspect-agent.md` into stage1/stage2 sections
4. Add stage routing in inspect-service
5. Add two-stage status to dashboard UI
6. Test with a real issue (e.g., a new PAN issue)

**Testing:**
- Create a test issue with intentional stub code
- Verify agent self-corrects without specialist involvement
- Verify two-stage status shows correctly in dashboard

---

### Phase 2: Principles Pre-PRD (Priority: Medium)

**Files to create:**
- `src/lib/cloister/prompts/principles.md`
- `src/lib/planning/principles-extractor.ts`

**Files to modify:**
- `src/lib/cloister/prompts/planning.md` — add principles phase
- `src/dashboard/frontend/src/components/plan-dialog/` — add principles step
- `projects.yaml` — add `planning.require_principles` config

**Steps:**
1. Create `principles.md` prompt template
2. Add `principles-extractor.ts` for auto-extraction from PRD
3. Add phase to planning flow in `planning.md`
4. Add "Principles" step to planning dialog UI
5. Add config option to projects.yaml
6. Test with a real issue

**Testing:**
- Run `pan plan <issue>` with no existing principles
- Verify principles prompt appears
- Or verify auto-extraction from PRD

---

### Phase 3: Verification Ladder (Priority: Medium)

**Files to modify:**
- `src/lib/cloister/prompts/inspect-agent.md` — add tier labels
- `src/lib/cloister/prompts/test.md` — add tier labels
- `src/lib/cloister/prompts/uat.md` — add tier labels
- `src/lib/cloister/prompts/merge.md` — add tier labels
- `src/dashboard/frontend/src/components/specialist-status/` — show tier labels
- `projects.yaml` — add `verification_ladder` config

**Steps:**
1. Update all specialist prompts with tier labels and scope
2. Add tier status indicators to dashboard
3. Add `enforce_tier_order` logic to pipeline (optional — can start as informational only)
4. Update CLAUDE.md to document the ladder

**Testing:**
- Run a full specialist pipeline
- Verify each stage shows correct tier label
- Verify dashboard displays tier information

---

## 7. Success Metrics

After implementation, track:

| Metric | Before | After (Target) |
|--------|--------|---------------|
| Review cycles per issue | ~2.5 | ~1.5 |
| Agent self-correction rate | N/A (not tracked) | > 50% of issues self-correct before specialist |
| Stage 1 (spec compliance) failure rate | Mixed with quality | Trackable separately |
| Principles defined per issue | 0 | > 80% |
| Tier label accuracy | N/A | 100% |

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Ralph loop adds latency to each bead | Medium | Low (1-3 min/bead) | Limit max iterations; only run on bead close |
| Two-stage inspect adds pipeline complexity | Low | Medium | Stages run sequentially; both are fast |
| Principles phase adds planning friction | Medium | Low | Auto-extraction from PRD; skip option |
| Verification ladder changes existing behavior | Low | High | Add as opt-in config; off by default initially |

---

## 9. Open Questions

1. Should the Ralph loop run on EVERY bead close, or only on `pan done`?
2. Should Stage 1 (spec compliance) failures increment the circuit breaker counter?
3. Should principles be required before planning, or optional with auto-extraction?
4. Should verification ladder enforcement be opt-in or the default?
5. How should we track Ralph loop effectiveness — add a metric for self-corrections before specialist involvement?
