# Workflow Orchestration Landscape

**Author:** Edward Becker (eltmon)  
**Date:** 2026-04-28  
**Model:** Kimi K2.6  
**Purpose:** Survey comparable frameworks, identify gaps in Panopticon's current approach, and propose concrete enhancements. This document updates the prior Opus analysis with newly researched frameworks (Taskmaster, OpenAI Agents SDK) and deeper investigation of Deft/Superpowers/Spec Kit patterns.

---

## Executive Summary

Panopticon implements a mature specialist pipeline (inspect → review → test → uat → merge) over vBRIEF plans, with Cloister as the watchdog and beads as the execution unit. This document surveys the full ecosystem of comparable frameworks to identify what Panopticon could borrow or improve upon.

**Key findings:**
- **Taskmaster's PRD-driven task decomposition** with complexity analysis and MCP tool tiers offers a more structured planning-to-execution bridge than Panopticon's current beads conversion.
- **The Ralph Wiggum self-assessment loop** from Deft remains the single highest-value addition: agents detect their own "danger" states before presenting work, reducing review cycles.
- **Spec Kit's five-phase gated workflow** (Principles → Specify → Plan → Tasks → Implement) maps cleanly onto Panopticon's pipeline with better upfront "why" capture.
- **Superpowers' subagent-driven development** pattern is implicit in Panopticon's specialist pipeline, but lacks the two-stage review gate (spec compliance before code quality) that Superpowers enforces.
- **OpenAI Agents SDK's guardrails and tracing primitives** suggest a future where Panopticon agents have first-class input/output validation and observability, not just post-hoc review.
- **Deft's four-tier verification ladder** (Static → Command → Behavioral → Human) is more rigorous than Panopticon's current inspection model.

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

**Assessment:** Well-adopted. The vBRIEF foundation is solid. Main gap is richer audit trail and change tracking within the plan itself.

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

Agents work through each task, inspecting and reviewing their own work, continuing forward. Human checkpoints are available but not required. Fresh subagent per task means no context pollution.

**Assessment:** Panopticon's specialist pipeline is a productionized version of this. The two-stage review pattern is the main thing Superpowers has that Panopticon doesn't — currently Panopticon's inspect-agent does both simultaneously, which can mask spec drift.

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

**Assessment:** Spec Kit's phased approach with explicit gates maps well onto Panopticon's existing pipeline. The Principles phase would improve PRD quality. The Simplicity Gate and Test-First Gate before Phase 3 would reduce implementation surprises.

---

### 1.5 Taskmaster (eyaltoledano/claude-task-master)

**What it is:** An AI-powered task-management system for AI-driven development that integrates with editors via MCP. Found in MYN's `.taskmaster/` directory.

**Core workflow:**

1. **Initialize** — `task-master init` sets up project structure
2. **Parse PRD** — `task-master parse-prd .taskmaster/docs/prd.txt` generates tasks from natural language requirements
3. **Plan** — `task-master next` identifies the next task to implement
4. **Execute** — Implement with AI assistance via `show`, `expand`, or `research` commands
5. **Iterate** — Update statuses, move between tags (`backlog` → `in-progress` → `done`)

**Key features:**

| Feature | Description |
|--------|-------------|
| **PRD-driven decomposition** | Detailed PRD → structured tasks automatically |
| **Subtasks** | Granular breakdown via `expand` and `update-subtask` |
| **Dependencies** | First-class with `--with-dependencies` / `--ignore-dependencies` |
| **Tags / workstreams** | Organize tasks by state (backlog, in-progress, done) |
| **Complexity analysis** | `analyze-complexity` identifies tasks needing decomposition |
| **MCP tool tiers** | `core` (7 tools, ~5K tokens), `standard` (15 tools, ~10K tokens), `all` (36 tools, ~21K tokens) |
| **Research mode** | Gathers fresh information with project context awareness |
| **Multi-provider AI** | Anthropic, OpenAI, Google, Perplexity, xAI, OpenRouter, etc. |

**Task structure:**
- Task IDs (numeric, e.g., "task 3")
- Status tracking via `set_task_status`
- Subtasks via `update_subtask`
- Dependencies between tasks
- Individual task files auto-generated from `tasks.json`

**Assessment for Panopticon:**

Taskmaster's PRD parser is more sophisticated than Panopticon's current planning flow. Panopticon requires Opus to manually construct vBRIEF plans; Taskmaster automates task generation from prose PRDs with complexity analysis. The MCP tool tiering is also instructive — Panopticon loads all context regardless of task complexity, while Taskmaster scales tool exposure based on context budget.

**What Panopticon could borrow:**
- **Automated PRD parsing** into vBRIEF items (not just Opus free-form generation)
- **Complexity analysis** before planning to determine model routing and task granularity
- **Tool tiering** — load fewer tools for simple tasks, full toolset for complex ones
- **Research command** with project context (Panopticon's planning agent does this manually)

---

### 1.6 OpenAI Agents SDK ("Agent OS" candidate)

**What it is:** A Python SDK for building agent workflows with first-class primitives for orchestration, guardrails, and observability.

**Core primitives:**

| Primitive | Purpose |
|-----------|---------|
| **Agents** | LLMs configured with instructions, tools, guardrails, and handoffs |
| **Handoffs / Agents as tools** | Delegation to specialized agents |
| **Guardrails** | Configurable safety checks for input and output validation |
| **Sessions** | Automatic conversation history management across agent runs |
| **Tracing** | Tracking of agent runs for debugging and optimization |
| **Sandbox Agents** | Preconfigured containerized environments for long time horizons |

**Key patterns:**

**Guardrails architecture:**
- Run input validation and safety checks in parallel with agent execution
- Fail fast when checks do not pass
- Operate on both inputs and outputs
- First-class, configurable validators attached at agent definition — not retrofitted

**Hierarchical delegation:**
- Agents operate as tools for other agents
- Recursive task decomposition without explicit workflow graphs
- Contrasted with "manager-style orchestration"

**Runner-centric execution:**
- `Runner.run_sync()` drives execution with `RunConfig`
- Managed agent loop: handles tool invocation, sends results back to LLM, continues until complete

**Assessment for Panopticon:**

Panopticon's specialists are currently triggered by Cloister with custom prompts. The OpenAI Agents SDK suggests a future where:
- **Guardrails** replace post-hoc verification gates with inline validation
- **Handoffs** enable cleaner specialist delegation (inspect → review → test as explicit handoffs, not status transitions)
- **Tracing** provides built-in observability instead of custom heartbeat files
- **Sessions** could replace Panopticon's manual session-to-agent mapping

However, Panopticon's pipeline is more deterministic and auditable than the SDK's dynamic loop. The SDK is optimized for conversational agents; Panopticon is optimized for software engineering pipelines. Selective adoption of guardrails and tracing patterns is warranted.

---

### 1.7 Not Found / Need Clarification

The following were requested but could not be located:

- **BMAD Method** — No results found in local filesystem or accessible online sources. Please provide a repository URL or description.
- **OpenSpec** — No results found. This may refer to a specific framework, OpenAPI spec-driven development, or a private/internal tool. Please clarify.
- **Agent OS** — If this refers to the OpenAI Agents SDK (Section 1.6), the analysis above applies. If it refers to a different framework, please provide a URL.

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

### 2.4 Automated PRD Parsing (Taskmaster-style)

**Gap:** Panopticon's planning agent manually constructs vBRIEF plans from PRD + codebase exploration. There is no structured PRD-to-task decomposition pipeline.

**Impact:** Planning quality varies based on Opus's free-form generation. Complex PRDs may result in inconsistent task granularity or missed acceptance criteria.

**Proposed implementation:** Add a `parse-prd` command or planning phase:
1. Read PRD from `docs/prds/active/<issue>.md`
2. Extract functional requirements (FR-NNN), non-functional requirements (NFR-NNN), user stories, and edge cases
3. Run complexity analysis to determine task granularity
4. Generate vBRIEF items with acceptance criteria automatically
5. Allow human review before converting to beads

**Complexity:** Medium. Requires PRD parser, complexity analyzer, and vBRIEF generator.

---

### 2.5 Tool Tiering by Complexity (Taskmaster-style)

**Gap:** Panopticon loads the full toolset and context for every agent regardless of task complexity. A simple CSS fix gets the same context window usage as a database migration.

**Impact:** Wasted tokens, slower agent startup, unnecessary permission prompts.

**Proposed implementation:** Scale tool exposure based on task complexity (from vBRIEF `metadata.difficulty`):

| Difficulty | Tools | Context | Model |
|-----------|-------|---------|-------|
| `trivial` | Core only (file edit, bash) | Minimal | Haiku |
| `simple` | Standard + relevant skills | PRD + plan | Sonnet |
| `medium` | Full toolset | PRD + plan + codebase | Sonnet |
| `complex` | Full toolset + TLDR | PRD + plan + codebase + ADRs | Opus |
| `expert` | Full + research + web | Everything + external docs | Opus |

**Complexity:** Medium. Requires difficulty-aware agent launch configuration.

---

### 2.6 Guardrails for Agent Input/Output (OpenAI Agents SDK pattern)

**Gap:** Panopticon validates agent work through post-hoc specialist review (inspect, review, test). There is no inline validation of agent outputs before they are written to disk.

**Impact:** Bad outputs (incorrect file paths, malformed code, security issues) are written to the workspace before detection.

**Proposed implementation:** Add lightweight guardrails at the agent boundary:
1. **Input guardrail** — Validate that agent instructions include required context (issue ID, workspace path, beads reference)
2. **Output guardrail** — Scan agent file writes for: stubs/TODOs, obvious security issues (eval, innerHTML), files outside workspace scope
3. **Fast failure** — Block write and nudge agent immediately, rather than waiting for inspect-agent

**Complexity:** Medium. Requires hooking into the agent's file write path.

---

### 2.7 Richer Audit Trail in vBRIEF

**Gap:** Panopticon's vBRIEF plan tracks item status but not change history, reviewers, or last-modified-by.

**Impact:** Hard to reconstruct why a plan changed over time, who reviewed it, or what the evolution looked like.

**Proposed implementation:** Extend vBRIEF with Panopticon-specific fields:
- `changeLog[]` — Array of `{ timestamp, author, field, oldValue, newValue }` objects
- `reviewers[]` — Array of reviewer identifiers
- `lastModifiedBy` — Agent or human who last touched the plan
- `fork` metadata — For derived plans (branch → main backports, etc.)

**Complexity:** Medium. Requires io.ts modifications and schema updates.

---

### 2.8 Fractal Context Summaries

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
| **Tool tiering by difficulty** | Taskmaster | Scale tool exposure based on `metadata.difficulty` | Medium |

### 3.2 Short-Term (This Sprint)

| Pattern | Source | Implementation | Effort |
|---------|--------|----------------|--------|
| **ChangeLog in vBRIEF** | Deft | Extend io.ts to track plan mutations | Medium |
| **Verification ladder** (4 tiers) | Deft | Map inspect-agent to tier 1, test-agent to tier 2, uat-agent to tier 3, human to tier 4 | Medium |
| **ADR pattern** | Deft | Introduce `docs/decisions/ADR-NNN.md` for architecture decisions | Low |
| **Context digest for specialists** | Deft | Specialists write context digest after each run for next dispatch | Low |
| **Automated PRD parsing** | Taskmaster | Add `parse-prd` command or planning phase for structured task extraction | Medium |
| **Guardrails** (lightweight) | OpenAI Agents SDK | Input/output validation at agent boundary | Medium |

### 3.3 Medium-Term (Future)

| Pattern | Source | Implementation | Effort |
|---------|--------|----------------|--------|
| **Fractal summaries** | Deft | TLDR integration into work agent session management | Medium |
| **Swarm coordination** (structured I/O) | Deft | Add immutable Pydantic models for cross-agent communication | Medium |
| **Fork metadata** in vBRIEF | vBRIEF spec | Implement `fork` field for derived plans | Low |
| **Creative Exploration mode** | Spec Kit | Parallel implementation variants for complex decisions | High |
| **Tracing integration** | OpenAI Agents SDK | Structured trace collection for agent runs | High |
| **MCP tool tiering** | Taskmaster | Full MCP server with tiered tool exposure | High |

---

## 4. What's Already Better in Panopticon

It would be a mistake to conclude that Panopticon is behind these frameworks. In several areas, Panopticon is ahead:

| Capability | Panopticon | Others |
|------------|-----------|--------|
| **Multi-agent pipeline** | inspect → review → test → uat → merge | Superpowers has review; Deft has verification but no pipeline; Taskmaster has no specialist pipeline |
| **Cloister watchdog** | Active heartbeat monitoring, stuck detection, emergency stop | Not present in any comparable framework |
| **DAG-aware task scheduling** | `bd ready -l <issue>` for unblocked beads | vBRIEF has edges; neither Deft nor Superpowers use them for scheduling |
| **Baseline-aware merge validation** | Merge-agent compares post-merge failures vs baseline | Not present in any comparable framework |
| **Circuit breaker** | 3 auto-requeue limit, then human intervention | Not present in any comparable framework |
| **Worktree isolation** | Git worktree per workspace, Docker-backed | Superpowers uses worktrees; others use directories |
| **Model routing** | Opus → Sonnet → Haiku via complexity | Not present in any comparable framework |
| **UAT with real browser** | Playwright-based CORS, visual, auth flow verification | Not present in any comparable framework |
| **vBRIEF native** | Panopticon generates beads from vBRIEF items automatically | Deft references vBRIEF but doesn't generate from it |
| **Cost tracking** | Per-agent cost attribution with alerts | Not present in any comparable framework |
| **Tracker integration** | Linear, GitHub, GitLab, Rally with issue prefix resolution | Taskmaster has no tracker integration |

---

## 5. Conclusion

Panopticon has a strong foundation — the vBRIEF adoption, specialist pipeline, and Cloister watchdog are ahead of comparable frameworks. The highest-value additions would be:

1. **Ralph Wiggum self-assessment loop** — Agents catch their own quality issues before presenting work, reducing specialist cycles.
2. **Two-stage inspect** — Spec compliance gate before code quality gate, preventing quality review of wrong code.
3. **Principles phase** — Establish non-negotiables before PRD writing, preventing scope creep.
4. **Automated PRD parsing** — Taskmaster-style PRD-to-vBRIEF decomposition with complexity analysis.
5. **Tool tiering by difficulty** — Scale context and tool exposure to match task complexity, saving tokens.
6. **Lightweight guardrails** — Inline input/output validation at agent boundaries, failing fast instead of post-hoc.

The remaining frameworks (BMAD Method, OpenSpec, and possibly Agent OS if different from OpenAI Agents SDK) could not be located and should be provided for inclusion in a future revision.

---

## 6. References

- [vBRIEF Specification v0.5](https://github.com/deftai/vBRIEF)
- [Deft Framework](https://deft.md)
- [Superpowers](https://github.com/obra/superpowers)
- [Spec Kit (Deft strategies)](https://github.com/visionik/deft/blob/main/strategies/speckit.md)
- [Taskmaster](https://github.com/eyaltoledano/claude-task-master)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)
- [Panopticon vBRIEF docs](./VBRIEF.md)
- [Panopticon Specialist Workflow](./SPECIALIST_WORKFLOW.md)
- [Panopticon Hierarchical Planning](./HIERARCHICAL-PLANNING.md)
- [Panopticon Cloister](./PRD-CLOISTER.md)
