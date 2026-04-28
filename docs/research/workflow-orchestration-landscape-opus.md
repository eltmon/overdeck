# Workflow Orchestration Landscape & Panopticon Enhancement Proposal

> Research conducted 2026-04-28. Tools analyzed: vBRIEF (adopted), Deft Directive (local),
> Superpowers (local), Spec Kit (GitHub), OpenSpec (Fission-AI), Taskmaster (claude-task-master),
> Agent OS (Builder Methods), BMAD Method.

---

## Part 1: Landscape Analysis

### 1.1 What We Have Today

Panopticon's current pipeline:

```
Issue (GitHub/Linear)
  → Planning Agent writes .planning/plan.vbrief.json
    → `pan plan finalize` calls createBeadsFromVBrief()
      → Beads created with dependencies, labels, AC descriptions
        → Work agent executes beads iteratively (bd ready → implement → bd close)
          → syncBeadStatusToVBrief() updates plan
            → pan done → preflight checks (open beads? pending ACs?)
              → Review → Test → Merge
```

**Strengths of the current system:**
- vBRIEF's DAG edges model real dependency relationships with typed semantics (blocks, informs, invalidates, suggests)
- Beads is git-native issue tracking with async coordination gates and merge slots
- TRON encoding saves 35-40% tokens vs JSON in plan context
- Specialist pipeline (review → test → merge) is fully automated up to the merge click
- Planning agent generates structured plans with acceptance criteria as first-class subItems

**Known gaps:**
1. No spec readiness gate — plans can be finalized with vague or incomplete ACs
2. AC-bead synchronization is manual in the work agent prompt (agent must remember to update vBRIEF after `bd close`)
3. No per-bead AC linkage — beads don't know which specific ACs they implement
4. No convention/standards injection — agents start cold every time
5. No complexity scoring — all beads treated equally regardless of difficulty
6. No delta-spec capability for brownfield work (most Panopticon work is brownfield)
7. No contract verification between dependent beads
8. No systematic spec drift detection after implementation
9. No structured retrospective capture from completed work

---

### 1.2 Tool-by-Tool Analysis

#### vBRIEF (Adopted — `/home/eltmon/Projects/vbrief/`)

The universal plan format we already use. Key features beyond what we leverage today:

| Feature | Current Use | Untapped Potential |
|---------|------------|-------------------|
| DAG edges | Used for bead dependency ordering | Could drive parallel agent dispatch and critical-path scheduling |
| Narratives | Planning agent writes Problem/Risk | Could capture retrospective data (Outcome, Lessons, Strengths, Weaknesses) |
| TRON encoding | Not used | Could compress plan context injected into work/review agent prompts |
| planRef | Not used | Could link story-level plans to feature-level plans for cross-issue AC rollup |
| changeLog | Not used | Could track plan revisions for audit trail |
| sequence counter | Used for optimistic concurrency | Already working well |

**Verdict:** We use ~60% of vBRIEF's capability. The narrative retrospectives, TRON encoding, and planRef cross-linking are the biggest unlocks.

---

#### Deft Directive (`/home/eltmon/Projects/deft/`)

A layered framework for structuring AI development work. Most relevant concepts for Panopticon:

**Strategies (development approach selection):**
Deft defines 6+ strategies based on project context: interview (standard), yolo (quick), speckit (large/complex), map (brownfield), discuss (alignment), research (pre-implementation). Panopticon currently has one approach for all work — the planning agent always does the same thing regardless of issue size or type.

**Contracts (boundary maps between work units):**
Before parallel work begins, each feature declares what it produces and consumes:
```
Feature 1 produces: types.ts → User, Session (interfaces)
Feature 2 consumes from Feature 1: types.ts → User
```
Verification: before starting consuming work, verify upstream contracts are actually exported. This directly addresses our gap where dependent beads can fail because upstream beads didn't produce expected exports.

**4-tier verification ladder:**
1. Static — files exist, exports present, no stubs
2. Command — tests pass, build succeeds, lint clean
3. Behavioral — flows work end-to-end
4. Human — manual acceptance (only when tiers 1-3 can't confirm)

Our current verification is a single gate (`pan done` preflight). Deft's tiered approach would let us catch issues earlier.

**Stub detection:**
Scan for `TODO`, `FIXME`, `return null`, `return {}`, functions under ~8 lines returning hardcoded values. Could be a pre-review gate.

**Resilience / continue-here:**
Deft's `continue.vbrief.json` pattern for interruption recovery maps to our existing checkpoint system but adds structured context about what was in-progress and what decisions were pending.

**Verdict:** Strategies, contracts, and tiered verification are the highest-value concepts. The strategy selection alone would dramatically improve planning quality for different issue types.

---

#### Superpowers (`/home/eltmon/Projects/superpowers/`)

Jesse Vincent's mandatory skill enforcement system. Most relevant concepts:

**Subagent-Driven Development (SDD):**
Fresh subagent per task with two-stage review:
1. Spec compliance review — does the code match requirements (not just "is it well-written")?
2. Code quality review — only runs AFTER spec compliance passes

This is exactly the gap in our review system. Our review agent does both simultaneously, which means code quality feedback can obscure spec compliance failures.

**Mandatory skill enforcement:**
Skills aren't suggestions — the `using-superpowers` skill establishes hard gates that agents MUST invoke before ANY response. Includes anti-rationalization red flags. We have Cloister model routing but no skill enforcement — agents can skip steps without detection.

**Bite-sized task granularity (2-5 minute steps):**
Each implementation step is: write failing test → verify failure → write minimal code → verify pass → commit. Our beads can be arbitrarily large — a "medium" difficulty bead might take 30-60 minutes. Superpowers' granularity enables tighter feedback loops.

**Verification-before-completion:**
NO completion assertions without running verification commands fresh in current message. Red flags: "should work", "probably fixed", "I'm confident" without evidence. We could add this as a Cloister prompt pattern.

**Systematic debugging protocol:**
Root cause investigation before fixing: reproduce, check recent changes, gather diagnostic evidence at component boundaries, trace data flow. Only AFTER Phase 1 can the agent propose fixes. This maps to our engineering philosophy but isn't enforced in prompts.

**Verdict:** Two-stage review (spec compliance first, then code quality) and verification-before-completion are immediately actionable. The SDD fresh-agent-per-task model is interesting but conflicts with our agent reuse economics.

---

#### Spec Kit (`github/spec-kit`)

GitHub's official SDD toolkit. Most relevant concepts:

**Four gated phases: Specify → Plan → Tasks → Implement:**
Each phase produces an artifact and requires human approval before proceeding. Our pipeline has implicit phases but no explicit gates between planning and finalization.

**Canon/drift detection:**
Tracks alignment between specs and code. After implementation, detects when code has diverged from the spec (features added without spec updates, spec items not implemented). We have no post-implementation spec alignment check — once work passes review, the vBRIEF is archived and never compared against.

**YAML workflow pipelines:**
Multi-step, resumable automation pipelines with control flow and human review gates. Our Cloister lifecycle is hardcoded — adding new gates or steps requires code changes.

**Verdict:** Canon/drift detection is the standout concept. A post-merge check that validates "did we actually build what the vBRIEF said?" would close the loop on spec compliance. The YAML pipeline concept is interesting for making our lifecycle configurable.

---

#### OpenSpec (`Fission-AI/OpenSpec`)

A lightweight, brownfield-first spec framework. Most relevant concepts:

**Delta specs:**
Instead of restating entire requirements, delta specs describe only what's being added, modified, or removed. For brownfield work (which is 90%+ of Panopticon development), this is far more natural than writing complete specs. Our planning agents currently write full plans even for small changes.

**Fluid workflow (no rigid gates):**
Artifacts can be created in any order and refined iteratively. This contrasts with Spec Kit's rigid phases. For smaller issues, our current pipeline adds unnecessary ceremony.

**Change folders:**
Each proposed change gets its own directory (`openspec/changes/`) containing proposal, specs, design, and tasks. When complete, changes are archived and specs are synced. This maps to our workspace model — each workspace IS a change folder.

**Verdict:** Delta specs are the key insight. For brownfield work, planning agents should describe what changes rather than restating the world. The lightweight approach for small issues is also valuable — not everything needs a full vBRIEF plan.

---

#### Taskmaster (`eyaltoledano/claude-task-master`)

The most popular AI task management tool (25K+ stars). Most relevant concepts:

**Complexity scoring:**
AI scores each task 1-10 and recommends which tasks need further decomposition before work starts. Our beads have a `difficulty` metadata field (trivial/simple/medium/complex/expert) but it's set by the planning agent without validation. Taskmaster's approach of scoring AND recommending decomposition for high-complexity tasks would improve plan quality.

**Automatic task decomposition:**
High-complexity tasks auto-decompose into subtasks with file references and acceptance criteria. We could add a gate: if a bead's complexity exceeds a threshold, require it to be decomposed into sub-beads before work begins.

**Tagged task lists:**
Separate task contexts for different branches/phases. Maps to our workspace model but could inform multi-workspace coordination — seeing task state across all active workspaces.

**Verdict:** Complexity scoring with decomposition gates is the highest-value takeaway. Prevents the "one monster bead that takes 2 hours" problem.

---

#### Agent OS (`buildermethods/agent-os`)

Convention enforcement via standards discovery. Most relevant concepts:

**Standards discovery:**
Analyzes existing codebase and extracts patterns/conventions into documented standards. We have CLAUDE.md but it's manually maintained. Automated discovery would keep conventions current.

**Standards injection via index:**
Uses an `index.yml` to match relevant standards to the current task, injecting only what's needed rather than the full CLAUDE.md. This is smart context management — our work agents get the full CLAUDE.md regardless of what they're working on.

**Profiles:**
Named collections of standards for different contexts. Maps to our per-project `.panopticon.yaml` but could be more granular — different standard sets for frontend vs backend vs infrastructure work.

**Verdict:** Standards injection with contextual filtering is the key concept. We already have the per-project config structure; adding intelligent context filtering would reduce prompt bloat.

---

#### BMAD Method (`bmad-code-org/BMAD-METHOD`)

Full Agile AI lifecycle. Most relevant concepts:

**Story lifecycle with mandatory quality gates:**
`drafted → ready-for-dev → in-progress → review → validating → validated → done`

Every transition has a gate. Our lifecycle has fewer gates (planning → work → review → test → merge) but the key insight is the `ready-for-dev` gate — validating that a story is implementable BEFORE assigning to a developer agent.

**Implementation Readiness Check (IR):**
Before development starts, verify: acceptance criteria are specific and testable, dependencies are resolved, architecture is understood, test strategy is defined. This is the "spec readiness" gate we're missing.

**Specialized agent personas:**
21+ agents with distinct roles (Analyst, PM, Architect, UX Designer, Scrum Master, Developer, QA). Our Cloister has work/review/test/merge agent types but could benefit from more specialized planning agents.

**Dev Loop automation:**
Within a story, the developer agent follows an autonomous loop: implement → self-verify → iterate until all ACs pass. Then hands off to review. Our work agents do this informally but it's not enforced.

**Verdict:** The Implementation Readiness Check is the killer feature for us. A formal gate between planning and work that validates AC quality, dependency resolution, and test strategy would prevent the most common planning failures.

---

### 1.3 Comparative Matrix

| Capability | Pan Today | vBRIEF | Deft | Superpowers | Spec Kit | OpenSpec | Taskmaster | Agent OS | BMAD |
|------------|----------|--------|------|-------------|----------|---------|------------|----------|------|
| Structured plan format | Yes | Core | Uses vBRIEF | Plans in md | Markdown | Markdown | tasks.json | N/A | YAML+md |
| DAG dependencies | Yes | Core | Via edges | Sequential | Sequential | None | ID refs | None | Story deps |
| Token efficiency | No | TRON | No | No | No | No | No | No | No |
| Spec readiness gate | No | No | No | No | Phase gates | No | Complexity score | No | IR Check |
| Complexity scoring | Partial | No | No | No | No | No | Core | No | No |
| Contract verification | No | No | Core | No | No | No | No | No | No |
| 2-stage review | No | No | 4-tier | Core | No | No | No | No | Gates |
| Standards injection | No | No | Layered | No | No | No | No | Core | No |
| Delta specs | No | No | No | No | No | Core | No | No | No |
| Spec drift detection | No | No | No | No | Canon | No | No | No | No |
| Retrospectives | No | Built-in | Meta files | No | No | No | No | No | Possible |
| Stub detection | No | No | Core | No | No | No | No | No | No |
| Auto decomposition | No | No | No | Bite-sized | No | No | Core | No | No |
| Brownfield-first | Yes | Neutral | Map strategy | No | Weak | Core | Neutral | Core | Added later |

---

## Part 2: Enhancement Proposal

### 2.1 Design Principles

Before listing features, the principles that should guide adoption:

1. **Graduated adoption** — like vBRIEF's graduated complexity, enhancements should be opt-in layers, not mandatory ceremony. A trivial bug fix shouldn't require a spec readiness check.
2. **Data format continuity** — vBRIEF remains the plan format. New capabilities extend it via metadata and narratives, not by replacing it.
3. **Beads stays the execution layer** — beads is the task tracker. Enhancements improve the vBRIEF→beads bridge, not replace it.
4. **Brownfield-first** — 90%+ of work is modifying existing code. Every feature must work well for brownfield.
5. **Token-aware** — context window is precious. Features that add prompt content must justify their token cost.

---

### 2.2 Proposed Enhancements (Prioritized)

#### Enhancement 1: Implementation Readiness Gate (from BMAD + Taskmaster)

**Problem:** Plans can be finalized with vague ACs, unrealistic scope, or unresolved dependencies. Work agents discover these issues mid-implementation, wasting time and tokens.

**What:** A validation gate between `pan plan` and `pan plan finalize` that checks:

- [ ] Every item has at least one AC subItem with `metadata.kind: "acceptance_criterion"`
- [ ] ACs are testable (heuristic: contains a verb + observable outcome, not just "improved X")
- [ ] Complexity scores are present and items above threshold are decomposed
- [ ] DAG edges form a valid acyclic graph (already checked, but surface errors clearly)
- [ ] No stub items (items with generic titles like "Implement feature" without specifics)
- [ ] External dependencies are noted in narratives

**How:** Add a `validatePlanReadiness()` function in `src/lib/vbrief/` that runs these checks and returns a structured report. `pan plan finalize` calls this before `createBeadsFromVBrief()`. Failures block finalization with actionable feedback. Planning agent can re-invoke planning to fix issues.

**Graduated complexity:** For issues tagged `trivial` or `simple` in the issue tracker, reduce requirements (e.g., skip complexity scoring, allow fewer ACs).

**Source inspiration:** BMAD's Implementation Readiness Check, Taskmaster's complexity scoring.

---

#### Enhancement 2: Complexity-Gated Decomposition (from Taskmaster)

**Problem:** Some beads are too large. A "complex" bead can take 60+ minutes and produce a massive diff that's hard to review. No mechanism forces decomposition.

**What:** After the planning agent sets `metadata.difficulty` on each item:

1. Items scored `complex` or `expert` trigger a decomposition advisory
2. The planning agent must either decompose into sub-items OR provide a `narrative.JustifyComplexity` explaining why it can't be split
3. Items scored `expert` MUST be decomposed — no override

**How:** Add to `validatePlanReadiness()`. When a complex item lacks sub-items and lacks justification, the validation fails with: "Item '{title}' is scored complex but has no sub-items. Decompose it or add a JustifyComplexity narrative."

**Source inspiration:** Taskmaster's complexity scoring + auto-decomposition.

---

#### Enhancement 3: Two-Stage Review (from Superpowers)

**Problem:** Our review agent evaluates spec compliance and code quality simultaneously. Spec compliance failures (missing ACs, wrong behavior) get buried under style/quality feedback. Agents fix the style issues and miss the spec issues.

**What:** Split review into two sequential passes:

1. **Spec Compliance Review** — Does the diff implement what the vBRIEF says? Are all ACs met? Is there over-building (features not in the spec)? Is there under-building (ACs not addressed)?
2. **Code Quality Review** — Only runs if spec compliance passes. Covers: correctness, performance, security, maintainability.

**How:** This maps to our existing specialist pipeline. Today: `review → test → merge`. Proposed: `spec-review → code-review → test → merge`. The spec-review agent gets the vBRIEF plan + diff and ONLY checks AC fulfillment. The code-review agent gets the diff and checks quality. Both must pass before test.

We already have `code-review-requirements` and `code-review-correctness` prompt templates. The change is to make requirements review a hard gate that blocks quality review, rather than running them as parallel concerns in a single review.

**Source inspiration:** Superpowers' two-stage review (spec compliance first, code quality second).

---

#### Enhancement 4: Contract Verification Between Beads (from Deft)

**Problem:** When bead B depends on bead A (via a `blocks` edge), there's no verification that bead A actually produced what bead B needs. Bead B's agent discovers missing exports/APIs at implementation time.

**What:** Add a `produces` / `consumes` contract to vBRIEF items:

```json
{
  "id": "auth-middleware",
  "title": "Add auth middleware",
  "metadata": { "difficulty": "medium" },
  "narrative": {
    "Action": "Create Express middleware for JWT validation",
    "Produces": "src/middleware/auth.ts → verifyToken(), requireAuth()",
    "Consumes": ""
  }
}
```

```json
{
  "id": "protected-routes",
  "title": "Add protected API routes",
  "narrative": {
    "Consumes": "src/middleware/auth.ts → requireAuth()"
  }
}
```

When bead A closes, before bead B becomes `ready`, verify that the `Produces` exports actually exist in the codebase (static check: grep for exported symbols).

**How:** Add contract narratives to the planning agent prompt. Add a `verifyContracts()` function that runs after a bead closes and before its dependents become ready. Uses AST-free grep-based verification (check that the symbol name appears as an export in the specified file).

**Graduated complexity:** Only enforce for items with explicit `Produces`/`Consumes` narratives. Don't require them on every item.

**Source inspiration:** Deft's boundary maps / contract verification.

---

#### Enhancement 5: Strategy Selection (from Deft)

**Problem:** Every issue gets the same planning treatment regardless of size, type, or context. A one-line bug fix gets a full vBRIEF plan with DAG edges. A massive feature gets the same template as a small refactor.

**What:** Add work-type-aware planning strategies:

| Strategy | Trigger | Planning Output |
|----------|---------|----------------|
| **direct** | `trivial` issues, bug fixes with known root cause | No vBRIEF plan. Single bead created directly from issue description. Skip `pan plan` entirely. |
| **light** | `simple` issues, small features | Minimal vBRIEF: title, status, items with ACs. No DAG edges needed (sequential execution). |
| **standard** | `medium` issues (default) | Full vBRIEF with items, ACs, edges, narratives. Current behavior. |
| **deep** | `complex`/`expert` issues, multi-file features | Full vBRIEF + contracts + architecture narrative + risk assessment. Requires decomposition. |

**How:** Add strategy metadata to `plan.vbrief.json`:
```json
"vBRIEFInfo": {
  "version": "0.5",
  "metadata": { "strategy": "light" }
}
```

Cloister selects strategy based on issue labels/size. Planning agent prompt varies by strategy. `validatePlanReadiness()` adjusts requirements per strategy.

For `direct` strategy: `pan plan finalize` creates a single bead from the issue title + description without requiring a vBRIEF plan at all. This eliminates ceremony for trivial fixes.

**Source inspiration:** Deft's 6+ strategies (interview, yolo, speckit, map, discuss, research).

---

#### Enhancement 6: Delta Specs for Brownfield (from OpenSpec)

**Problem:** Planning agents write plans that describe the full desired state rather than the delta. For brownfield work, this means restating existing functionality alongside changes, wasting tokens and creating confusion about what's actually new.

**What:** Add a `Delta` narrative convention for brownfield items:

```json
{
  "id": "refactor-auth",
  "title": "Refactor auth to use JWT",
  "narrative": {
    "Delta": "MODIFY src/middleware/auth.ts: Replace session-based auth with JWT. ADD src/lib/jwt.ts: Token generation and validation. REMOVE src/middleware/session.ts: No longer needed.",
    "Action": "Replace session-based authentication with stateless JWT tokens"
  }
}
```

The `Delta` narrative uses a structured format: `MODIFY|ADD|REMOVE <path>: <description>`. This tells the work agent exactly what files change and how, without restating the entire codebase context.

**How:** Update planning agent prompts to prefer Delta narratives for brownfield work. Add a planning prompt section: "For changes to existing code, use the Delta narrative format to describe what changes rather than restating the full desired state." No code changes needed — this is a prompt convention that uses existing vBRIEF narrative extensibility.

**Source inspiration:** OpenSpec's delta specs.

---

#### Enhancement 7: Contextual Standards Injection (from Agent OS)

**Problem:** Work agents receive the full CLAUDE.md regardless of what they're working on. Frontend work gets backend conventions in context. Infrastructure work gets UI guidelines. This wastes tokens and can confuse agents.

**What:** Index CLAUDE.md sections and project conventions by domain. Inject only relevant sections based on the files being modified.

**How:** Create a lightweight `standards-index.yaml` in `.panopticon/`:

```yaml
domains:
  frontend:
    patterns: ["src/dashboard/frontend/**", "*.tsx", "*.css"]
    standards:
      - React 19 patterns
      - Tailwind conventions
      - Component naming
  backend:
    patterns: ["src/lib/**", "src/cli/**", "*.ts"]
    standards:
      - TypeScript conventions
      - Error handling patterns
      - Database access patterns
  infra:
    patterns: ["Dockerfile", "docker-compose*", ".github/**"]
    standards:
      - Container conventions
      - CI/CD patterns
```

When Cloister builds the work agent prompt, it reads the plan's file references (from Delta narratives or item descriptions), matches against the index, and injects only relevant standards sections. Falls back to full CLAUDE.md if no match.

**Graduated complexity:** This is opt-in per project. Projects without a `standards-index.yaml` get the current behavior.

**Source inspiration:** Agent OS's standards injection with index-based matching.

---

#### Enhancement 8: Spec Drift Detection (from Spec Kit)

**Problem:** After implementation and merge, we archive the vBRIEF and never look at it again. If the implementation diverged from the plan (features added without AC updates, ACs not fully implemented but marked done), we don't catch it.

**What:** Post-merge, run a drift detection pass that compares the merged diff against the vBRIEF plan:

1. Extract all ACs from the archived vBRIEF
2. For each AC, search the diff for evidence of implementation
3. Flag ACs with no corresponding changes (potential gaps)
4. Flag significant changes with no corresponding AC (potential scope creep)
5. Write findings to a `drift-report` narrative in the archived vBRIEF

**How:** Add a `detectSpecDrift()` function in `src/lib/vbrief/`. Run it during the post-merge archive workflow (`src/lib/lifecycle/workflows.ts`). Results are informational, not blocking — drift detection is for learning, not gating.

Over time, drift reports feed into planning quality metrics: "Planning agent X has 15% drift rate" vs "Planning agent Y has 3% drift rate."

**Source inspiration:** Spec Kit's canon/drift detection.

---

#### Enhancement 9: Structured Retrospectives (from vBRIEF + Deft)

**Problem:** Completed work generates no structured learning. The same mistakes repeat across issues. Agent performance isn't tracked in a way that improves future work.

**What:** After merge, capture a retrospective in the archived vBRIEF using standard narrative keys:

```json
"narratives": {
  "Outcome": "Implemented in 3 beads, 2 review cycles. Total agent time: 45 min.",
  "Strengths": "Clean decomposition, all ACs met on first review.",
  "Weaknesses": "Bead 2 was too large (35-min implementation). Should have been split.",
  "Lessons": "Auth middleware changes require both unit and integration tests. Planning underestimated scope.",
  "DriftScore": "0.95 (1 minor addition not in spec)"
}
```

**How:** Add a retrospective step to the post-merge workflow. An agent (or automated analysis) reviews the work history (bead close times, review cycles, drift report) and generates retrospective narratives. Store in the archived vBRIEF.

Feed retrospective data into planning: "Previous auth-related work took 2x estimated time. Adjust estimates for this issue."

**Source inspiration:** vBRIEF's built-in retrospective narratives (Outcome, Strengths, Weaknesses, Lessons), Deft's meta/lessons.md.

---

#### Enhancement 10: Verification-Before-Completion Enforcement (from Superpowers)

**Problem:** Work agents sometimes claim completion without running verification. "This should work" instead of "I ran the tests and they pass." The `pan done` preflight catches some issues but only after the agent has declared done.

**What:** Add verification enforcement to the work agent prompt and Cloister monitoring:

1. **Prompt-level:** Add anti-rationalization patterns to work prompts: "Before closing a bead, you MUST run the project's test suite and report the results. Red flags that indicate insufficient verification: 'should work', 'probably fixed', 'I'm confident it works'. These phrases without accompanying test output are NOT acceptable."

2. **Cloister-level:** After a `bd close` event, Cloister checks the agent's recent output for verification evidence (test command output, build output). If none found, inject a reminder: "You closed bead {id} without visible verification. Run tests before proceeding."

**How:** Update `work.md` prompt template with verification requirements. Add a post-bead-close hook in Cloister's output monitoring that checks for test evidence.

**Source inspiration:** Superpowers' verification-before-completion with anti-rationalization red flags.

---

#### Enhancement 11: TRON Encoding for Agent Context (from vBRIEF)

**Problem:** When injecting plan context into work/review agent prompts, we use full JSON. For large plans, this consumes significant context window.

**What:** Convert vBRIEF plans to TRON encoding when injecting into agent prompts. TRON saves 35-40% tokens while preserving all semantics.

**How:** Add a `toTRON()` function in `src/lib/vbrief/` that converts a vBRIEF JSON plan to TRON notation. Cloister calls this when building agent prompts. The agent receives TRON-encoded plan context. Agents can already parse TRON (it's designed for LLM consumption).

```tron
class Item: id, title, status, difficulty
class AC: title, status
class Edge: from, to, type

plan: {
  id: "pan-436"
  title: "Dashboard skeleton loading states"
  status: "approved"
  items: [
    Item("skeleton-component", "Create skeleton component library", "pending", "medium")
    Item("page-integration", "Integrate skeletons into pages", "pending", "simple")
  ]
  edges: [
    Edge("skeleton-component", "page-integration", "blocks")
  ]
}
```

**Source inspiration:** vBRIEF's TRON encoding specification.

---

#### Enhancement 12: Stub Detection as Pre-Review Gate (from Deft)

**Problem:** Work agents sometimes leave placeholder implementations (TODO comments, empty function bodies, hardcoded return values) that pass type checking but aren't real implementations. Review agents catch some but not all.

**What:** Add automated stub detection before review begins:

Scan the diff for:
- `TODO`, `FIXME`, `HACK`, `XXX` comments (excluding pre-existing ones)
- `return null`, `return undefined`, `return {}`, `return []` in new code
- Functions under ~5 lines that return hardcoded values
- `throw new Error('not implemented')`
- `console.log` / `console.warn` left as debugging artifacts

**How:** Add a `detectStubs()` function that analyzes the git diff. Run it as part of `pan done` preflight, alongside `checkOpenBeads()` and `checkVBriefACStatus()`. Stubs block the done transition with specific feedback: "Found stub at src/lib/auth.ts:42 — `return null` in verifyToken(). Implement before proceeding."

**Source inspiration:** Deft's stub detection patterns.

---

### 2.3 Implementation Roadmap

Grouped into phases based on impact, dependencies, and effort:

#### Phase 1: Planning Quality (First Priority)

These enhancements improve what happens BEFORE work begins — highest ROI because they prevent waste.

| # | Enhancement | Effort | Impact |
|---|-------------|--------|--------|
| 1 | Implementation Readiness Gate | Medium | High — prevents bad plans from reaching work agents |
| 2 | Complexity-Gated Decomposition | Small | High — prevents oversized beads |
| 5 | Strategy Selection | Medium | High — eliminates ceremony for trivial work |
| 6 | Delta Specs for Brownfield | Small | Medium — prompt-only change, no code |

**Deliverables:**
- `src/lib/vbrief/readiness.ts` — `validatePlanReadiness()` function
- Updated planning agent prompts with strategy awareness and delta spec convention
- `pan plan finalize` calls readiness validation before bead creation
- `direct` strategy path that skips vBRIEF for trivial issues

#### Phase 2: Execution Quality (After Phase 1)

These enhancements improve what happens DURING work — tighter feedback loops, fewer review cycles.

| # | Enhancement | Effort | Impact |
|---|-------------|--------|--------|
| 4 | Contract Verification | Medium | Medium — prevents cross-bead failures |
| 10 | Verification-Before-Completion | Small | High — prompt-only change + light monitoring |
| 12 | Stub Detection | Small | Medium — catches lazy implementations |

**Deliverables:**
- Contract narrative convention in planning prompts
- `src/lib/vbrief/contracts.ts` — `verifyContracts()` function
- Updated `work.md` with verification enforcement
- `src/lib/vbrief/stubs.ts` — `detectStubs()` in preflight

#### Phase 3: Review Quality (After Phase 2)

These enhancements improve what happens DURING review — more focused, actionable feedback.

| # | Enhancement | Effort | Impact |
|---|-------------|--------|--------|
| 3 | Two-Stage Review | Medium | High — separates spec compliance from code quality |
| 7 | Contextual Standards Injection | Medium | Medium — reduces prompt bloat, improves relevance |

**Deliverables:**
- New `spec-review` specialist type in Cloister
- Updated specialist pipeline: `spec-review → code-review → test → merge`
- `standards-index.yaml` format and injection logic in Cloister prompt builder

#### Phase 4: Learning Loop (After Phase 3)

These enhancements close the feedback loop — learning from completed work to improve future work.

| # | Enhancement | Effort | Impact |
|---|-------------|--------|--------|
| 8 | Spec Drift Detection | Medium | Medium — catches plan/implementation divergence |
| 9 | Structured Retrospectives | Medium | Medium — accumulates organizational learning |
| 11 | TRON Encoding | Small | Small — token savings, nice-to-have |

**Deliverables:**
- `src/lib/vbrief/drift.ts` — `detectSpecDrift()` function
- Post-merge workflow step for retrospective generation
- `src/lib/vbrief/tron.ts` — `toTRON()` encoder
- Retrospective narrative injection into planning context

---

### 2.4 What We're NOT Adopting (and Why)

| Concept | Source | Why Not |
|---------|--------|---------|
| Fresh agent per task (SDD) | Superpowers | Token-expensive. Our agent reuse within a workspace is more economical. Panopticon's strength is agent lifecycle management — starting fresh agents per bead would multiply costs. |
| 21+ specialized personas | BMAD | Over-engineering. Our 4 specialist types (work, review, test, merge) cover the pipeline. Adding PM, Architect, UX Designer, QA, Scrum Master personas adds ceremony without value for our scale. |
| Rigid 4-phase gates | Spec Kit | Conflicts with graduated complexity. Forcing Specify→Plan→Tasks→Implement on a bug fix is waste. Strategy selection (Enhancement 5) achieves the same quality without the rigidity. |
| YAML workflow pipelines | Spec Kit | Our lifecycle is code, not config. YAML pipelines add indirection. If we need configurability, we'll add it to Cloister's TypeScript lifecycle, not a new YAML DSL. |
| Full Agile ceremonies | BMAD | Panopticon is a tool for developers, not a project management methodology. Sprint planning, story points, and standup ceremonies don't map to AI agent orchestration. |
| TDD enforcement | Superpowers | We already have test specialists. Forcing RED-GREEN-REFACTOR on work agents would slow implementation. Our review+test specialists catch quality issues post-implementation. |
| Standards discovery | Agent OS | Interesting but premature. Our CLAUDE.md is manually maintained and that's fine for now. Automated convention extraction is a future enhancement once we have more projects. |

---

### 2.5 Success Metrics

How we'll know these enhancements are working:

| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| Planning failures caught before work | ~0% (no readiness gate) | >80% of plan issues caught at finalization |
| Review cycles per issue | ~2.1 (typical: pass on 2nd review) | <1.5 (spec compliance caught earlier) |
| Bead implementation time variance | High (some beads 5 min, some 60 min) | Reduced (complex beads decomposed) |
| Spec drift rate | Unknown (not measured) | <10% of items with significant drift |
| Agent verification compliance | ~70% (agents sometimes skip tests) | >95% (verification enforced in prompts) |
| Stub detection rate | 0% (no detection) | >90% of stubs caught before review |
| Token efficiency of plan context | Baseline (JSON) | 35-40% reduction (TRON) |

---

### 2.6 Architecture Impact

These enhancements touch the following Panopticon subsystems:

```
src/lib/vbrief/
  ├── readiness.ts      (NEW — Enhancement 1, 2)
  ├── contracts.ts      (NEW — Enhancement 4)
  ├── stubs.ts          (NEW — Enhancement 12)
  ├── drift.ts          (NEW — Enhancement 8)
  ├── tron.ts           (NEW — Enhancement 11)
  ├── beads.ts          (MODIFY — readiness gate before creation)
  └── types.ts          (MODIFY — add strategy, contract narrative types)

src/lib/cloister/
  ├── prompts/
  │   ├── work.md           (MODIFY — verification enforcement, delta specs)
  │   ├── planning.md       (MODIFY — strategy selection, complexity scoring)
  │   └── review/
  │       └── spec-review.prompt-template.md  (NEW — Enhancement 3)
  └── lifecycle.ts          (MODIFY — add spec-review specialist step)

src/cli/commands/
  └── plan-finalize.ts      (MODIFY — add readiness validation call)

src/lib/lifecycle/
  └── workflows.ts          (MODIFY — add drift detection + retrospective to post-merge)

.panopticon/
  └── standards-index.yaml  (NEW — Enhancement 7, per-project)
```

No database schema changes. No new CLI commands (enhancements integrate into existing `pan plan finalize`, `pan done`, and specialist pipeline). No breaking changes to the vBRIEF format (all additions use existing extensibility: metadata fields and custom narrative keys).

---

## Appendix A: Tool Reference

| Tool | Repo | Local Path | License |
|------|------|-----------|---------|
| vBRIEF | github.com/vbrief (inferred) | `/home/eltmon/Projects/vbrief/` | Open |
| Deft Directive | github.com (inferred) | `/home/eltmon/Projects/deft/` (also at `/home/eltmon/Projects/Deft/directive/` — same content) | Open |
| Superpowers | github.com/obra/superpowers | `/home/eltmon/Projects/superpowers/` | MIT |
| Spec Kit | github.com/github/spec-kit | Not cloned | MIT |
| OpenSpec | github.com/Fission-AI/OpenSpec | Not cloned | MIT |
| Taskmaster | github.com/eyaltoledano/claude-task-master | Not cloned | MIT |
| Agent OS | github.com/buildermethods/agent-os | Not cloned | Open |
| BMAD Method | github.com/bmad-code-org/BMAD-METHOD | Not cloned | Open |

## Appendix B: Key Sources

- vBRIEF spec v0.5: `/home/eltmon/Projects/vbrief/vbrief-spec-0.5.md`
- Deft specification: `/home/eltmon/Projects/deft/SPECIFICATION.md`
- Superpowers skills: `/home/eltmon/Projects/superpowers/skills/`
- Panopticon vBRIEF integration: `src/lib/vbrief/beads.ts`, `src/lib/vbrief/io.ts`
- Panopticon current pipeline: `docs/VBRIEF.md`, `docs/HIERARCHICAL-PLANNING.md`
- Martin Fowler on SDD tools: martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- Spec Kit docs: github.github.com/spec-kit/
- OpenSpec docs: openspec.dev
- Taskmaster docs: docs.task-master.dev
- Agent OS docs: buildermethods.com/agent-os
- BMAD docs: docs.bmad-method.org
