---
name: spec-readiness
audience: agent
description: >
  Evaluate an issue or epic's requirements readiness before development begins.
  Produces a scored report (0-100) across 5 dimensions with detailed findings,
  actionable blockers, and a JSON sidecar for dashboards. Works with any issue
  tracker (Linear, GitHub, GitLab, Rally, Jira). Use a wrapper skill to customize
  branding and tracker-specific field mappings.
triggers:
  - spec readiness
  - requirements readiness
  - spec score
  - prd score
  - requirements review
  - spec review
  - is this ready
  - readiness report
  - readiness score
  - readiness check
  - how ready is
  - requirements assessment
  - feature readiness
  - spec quality
  - prd readiness
  - ready for build
  - ready for dev
allowed-tools:
  - Read
  - Write
  - Bash
  - WebFetch
  - Task
---

# Spec Readiness — Orchestrator

## Philosophy

The most important work on a feature is the PRD/spec, not the implementation. Every major overrun traces back to **requirements incomplete when development started.** This skill measures requirements maturity as a **leading indicator**.

## Wrapper Architecture

This is the **core scoring engine**. It is designed to be wrapped by a thin customization layer.

### How Wrapping Works

A wrapper skill overrides branding, tracker bindings, and field mappings by providing a `config.yaml`:

```
1. Check: Does ~/.panopticon/skills/spec-readiness-*/config.yaml exist?
2. If yes: Load tracker bindings, field mappings, branding, conventions
3. If no: Use defaults (generic branding, auto-detect tracker)
```

### Wrapper Config Schema

```yaml
# ~/.panopticon/skills/spec-readiness-mycompany/config.yaml
tracker:
  type: linear | github | gitlab | rally | jira
  tools:
    get_issue: "mcp__linear__get_issue"
    list_child_issues: "mcp__linear__list_issues"
    get_comments: "mcp__linear__list_comments"
    search_issues: "mcp__linear__list_issues"
    get_relations: "mcp__linear__get_issue"  # with includeRelations=true
    get_activity_log: null  # not available for Linear
  fields:
    identifier: "identifier"
    estimate: "estimate"
    status: "status"
    parent_field: "parentId"
    customer_directed_label: null
    overflow_markers: []

branding:
  company_name: "My Company"
  primary_color: "#2563eb"
  stripe_color: "#2563eb"
  footer_text: null
  logo_url: null
  eml_from: null                    # From address for EML reports (default: noreply@example.com)
  eml_to: null                      # To address for EML reports (default: noreply@example.com)

conventions:
  spike_patterns: ["spike", "investigation", "discovery", "POC", "prototype", "analysis"]
  overflow_markers: ["[Unfinished]", "[Continued]"]
  estimate_field_custom: null
```

---

## When to Use

- Before sprint planning: "Is MIN-704 ready for development?"
- During quarterly planning: Score all issues to identify which need more spec work
- In status reports: Include readiness scores alongside implementation progress
- After an issue is described but before sub-tasks are created
- As a health check during development: Is the spec still evolving (bad sign)?

## Arguments

**Required:** An issue identifier (e.g., `MIN-704`, `#123`, `PROJ-456`, `PAN-47`)

**Optional:**
- `--output-dir <path>` — Override default output directory (default: current directory)
- `--eml` — Generate `.eml` file (email-ready, opens in mail client) instead of `.html`
- `--json-only` — Skip HTML/EML report, produce only JSON sidecar
- `--verbose` — Include full issue description text in findings
- `--wrapper <name>` — Explicitly select a wrapper (default: auto-detect)

## Scoring Model: 5 Dimensions, 100 Points Total

| Score | Label | Color |
|-------|-------|-------|
| 86-100 | **Ready for Build** | Green |
| 70-85 | **Mostly Ready** | Green |
| 40-69 | **Partial / Risky** | Yellow |
| 0-39 | **Not Ready** | Red |

| Dimension | What It Measures |
|-----------|-----------------|
| 1. Requirements Clarity (0-20) | Is the spec complete and unambiguous? |
| 2. Technical Discovery (0-20) | Have technical unknowns been investigated? |
| 3. Scope & Decomposition (0-20) | Is the issue right-sized with clear boundaries? |
| 4. Dependencies & Prerequisites (0-20) | Is the critical path mapped? |
| 5. Edge Cases & Test Strategy (0-20) | Are failure modes documented? |

Detailed scoring criteria, deduction tables, and calibration data are in `SCORING-REFERENCE.md` (same directory as this file).
HTML report structure is in `REPORT-TEMPLATE.md` (same directory as this file).

---

## Tracker Abstraction Layer

This skill works with any issue tracker. The data-fetching layer adapts based on tracker type.

### Generic Operations

| Operation | What It Does |
|-----------|-------------|
| `get_issue(id)` | Fetch the parent issue with description, status, metadata |
| `get_child_issues(parentId)` | Fetch all child/sub-issues |
| `get_comments(issueId)` | Fetch discussion threads |
| `get_activity_log(issueId)` | Fetch edit/revision history |
| `search_issues(filters)` | Search for related bugs/issues |
| `get_relations(issueId)` | Fetch blocking/blocked-by links |

### Tracker-Specific Mappings

**Linear:**
```
get_issue         → mcp__linear__get_issue(id, includeRelations=true)
get_child_issues  → mcp__linear__list_issues(parentId=<id>)
get_comments      → mcp__linear__list_comments(issueId=<id>)
get_activity_log  → Not available — skip edit churn, note in findings
search_issues     → mcp__linear__list_issues(query=..., label="Bug")
get_relations     → Included in get_issue with includeRelations=true
```

**GitHub:**
```
get_issue         → gh issue view <number> --repo {repo} --json title,body,state,labels,milestone,assignees
get_child_issues  → gh issue list --repo {repo} --search "parent:<number>" --json number,title,body,state,createdAt
get_comments      → gh issue view <number> --repo {repo} --json comments
get_activity_log  → gh api repos/{owner}/{repo}/issues/<number>/events
search_issues     → gh issue list --repo {repo} --label bug --search "<query>"
get_relations     → Parse "blocked by" / "depends on" from issue body
```

**GitLab:**
```
get_issue         → glab issue view <number>
get_child_issues  → glab api /projects/:id/issues?parent_id=<id>
get_comments      → glab issue note list <number>
get_activity_log  → glab api /projects/:id/issues/<number>/resource_state_events
search_issues     → glab issue list --label bug --search "<query>"
get_relations     → glab api /projects/:id/issues/<number>/links
```

**Rally:**
```
get_issue         → mcp__rally__get_feature(FormattedID) or mcp__rally__get_story
get_child_issues  → From _collections.UserStories in feature response
get_comments      → From Discussion collection in issue response
get_activity_log  → mcp__rally__get_revision_history(FormattedID)
search_issues     → mcp__rally__search_work_items(work_item_type=Defect)
get_relations     → From Predecessors/Successors collections
```

**Jira:**
```
get_issue         → curl $JIRA_URL/rest/api/3/issue/<key>
get_child_issues  → JQL: "parent = <key>" or "Epic Link = <key>"
get_comments      → /rest/api/3/issue/<key>/comment
get_activity_log  → /rest/api/3/issue/<key>/changelog
search_issues     → JQL search
get_relations     → /rest/api/3/issue/<key>?fields=issuelinks
```

### Auto-Detection (when no wrapper config)

1. Check if `mcp__linear__*` tools are available → use Linear
2. Check if `mcp__rally__*` tools are available → use Rally
3. Check if `gh` CLI is authenticated → use GitHub
4. Check if `glab` CLI is authenticated → use GitLab
5. If none detected, ask the user

---

## Workflow: Orchestrator + Subagents

**IMPORTANT:** This skill uses Task subagents to avoid running out of context. The main agent NEVER fetches individual child issues or large tracker payloads directly. All heavy data fetching happens inside subagents with isolated context windows.

### Step 1: Parse Arguments & Load Configuration

1. Extract the issue identifier from the user's request
2. Set output directory (default: current directory)
3. Look for wrapper config at `~/.panopticon/skills/spec-readiness-*/config.yaml`
4. If no wrapper, auto-detect tracker (see Auto-Detection above)
5. Build the tool mapping for the detected tracker

### Step 2: Fetch Issue Metadata (main agent — small payload)

Call the tracker's `get_issue` operation to get: Title, Description, Status, Owner/Assignee, Project, Milestone/Release, Estimate, Child Issue Count.

This single call is small enough for the main context. Note the Project name and Description — subagents need them.

### Step 3: Launch 3 Analysis Subagents IN PARALLEL

Use the `Task` tool with `subagent_type: "general-purpose"` for all three. **Launch all three in a single message** so they run concurrently.

Each subagent prompt MUST include:
- The tracker type and specific tool instructions (from Step 1)
- The issue identifier, title, project, and description (from Step 2)
- Instruction to read `SCORING-REFERENCE.md` from the skill directory for scoring criteria

---

#### Subagent A — "Issue & Edit History Analysis"

Scores **Dimension 1** (Requirements Clarity) and **Dimension 3** (Scope & Decomposition).

Prompt must include: identifier, title, project, description, notes (from Step 2), and tracker tool instructions.

Tell the subagent to:
1. Read `~/.claude/skills/spec-readiness/SCORING-REFERENCE.md` (or `~/.panopticon/skills/spec-readiness/SCORING-REFERENCE.md`) for criteria
2. Fetch edit/activity history for the issue (using the tracker's `get_activity_log` tool — or note if unavailable)
3. Fetch child issue list (using the tracker's `get_child_issues` tool)
4. **Scan description for external document links** (BRD, PRD, spec docs — Google Docs, Confluence, SharePoint, Notion, attached files). If a URL is found and appears accessible, use WebFetch to analyze coverage and cross-reference with the description. If no external document found and issue is customer-directed: note for deduction.
5. Analyze description + edit history for: open questions, churn, late edits, external doc links, scope markers, child count, carryover rate, creation date spread
6. Return in this format (max 120 lines, no raw tracker JSON):

```
## Issue Metadata
- Title / Identifier / Project / Milestone / Owner / ChildCount / Estimate / EditCount

## External Documents
- Found: yes/no | Type: PRD/BRD/spec | Accessible: yes/no | Attached before dev: yes/no
- Coverage summary (if fetched)
- Gaps identified (if fetched)

## Dimension 1: Requirements Clarity (Score: X/20)
### Summary
### Findings
1. [DEDUCTION -N] Finding | Source: ... | Recommendation: ...

## Dimension 3: Scope & Decomposition (Score: X/20)
### Summary
### Findings

## Child Issue List
| ID | Title | Status | CreationDate |
```

---

#### Subagent B — "Child Issue & Dependency Analysis"

Scores **Dimension 2** (Technical Discovery), **Dimension 4** (Dependencies), **Dimension 5** (Edge Cases & Test Strategy).

Prompt must include: identifier, project, description (for technical detail analysis), and tracker tool instructions.

Tell the subagent to:
1. Read `~/.claude/skills/spec-readiness/SCORING-REFERENCE.md` for criteria
2. Fetch child issues with dependency/relation fields (using the tracker's `get_child_issues` and `get_relations` tools)
3. Spot-check 3-4 child issues in detail: any spike/investigation, first 2 implementation issues, any QA/test issue
4. Fetch comments/discussion on the parent issue (using the tracker's `get_comments` tool) — look for developer questions indicating requirements gaps
5. Analyze for: spikes (timing, gating), technical detail in description, infrastructure sequencing, dependency links, acceptance criteria quality, edge case language
6. Return in this format (max 120 lines, no raw tracker JSON):

```
## Dimension 2: Technical Discovery (Score: X/20)
### Summary
### Findings

## Dimension 4: Dependencies & Prerequisites (Score: X/20)
### Summary
### Findings

## Dimension 5: Edge Cases & Test Strategy (Score: X/20)
### Summary
### Findings

## Child Issue Assessments
| ID | Title | Status | Has AC | AC Quality | Notes |
```

---

#### Subagent C — "Bug & Risk Analysis"

Finds bugs and risks that feed into Dimension 5 scoring.

Prompt must include: identifier, project, and tracker tool instructions.

Tell the subagent to:
1. Search for bugs/defects related to this issue or its children (using the tracker's `search_issues` tool with bug/defect filter)
2. Analyze: bugs filed during development, "missing config" bugs, bugs indicating edge cases discovered in execution
3. Return in this format (max 50 lines):

```
## Bug Analysis
- Total bugs found / related to this issue / missed edge cases / bugs during active dev

## Impact on Dimension 5 Scoring
- [DEDUCTION -N] or [BONUS +N] with source
```

---

### Step 4: Assemble Scores

The main agent receives ~160-290 lines of structured findings from the three subagents (instead of thousands of lines of raw tracker data).

1. Extract dimension scores from Subagents A and B
2. Apply any additional deductions/bonuses from Subagent C to Dimension 5
3. Clamp all scores to 0-20
4. Calculate overall score = sum of 5 dimensions
5. Determine status label and color from the scoring table

### Step 5: Generate Top Blockers

From all findings with negative impact, select the 3-5 highest-impact items. Phrase as actionable:
- "Resolve 3 open questions in description to improve Requirements Clarity by up to 6 points"
- "Add a gating spike issue before the next sprint to improve Technical Discovery by up to 8 points"

### Step 6: Launch Report Generation Subagent

Use `Task` tool with `subagent_type: "general-purpose"`. Prompt must include all assembled scores, findings, child assessments, external document analysis, issue metadata, and top blockers. Also include the wrapper branding config (if any) and the output format: **HTML** (default) or **EML** (if `--eml` flag was used). Tell the subagent to:
1. Read `REPORT-TEMPLATE.md` from the skill directory for report structure (includes both HTML and EML format specs)
2. Read the "JSON Sidecar Schema" section from `SCORING-REFERENCE.md` in the skill directory
3. If HTML format: Write to `{output-dir}/spec-readiness-{identifier}.html`
   If EML format: Write to `{output-dir}/spec-readiness-{identifier}.eml` (with MIME headers, email-safe inline CSS)
4. Always write JSON to `{output-dir}/spec-readiness-{identifier}.json`
5. Open the report file (HTML opens in browser, EML opens in mail client)
6. Return the file paths

### Step 7: Report to User

Tell the user:
- Where both files were saved
- The overall score and status
- The top 3 blockers
- Suggest next action (e.g., "To improve this score, start by resolving the 3 open questions in the description")

---

## Integration with Other Skills

Other skills can read the JSON sidecar to include readiness scores:

```
Read spec-readiness-{identifier}.json
Extract: .score, .status, .statusColor, .topBlockers[0..2]
```

Display in roll-up tables:

| Issue | Readiness | Score | Top Blocker |
|-------|-----------|-------|-------------|
| MIN-704 — MCP Code Mode | Mostly Ready | 74/100 | No dependency links mapped |
| PAN-47 — PRD Enforcement | Ready for Build | 88/100 | — |

---

## Example Usage

```
spec readiness MIN-704
how ready is #123
requirements review PAN-47
readiness check for all features in Q1
```

For batch scoring (e.g., "score all issues in current cycle"):
1. Search tracker for issues in the target milestone/cycle
2. Run readiness assessment on each
3. Produce a summary table with scores
4. Save individual JSON sidecars for each
