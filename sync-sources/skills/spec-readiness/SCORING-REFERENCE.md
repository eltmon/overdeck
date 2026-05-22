# Spec Readiness — Scoring Reference

This file contains detailed scoring criteria, deduction examples, and calibration data.
Subagents read this file to score individual dimensions.

## Scoring Baseline

For each dimension, start at **15** (baseline "decent" score), apply deductions for negative findings and bonuses for positive findings, then clamp to 0-20.

Record each finding with:
- **Finding text** — what was observed
- **Impact** — points added or deducted
- **Source** — traceability (e.g., "Issue description", "Comment by @dev on Jan 15", "Child issue #42 created 4 weeks after initial batch", "Edit #17 on Oct 15")
- **Recommendation** — what to do about it (if deduction)

---

## Dimension 1: Requirements Clarity (0-20)

*"Is the spec complete and unambiguous?"*

### Scoring Guide

| Points | Criteria |
|--------|----------|
| 16-20 | Description reads as a locked spec. No open questions. ON/OFF/edge behaviors documented. Validation rules explicit. No conflicting text. |
| 11-15 | Most requirements documented. Minor open questions remain. Description is mostly stable. |
| 6-10 | Multiple open questions, TBD markers, or "needs confirmation" items. Description reads like meeting notes. High edit churn. |
| 0-5 | Description is a placeholder or contains conflicting information. Major behaviors undefined. |

### What to Check

1. **Open question markers** in description and notes:
   - Literal "?" in requirement statements (not just punctuation)
   - "TBD", "TODO", "needs confirmation", "open question", "to be determined"
   - "needs discussion", "to be decided", "pending", "awaiting"
   - Strikethrough text (HTML `<s>`, `<strike>`, `<del>`, `text-decoration:line-through`, markdown `~~`)
   - Highlighting (yellow/green background — inline Q&A, not a finished spec)
   - Square brackets: `[?]`, `[TBD]`, `[OPEN]`

2. **Description edit history** (if available from tracker):
   - < 10 edits: Normal (neutral)
   - 10-30 edits: Moderate churn (minor deduction)
   - 30+ edits: High churn — spec is a living document, not locked (major deduction)
   - **Late edits** (after first child issue moves to In-Progress): Each late description change = deduction. Requirements changing during development is the #1 risk signal.

3. **External documents**:
   - Scan description for links to PRD, BRD, spec documents (Google Docs, Confluence, SharePoint, Notion, attached files)
   - Check issue attachments for documents
   - If found: bonus points. If attached AFTER development started (check edit history for when attachment was added vs. when first child moved to In-Progress): reduced bonus.
   - If a URL is accessible, use WebFetch to analyze coverage and cross-reference with description for gaps. Note: WebFetch may fail on authenticated URLs.

4. **Discussion threads / comments** — scan for requirement questions asked after work began:
   - "Where can I find...", "How should we handle...", "What happens when..."
   - Questions from developers (not product) indicate requirements gaps
   - Each requirement question during active development = deduction

5. **Child issue descriptions** — spot-check for acceptance criteria:
   - Issues with only a title and no description: deduction
   - Issues with description but no testable acceptance criteria: minor deduction
   - "Given/When/Then" or explicit acceptance criteria: bonus

### Deduction Examples
- Each unresolved open question: -2 pts
- Description has 30+ edits: -3 pts
- Description changed after dev started: -2 pts per significant change
- No PRD/BRD attached (if customer-directed): -2 pts
- PRD attached after dev started: -1 pt
- >50% of child issues lack acceptance criteria: -3 pts

---

## Dimension 2: Technical Discovery (0-20)

*"Have the technical unknowns been investigated?"*

### Scoring Guide

| Points | Criteria |
|--------|----------|
| 16-20 | Spike/investigation completed and accepted BEFORE implementation started. Repos, DB schema, APIs all identified. Team familiarity acknowledged with buffer. |
| 11-15 | Investigation exists but ran alongside implementation. Some technical details identified. |
| 6-10 | No investigation, or investigation is incomplete. Minimal technical discovery. |
| 0-5 | No technical discovery at all. Estimate is a business number. Team unfamiliarity not acknowledged. |

### What to Check

1. **Spike / investigation issues** among children:
   - Look for issues with "SPIKE", "spike", "Spike", "investigation", "analysis", "discovery", "POC", "prototype" in the name (plus any custom patterns from wrapper config `conventions.spike_patterns`)
   - Check if spike is Accepted/Completed BEFORE the earliest implementation issue moves to In-Progress
   - Spike completed after implementation started = not gating, deduction
   - No spike at all = major deduction
   - Multiple spikes (insufficient first attempt, had to redo) = deduction for spike quality

2. **Technical detail in description**:
   - Mentions of specific repositories, file paths, class names: bonus
   - Mentions of specific database tables or schema: bonus
   - Mentions of specific API endpoints or services: bonus
   - Generic/vague references ("update the system"): no bonus

3. **Team familiarity signals** in description/notes:
   - "Team is learning", "new codebase", "old system", "legacy": risk acknowledged (neutral if buffer applied, deduction if no buffer)
   - No mention when the work touches unfamiliar code: deduction

4. **Estimation**:
   - Estimate field populated: neutral (estimate exists)
   - No estimate: deduction
   - Estimate set before investigation completed: deduction (estimate preceded discovery)

5. **Infrastructure issues** among children:
   - Look for issues mentioning "database", "schema", "migration", "table", "infrastructure", "permissions", "settings"
   - Sequenced early (low issue number, early sprint)? Bonus.
   - Added late (created weeks after initial batch)? Deduction — infrastructure was an afterthought.

### Deduction Examples
- No spike/investigation issue: -8 pts
- Spike not accepted before implementation started: -4 pts
- Investigation had to be redone (insufficient first attempt): -3 pts
- No specific repos/tables/endpoints in description: -3 pts
- No estimate: -2 pts
- Infrastructure issues added late: -3 pts
- Team familiarity risk not acknowledged: -2 pts

---

## Dimension 3: Scope & Decomposition (0-20)

*"Is the issue right-sized with clear boundaries?"*

### Scoring Guide

| Points | Criteria |
|--------|----------|
| 16-20 | Explicit "in scope" / "out of scope" statements. Issue is a single coherent deliverable. Child count reasonable. No overflow markers. |
| 11-15 | Scope mostly clear. "Out of scope" not explicitly stated. Slightly large but manageable. |
| 6-10 | Overloaded (multiple work streams). Notes suggest splitting but it wasn't done. |
| 0-5 | No scope definition. Issue is a catch-all. Already has overflow markers. |

### What to Check

1. **Issue name overflow markers** (configurable via wrapper `conventions.overflow_markers`):
   - Default patterns: `[Unfinished]`, `[Continued]`, `[Carry-over]`, `[Part N]`
   - These mean the issue was NOT right-sized from the start. Major deduction.

2. **Child issue count vs. timeline**:
   - Determine the planned duration (milestone/cycle dates, or sprint count)
   - Calculate child issues per sprint
   - > 8 issues per sprint: Red flag (overloaded)
   - > 20 total children for a single cycle: Deduction
   - > 30 total children: Major deduction

3. **Decomposition signals** in description/notes:
   - "Break this up", "split into", "multiple issues/features": If this advice exists but wasn't followed = major deduction
   - "Phase 1", "Phase 2": Acknowledged phasing is positive
   - "Out of scope", "not included", "explicitly excluded": Bonus for scope clarity

4. **Child issue carryover**:
   - Count children with overflow markers in their names
   - Each carried-over issue = evidence of underestimation
   - Carryover rate > 30%: Major deduction

5. **Scope creep signals** (from edit history or child creation dates):
   - New requirements added after initial description (look for "New Requirement", "added requirement", "additional scope" in edit descriptions)
   - Child issues created significantly later than the initial batch (check CreationDate spread)
   - Late-created children suggest scope was discovered, not planned

### Deduction Examples
- Overflow markers in issue name: -6 pts
- >20 children for a single cycle: -3 pts
- Notes say "break into N issues" but it wasn't done: -5 pts
- No "out of scope" statement: -2 pts
- >30% child carryover rate: -4 pts
- Scope added after initial description: -2 pts per addition

---

## Dimension 4: Dependencies & Prerequisites (0-20)

*"Is the critical path mapped?"*

### Scoring Guide

| Points | Criteria |
|--------|----------|
| 16-20 | Issue dependencies tracked in the tracker. External dependencies identified. Prerequisites all accounted for before dev starts. |
| 11-15 | Key dependencies documented informally (in descriptions). Most prerequisites identified. |
| 6-10 | Dependencies exist but aren't tracked. Some prerequisites discovered after work started. |
| 0-5 | No dependency mapping. Issues treated as independent backlog. Prerequisites discovered during sprints. |

### What to Check

1. **Formal dependency links** (blocking/blocked-by relations in tracker):
   - Check each child issue for dependency links (predecessors/successors, blocking/blocked-by relations)
   - Any formal links: Bonus
   - Zero links across all children: Major deduction

2. **Implicit dependency signals** in descriptions:
   - "Depends on", "requires", "blocked by", "after X is done", "prerequisite"
   - These indicate dependencies exist but aren't formally tracked

3. **Questions about prerequisites** in comments/discussions:
   - "Where can I find the [X] ID?" — External ID prerequisite not identified
   - "Does [object] have an external identifier?" — Data prerequisite missed
   - "Which repo is this in?" — Code location not identified
   - Each such question during active development = deduction

4. **Foundation issue sequencing**:
   - Are DB/settings/permissions issues early in the sequence?
   - Or were they added after other issues started? (Check creation dates)
   - Foundation work added late = infrastructure prerequisites missed

5. **External integration points**:
   - Does the description mention other systems, APIs, teams, or repos?
   - Are those reflected in child issues?
   - Missing integration issues = deduction

### Deduction Examples
- Zero formal dependency links across all children: -6 pts
- Prerequisite discovered during sprint (evidence in comments): -3 pts each
- Foundation issues added after initial batch: -3 pts
- External integration mentioned but no corresponding issue: -3 pts
- No external dependencies documented (when issue clearly has them): -4 pts

---

## Dimension 5: Edge Cases & Test Strategy (0-20)

*"Are failure modes documented?"*

### Scoring Guide

| Points | Criteria |
|--------|----------|
| 16-20 | Error paths documented (missing config, null values, partial setup). Test scenarios enumerated. QA strategy defined. Acceptance criteria are testable. |
| 11-15 | Happy path well-defined. Some edge cases mentioned. Test issue exists. |
| 6-10 | Only happy path documented. No "what if" scenarios. Testing is an afterthought. |
| 0-5 | No edge case discussion. No test strategy. Assumptions stated without validation. |

### What to Check

1. **Edge case language** in description/notes:
   - "What if", "when missing", "if not configured", "null", "empty", "partial"
   - "Error handling", "fallback", "default behavior"
   - These indicate failure modes were considered

2. **Assumptions without test coverage**:
   - Look for "Assumption:", "We assume", "Expected:", "Must have"
   - For each assumption, check if a corresponding test case or edge case issue exists
   - Unvalidated assumptions = deduction

3. **Test issues** among children:
   - Look for issues with "QA", "test", "automation", "validate", "verify" in name
   - Created early (with implementation) = good. Created months later = afterthought.
   - Test issue with no work done late in the cycle = deduction

4. **Bugs already filed**:
   - Search for bugs linked to this issue's children
   - Bugs filed during development = edge cases discovered in execution (not design)
   - Bugs of the form "what happens when X is missing/null/not configured" = major deduction

5. **Acceptance criteria quality** on child issues:
   - Check if descriptions contain testable criteria
   - Criteria should be measurable: "When X, then Y" not "it should work correctly"
   - Rate: "good" (testable criteria), "weak" (vague criteria), "none" (no criteria)
   - >50% "none": Major deduction
   - >50% "good": Bonus

### Deduction Examples
- No edge case language in description: -4 pts
- Assumptions stated without validation plan: -2 pts each
- No test issues: -4 pts
- Test issue added as afterthought (late creation, no work done): -2 pts
- Bugs filed for "missing config" scenarios during dev: -3 pts
- >50% of children lack acceptance criteria: -4 pts

---

## JSON Sidecar Schema

The JSON sidecar must follow this structure:

```json
{
  "identifier": "MIN-704",
  "title": "Add Code Mode API discovery tools to MCP server",
  "project": "Mind Your Now",
  "milestone": "Q1 CY26",
  "owner": "Edward Becker",
  "score": 74,
  "maxScore": 100,
  "status": "Mostly Ready",
  "statusColor": "green",
  "assessmentDate": "2026-02-27",
  "tracker": "linear",
  "childIssueCount": 5,
  "dimensions": {
    "requirementsClarity": {
      "score": 17,
      "maxScore": 20,
      "summary": "One-line summary of findings",
      "findings": [
        {
          "finding": "Description of what was observed",
          "impact": -3,
          "source": "Traceability reference",
          "recommendation": "What to do about it"
        }
      ]
    },
    "technicalDiscovery": { "score": 0, "maxScore": 20, "summary": "", "findings": [] },
    "scopeDecomposition": { "score": 0, "maxScore": 20, "summary": "", "findings": [] },
    "dependencies": { "score": 0, "maxScore": 20, "summary": "", "findings": [] },
    "edgeCasesTestStrategy": { "score": 0, "maxScore": 20, "summary": "", "findings": [] }
  },
  "topBlockers": [
    "Actionable blocker 1 with point-improvement estimate",
    "Actionable blocker 2"
  ],
  "childAssessments": [
    {
      "identifier": "MIN-705",
      "title": "Child Issue Title",
      "status": "Backlog",
      "hasAcceptanceCriteria": true,
      "criteriaQuality": "good",
      "notes": ""
    }
  ],
  "externalDocuments": {
    "found": false,
    "type": null,
    "attachedDate": null,
    "devStartDate": null,
    "attachedBeforeDevStarted": null,
    "accessible": null,
    "notes": ""
  },
  "wrapper": null,
  "metadata": {
    "skillVersion": "2.0.0",
    "generatedBy": "spec-readiness",
    "methodology": "5-dimension scoring model"
  }
}
```

---

## Scoring Calibration Reference

The scoring model baseline was derived from post-mortem analysis of two significantly overrun features. Both traced their overruns to incomplete requirements at development start.

### Case 1 — Expected Score: ~42 (Partial / Risky)
- Quoted 20 days, actual 41.5+ days (+107% overrun)
- Requirements Clarity: ~7/20 (58+ description edits, open questions, BRD attached 4 months late, requirements changed during dev)
- Technical Discovery: ~8/20 (3 spikes but none gating, key repo not identified until week 5)
- Scope & Decomposition: ~12/20 (13 children reasonable, but "New Requirement" added mid-dev)
- Dependencies: ~5/20 (zero dependency links, investigation spike sat idle 3 months)
- Edge Cases: ~10/20 (QA issue exists but not started, validation rules debated during dev)

### Case 2 — Expected Score: ~35 (Not Ready)
- Planned 1 quarter, took 3 quarters (2.3x overrun)
- Requirements Clarity: ~8/20 (external ID prerequisite discovered after start)
- Technical Discovery: ~6/20 (team learning curve acknowledged but no buffer, no gating investigation)
- Scope & Decomposition: ~4/20 (notes said "split into 4 features" but it wasn't done, overflow to next quarter)
- Dependencies: ~7/20 (some implicit sequencing but no formal links)
- Edge Cases: ~10/20 (4 bugs for "missing config" scenarios, assumption that every record has a required field)

If your organization has its own post-mortems, use them to validate and adjust the deduction weights. The scoring guide point ranges and deduction examples are tunable through experience.
