# Workflow Orchestration Landscape

**Author:** Edward Becker (eltmon)
**Date:** 2026-04-28
**Model:** Claude 4 (Opus)
**Purpose:** Survey comparable frameworks, identify gaps in Panopticon's current approach, and propose concrete enhancements.

---

## Executive Summary

Panopticon currently implements a mature specialist pipeline (inspect → review → test → uat → merge) over vBRIEF plans, with Cloister as the watchdog and beads as the execution unit. This document surveys vBRIEF's ecosystem (Deft, Superpowers) and related frameworks (Spec Kit) to identify what Panopticon could borrow or improve upon.

**Key findings:**
- The **Ralph Wiggum self-assessment loop** from Deft is the single highest-value addition: agents detect their own "danger" states before presenting work, reducing review cycles.
- **Spec Kit's five-phase gated workflow** (Principles → Specify → Plan → Tasks → Implement) maps cleanly onto Panopticon's planning-to-execution pipeline with better upfront "why" capture.
- **Superpowers' subagent-driven development** pattern is already implicit in Panopticon's specialist pipeline, but lacks the two-stage review gate (spec compliance before code quality) that Superpowers enforces.
- **Deft's four-tier verification ladder** (Static → Command → Behavioral → Human) is more rigorous than Panopticon's current inspection model and would improve specialist accuracy.

---

## 1. The Frameworks

### 1.1 vBRIEF (Adopted)

**What it is:** Basic Relational Intent Exchange Format — a structured JSON plan format with DAG edges, narratives, and hierarchical subItems.

**Canonical spec:** github.com/deftai/vBRIEF v0.5

**What Panopticon uses:**
- `plan.vbrief.json` as the structured plan artifact
- DAG edges (`blocks`, `informs`, `invalidates`, `suggests`) for dependency modeling
- `subItems` with `metadata.kind: "acceptance_criterion"` for acceptance criteria
- TRON encoding (35–40% token reduction) for LLM context windows
- Graduated complexity: minimal plans need 4 fields; complex plans add narratives, edges, and metadata

**What's missing from Panopticon's vBRIEF usage:**
- `fork` metadata for derived plans
- `changeLog` array for audit trail
- `reviewers` array
- `agent` and `lastModifiedBy` tracking
- `planRef` for feature→story decomposition (partially implemented via Rally integration)

**Assessment:** Well-adopted. The vBRIEF foundation is solid and the spec is actively maintained by Jonathan Taylor (visionik/deft). Panopticon's extensions (difficulty, issueLabel, kind metadata) are a clean overlay. The main gap is richer audit trail and change tracking within the plan itself.

---

### 1.2 Deft

**What it is:** A layered AI development framework providing consistent standards, reproducible workflows, and self-improving guidelines. Built by visionik/deft.

**Key subcomponents:**

#### Verification Ladder (4 Tiers)

Deft defines a strict verification hierarchy — check the strongest tier reachable:

| Tier | Type | What it verifies |
|------|------|------------------|
| 1 | **Static** | Files exist, line counts, exports, imports wired, no stubs |
| 2 | **Command** | Tests pass, build succeeds, lint clean |
| 3 | **Behavioral** | Browser flows work, API responses correct, CLI output matches spec |
| 4 | **Human** | User manually verifies |

**Key rule:** Tier 1 (Static) is the minimum — always perform it. Tier 4 (Human) is only acceptable when tiers 1–3 cannot confirm the outcome.

**Anti-patterns:**
- Marking task done because all steps were followed (not outcomes)
- Skipping static verification
- Accepting stubs as complete work
- Asking a human to verify what a `curl` or test can check

#### Ralph Wiggum Loop (Self-Assessment)

Named after the Simpsons character ("I'm in danger!"), this is a bounded internal retry loop where agents self-assess quality before presenting work:

1. **Code Generation** — Write code based on spec
2. **Self-Assessment** — Check: spec alignment, test coverage, quality metrics, edge cases, technical debt, dependencies, security
3. **Danger Detection** — If any criterion fails, recognize danger state
4. **Self-Correction** — Re-attempt the original task with fixes
5. **Exit** — Success (all criteria pass) or Escalation (after N iterations, ask user)

**Key properties:**
- Bounded iteration (default: 3 attempts)
- User never sees intermediate failed attempts
- Transparent when activated ("🚨 Ralph loop: iteration 2...")

**Assessment:** The Ralph loop is the single highest-value pattern Panopticon does NOT currently implement. Agents present work to specialists without self-filtering, which causes unnecessary review cycles.

#### Swarm Coordination

Deft's multi-agent coordination guidelines include:

- **Explicit context rule:** Never assume shared state or implicit context between agents. Spell out all assumptions.
- **Structured input/output via Pydantic models:** `AgentTaskInput` and `AgentTaskOutput` with frozen/immutable models, task_id and agent_id on every model for traceability.
- **File locking:** Declare file locks at task start in shared state.
- **vBRIEF as shared state:** Use `vbrief/plan.vbrief.json` for active task tracking, not custom JSON files.
- **ADR pattern:** Document architecture decisions in `docs/decisions/ADR-NNN.md`.

#### Context Management Strategies

Deft includes a `context/` directory with:
- **fractal-summaries.md** — Recursive summarization for long contexts
- **working-memory.md** — What to keep active vs. archive
- **long-horizon.md** — Maintaining coherence across extended sessions
- **spec-deltas.md** — Tracking specification changes across time

#### Notation System (RFC 2119)

Deft uses compact notation for scanability:
- `!` = MUST (mandatory)
- `~` = SHOULD (recommended)
- `≉` = SHOULD NOT (avoid unless justified)
- `⊗` = MUST NOT (forbidden)

Appears in language standards and technical documents for quick visual scanning.

---

### 1.3 Superpowers

**What it is:** A skill-based framework for Claude Code / Cursor / Codex / OpenCode, built by obra/superpowers. Composable skills trigger automatically before code is written.

**Core workflow (7 phases):**

1. **Brainstorming** — Socratic design refinement before any code. Presents design in digestible chunks for validation. Saves design doc.
2. **Git Worktrees** — Creates isolated workspace on new branch, verifies clean test baseline.
3. **Writing Plans** — Breaks work into 2–5 minute tasks with exact file paths and verification steps.
4. **Subagent-Driven Development** — Core multi-agent pattern: fresh subagent per task with two-stage review.
5. **Test-Driven Development** — RED-GREEN-REFACTOR cycle.
6. **Code Review** — Between tasks, reviews against plan, reports issues by severity.
7. **Finishing Branch** — Verifies tests, presents merge/PR/keep/discard options, cleans up worktree.

**Key multi-agent pattern — Two-Stage Review:**

Before any code is considered "done," it passes through two sequential gates:
1. **Spec compliance check** — Does the diff implement what the task described?
2. **Code quality check** — Is the code well-written, secure, performant?

This ordering is intentional: spec compliance gates code quality. If the code is wrong in intent, quality review is wasted effort.

**Subagent-Driven Development detail:**

> "It's not uncommon for Claude to be able to work autonomously for a couple hours at a time without deviating from the plan you put together."

Agents work through each task, inspecting and reviewing their own work, continuing forward. Human checkpoints are available but not required.

**Assessment:** Panopticon's specialist pipeline is a productionized version of this. The two-stage review pattern (spec compliance before code quality) is the main thing Superpowers has that Panopticon doesn't — currently Panopticon's inspect-agent does both simultaneously, which can mask spec drift.

---

### 1.4 Spec Kit (GitHub)

**What it is:** An open-source toolkit for spec-driven development. "Specifications become executable, directly generating working implementations."

**Three approaches:**
- **Greenfield (0-to-1):** High-level requirements → specifications → planning → building
- **Creative Exploration:** Parallel implementations across diverse technology stacks
- **Brownfield (Iterative Enhancement):** Add features to existing systems, modernize legacy

**Workflow phases (5-step):**

| Phase | Name | Output |
|-------|------|--------|
| 1 | **Principles** | `project.md` — immutable governing rules |
| 2 | **Specify** | `specs/[feature]/spec.md` — WHAT/WHY |
| 3 | **Plan** | `specs/[feature]/plan.md` + docs — HOW |
| 4 | **Tasks** | `./vbrief/plan.vbrief.json` — executable task tracker |
| 5 | **Implement** | Code + tests |

**Phase 1 — Principles gate:**

Before writing any spec, define 3–5 non-negotiable principles. Include at least one anti-principle (`⊗ MUST NOT`). This prevents scope creep and establishes what the project will NOT do.

**Phase 2 — Specify structure:**

```
Feature Specification: [Name]
├── User Scenarios (mandatory)
│   └── Journey, priority, why, independent test, acceptance scenarios (Given/When/Then)
├── Edge Cases
├── Requirements (mandatory)
│   ├── Functional (FR-001, FR-002...)
│   └── Non-Functional (NFR-001, NFR-002...)
└── Success Criteria
```

`[NEEDS CLARIFICATION: question]` markers used for ambiguity — not guessed.

**Phase 3 — Plan gates:**

Before implementation:
- **Simplicity Gate** — ≤3 packages/projects? No unjustified future-proofing?
- **Test-First Gate** — Contract tests defined? Acceptance tests mapped to user stories?

**Phase 4 — Task sizing:**

~1–4 hours of work per task. Use vBRIEF `blocks` edges for dependencies (replaces old `[P]`/`[S]`/`[B]` markers).

**Assessment:** Spec Kit's phased approach with explicit gates maps well onto Panopticon's existing pipeline. The Principles phase (establishing non-negotiables before spec writing) would improve PRD quality. The Simplicity Gate and Test-First Gate before Phase 3 would reduce implementation surprises.

---

### 1.5 Not Found / Unavailable

The following were requested but could not be located in the local filesystem or online:
- **BMAD Method** — No results found
- **Taskmaster** — No results found
- **Agent OS** — No results found
- **OpenSpec** — No results found
- **Spec Kit** (beyond Deft's speckit strategy) — github.com/github/spec-kit returned 404

These may be private, renamed, or defunct. If they surface, re-evaluate.

---

## 2. Gap Analysis: What Panopticon Is Missing

### 2.1 Ralph Wiggum Self-Assessment Loop

**Gap:** Agents do not self-assess before presenting work. They generate code and immediately signal completion or request review.

**Impact:** Review cycles include fix requests for issues the agent could have caught itself — wasted specialist cycles, slower feedback.

**Proposed implementation:** Add a self-assessment phase in the work agent before `pan done`:
1. Agent generates code
2. Agent runs internal checklist: spec alignment, stub detection, test coverage, lint/format
3. If any check fails: fix internally, re-check
4. Only after internal checks pass: signal `pan done`

**Complexity:** Medium. Requires defining the checklist, running it silently, and exposing iteration count in logs only.

---

### 2.2 Two-Stage Specialist Review Gate

**Gap:** Panopticon's inspect-agent combines spec fidelity and constraint compliance in one check. Superpowers enforces spec compliance first, then code quality — so code that doesn't match spec is rejected before quality review.

**Impact:** When spec drift occurs, Panopticon's review-agent spends effort reviewing code that doesn't implement the right thing.

**Proposed implementation:** Split inspect-agent into two sequential passes:
1. **Spec compliance pass** — Does the diff match the bead narrative and acceptance criteria?
2. **Quality pass** — Does the code meet CLAUDE.md standards, security, performance?

Only after spec compliance passes does quality review occur.

**Complexity:** Low. The inspect-agent already does both; separating them into sequential passes with explicit pass/fail per stage is a structural change, not a new capability.

---

### 2.3 Principles Phase Before PRD

**Gap:** Panopticon's planning agent starts with PRD discovery but has no mechanism to establish governing principles first. The PRD can grow without bounds.

**Impact:** Scope creep in planning, issues that lack clear "what we will NOT do" boundaries.

**Proposed implementation:** Add a pre-PRD "Principles" phase:
1. Define 3–5 non-negotiable project principles
2. Define at least one anti-principle (what this will NOT do)
3. Store in `.planning/principles.md`
4. Planning agent references principles when drafting vBRIEF plan

**Complexity:** Low. This is a prompt addition and a new optional artifact.

---

### 2.4 Richer Audit Trail in vBRIEF

**Gap:** Panopticon's vBRIEF plan tracks item status but not change history, reviewers, or last-modified-by.

**Impact:** Hard to reconstruct why a plan changed over time, who reviewed it, or what the evolution looked like.

**Proposed implementation:** Extend vBRIEF with Panopticon-specific fields:
- `changeLog[]` — Array of `{ timestamp, author, field, oldValue, newValue }` objects
- `reviewers[]` — Array of reviewer identifiers
- `lastModifiedBy` — Agent or human who last touched the plan
- `fork` metadata — For derived plans (branch → main backports, etc.)

**Complexity:** Medium. Requires io.ts modifications and schema updates.

---

### 2.5 Fractal Context Summaries

**Gap:** Panopticon's agents operate in long sessions but have no systematic context summarization strategy. Large codebases exhaust context.

**Impact:** Agents lose coherence in extended sessions; TLDR is available but used ad-hoc.

**Proposed implementation:** Adopt Deft's fractal-summaries pattern:
- For files < 500 lines: full content
- For files 500–2000 lines: TLDR summary + key function signatures
- For files > 2000 lines: module-level summary + import/export graph
- Periodic "context compression" step that archives less-recent context

**Complexity:** Medium. TLDR MCP is already available; the challenge is integration into the work agent's session management.

---

## 3. Borrowing Recommendations

### 3.1 Immediate (Can Implement This Week)

| Pattern | Source | Implementation | Effort |
|---------|--------|----------------|--------|
| **Ralph loop** (self-assessment before pan done) | Deft | Add pre-done checklist in work agent prompt | Medium |
| **Two-stage inspect** (spec → quality) | Superpowers | Split inspect-agent into sequential passes | Low |
| **Principles pre-PRD** | Spec Kit | Add principles phase in planning prompt | Low |
| **Stub detection** (explicit) | Deft | Add `TODO`/`FIXME`/`unimplemented` scan to inspect | Low |

### 3.2 Short-Term (This Sprint)

| Pattern | Source | Implementation | Effort |
|---------|--------|----------------|--------|
| **ChangeLog in vBRIEF** | Deft | Extend io.ts to track plan mutations | Medium |
| **Verification ladder** (4 tiers) | Deft | Map inspect-agent to tier 1, test-agent to tier 2, uat-agent to tier 3, human to tier 4 | Medium |
| **ADR pattern** | Deft | Introduce `docs/decisions/ADR-NNN.md` for architecture decisions | Low |
| **Context digest for specialists** | Deft | Specialists write context digest after each run for next dispatch | Low |

### 3.3 Medium-Term (Future)

| Pattern | Source | Implementation | Effort |
|---------|--------|----------------|--------|
| **Fractal summaries** | Deft | TLDR integration into work agent session management | Medium |
| **Swarm coordination** (structured I/O) | Deft | Add immutable Pydantic models for cross-agent communication | Medium |
| **Fork metadata** in vBRIEF | vBRIEF spec | Implement `fork` field for derived plans | Low |
| **Creative Exploration mode** | Spec Kit | Parallel implementation variants for complex decisions | High |

---

## 4. What's Already Better in Panopticon

It would be a mistake to conclude that Panopticon is behind these frameworks. In several areas, Panopticon is ahead:

| Capability | Panopticon | Others |
|------------|-----------|--------|
| **Multi-agent pipeline** | inspect → review → test → uat → merge | Superpowers has review; Deft has verification but no pipeline |
| **Cloister watchdog** | Active heartbeat monitoring, stuck detection, emergency stop | Not present in any comparable framework |
| **DAG-aware task scheduling** | `bd ready -l <issue>` for unblocked beads | vBRIEF has edges; neither Deft nor Superpowers use them for scheduling |
| **Baseline-aware merge validation** | Merge-agent compares post-merge failures vs baseline | Not present in any comparable framework |
| **Circuit breaker** | 3 auto-requeue limit, then human intervention | Not present in any comparable framework |
| **Worktree isolation** | Git worktree per workspace, Docker-backed | Superpowers uses worktrees; others use directories |
| **Model routing** | Opus → Sonnet → Haiku via complexity | Not present in any comparable framework |
| **UAT with real browser** | Playwright-based CORS, visual, auth flow verification | Not present in any comparable framework |
| **vBRIEF native** | Panopticon generates beads from vBRIEF items automatically | Deft references vBRIEF but doesn't generate from it |

---

## 5. Conclusion

Panopticon has a strong foundation — the vBRIEF adoption, specialist pipeline, and Cloister watchdog are ahead of comparable frameworks. The highest-value additions would be:

1. **Ralph Wiggum self-assessment loop** — Agents catch their own quality issues before presenting work, reducing specialist cycles.
2. **Two-stage inspect** — Spec compliance gate before code quality gate, preventing quality review of wrong code.
3. **Principles phase** — Establish non-negotiables before PRD writing, preventing scope creep.
4. **Verification ladder alignment** — Map existing specialists to Deft's 4-tier model for clearer expectations.

The others (BMAD, Taskmaster, Agent OS, OpenSpec) could not be located and should be re-checked periodically.

---

## 6. References

- [vBRIEF Specification v0.5](https://github.com/deftai/vBRIEF)
- [Deft Framework](https://deft.md)
- [Superpowers](https://github.com/obra/superpowers)
- [Spec Kit (Deft strategies)](https://github.com/visionik/deft/blob/main/strategies/speckit.md)
- [Panopticon vBRIEF docs](./VBRIEF.md)
- [Panopticon Specialist Workflow](./SPECIALIST_WORKFLOW.md)
- [Panopticon Hierarchical Planning](./HIERARCHICAL-PLANNING.md)
- [Panopticon Cloister](./PRD-CLOISTER.md)
