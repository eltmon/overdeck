# PAN-724: Agent Usage Analytics Dashboard

## Problem

Overdeck can track raw cost events, but it still lacks a first-class product surface that explains **where usage is going** and **why**. We need one place in the dashboard that answers:

- Which issues and workspaces are burning the most tokens and money?
- Which agent types are expensive?
- Which activities are succeeding in one shot vs. looping through edit/test/fix retries?
- Which tools, MCP servers, models, and shell commands dominate usage?
- Is TLDR indexing actually reducing exploration overhead?

Today, this information is fragmented across transcript JSONL files, cost tables, agent state, and workspace metadata. The result is that users can see cost totals, but cannot easily diagnose waste, compare planning vs. implementation vs. review, or tie spend back to issue lifecycle.

## Goal

Add a **Overdeck-native usage analytics and reporting page** that surfaces tokens, cost, retries, one-shot rate, and activity breakdowns across issue/workspace/agent lifecycle data.

This is not a standalone wrapper product. It is a core Overdeck dashboard capability tied directly to:

- GitHub issues
- Overdeck workspaces
- agent types and specialist stages
- existing cost tracking and transcript reconciliation
- TLDR indexing metrics

## Non-Goals

- Replacing the existing cost event architecture
- Building a separate terminal-only analytics tool outside Overdeck
- Supporting every external coding agent on day one
- Perfect semantic classification in v1 using LLM inference
- Creating speculative infrastructure for providers we do not yet ingest

## Users and Core Questions

### Primary users
- Edward operating Overdeck day-to-day
- Anyone debugging why an issue/workspace/agent pipeline is wasteful
- Anyone validating whether tooling changes improved efficiency

### Questions this page must answer
- Which issues are most expensive this week?
- Which workspaces are burning tokens on retries?
- Are planning agents or implementation agents costing more?
- Which activity buckets have poor one-shot rates?
- Which MCP servers or shell commands correlate with high spend?
- Is TLDR reducing exploration cost and reducing retry pressure?
- Which model/provider combinations are worth their cost?

## Scope

## 1. New Dashboard Surface

Add a top-level dashboard page for usage analytics.

### Required filters
- Time window:
  - Today
  - 7 Days
  - 30 Days
  - This Month
  - Custom range
- Project / tracker scope
- Issue prefix / tracker project
- Specific issue
- Workspace
- Agent type
- Model
- Provider/source

### Required summary metrics
- Total cost
- Total API calls / assistant calls
- Total sessions
- Total input tokens
- Total output tokens
- Total cached tokens
- Total uncached tokens
- Cache read tokens
- Cache write tokens
- Cache hit rate
- Retry count
- One-shot rate

## 2. Required Breakdowns

The page must support the following breakdowns.

### 2.1 By Issue
Each row links to the issue and shows:
- issue ID
- title
- tracker/project
- total cost
- total tokens
- session count
- retry count
- one-shot rate
- active/last workspace

### 2.2 By Workspace
Each row links to the workspace and shows:
- workspace/branch name
- issue ID
- total cost
- total tokens
- session count
- retry count
- one-shot rate
- current status

### 2.3 By Agent Type
At minimum:
- planning
- implementation
- review
- test
- merge
- overseer / supervisory
- interactive/manual
- delegated/subagent

If Overdeck has richer phase labels, use them. The key requirement is that users can compare lifecycle stages on the same issue.

### 2.4 By Activity
The UI must expose at least these user-facing categories:
- Coding
- Debugging
- Feature Dev
- Refactoring
- Testing
- Exploration
- Planning
- Delegation
- Git Ops
- Build/Deploy
- Brainstorming
- Conversation
- General

These categories are required in the page, exports, and APIs.

### 2.5 By Model
- model family / model name
- calls
- cost
- input tokens
- output tokens
- cached tokens
- uncached tokens
- cache behavior
- optional provider grouping

### 2.6 By Core Tool
Break down built-in tool usage such as Read, Edit, Bash, Grep, Glob, TaskCreate, Agent, etc.

### 2.7 By MCP Server
Aggregate MCP usage by server and tool family.

### 2.8 By Shell Command
Aggregate normalized shell command families so users can spot wasteful loops (`npm test`, `vitest`, `git`, build commands, etc.).

## 3. One-Shot and Retry Analysis

This is a required part of the feature, not an optional enhancement.

### Required metrics
For edit-heavy work, calculate:
- edit turns
- one-shot turns
- retry turns
- retry count
- one-shot rate

### Required views
- By activity
- By agent type
- By issue
- By workspace

### Interpretation requirement
The page must make it easy to identify where token burn is caused by repeated edit/test/fix cycles rather than initial solution cost.

## 4. Overdeck-Specific Attribution

Overdeck must go beyond raw transcript grouping.

### Required attribution hierarchy
- Provider/source
- Claude/Codex session
- Overdeck agent
- session type / phase
- issue ID
- workspace
- tracker project

### Required capabilities
- Drill from issue -> workspace -> agent sessions -> calls/turns
- Compare planning vs implementation vs review vs merge usage on the same issue
- Preserve attribution across restarts, compactions, resumed workspaces, and specialist handoffs
- Distinguish direct work from delegated/subagent work
- Keep merge/review/test specialist cost attributable to the issue being processed

## 5. TLDR Impact Reporting

This feature must include a dedicated TLDR impact section.

### Required TLDR metrics
Use existing TLDR/cost data where available and extend if needed.

At minimum, report:
- TLDR interceptions
- TLDR bypasses
- tokens saved by TLDR
- savings percentage
- bypass reasons
- exploration cost with TLDR assistance
- exploration/research one-shot rate when TLDR was used vs. not used

### Required TLDR questions the UI must answer
- Is TLDR reducing raw read-token consumption?
- Is TLDR reducing exploration cost per issue/workspace?
- Is TLDR reducing retry pressure on debugging/coding tasks after exploration?
- Which workspaces or issue types benefit most from TLDR indexing?

### TLDR comparison views
At minimum:
- overall TLDR savings in the selected period
- by issue
- by workspace
- by agent type
- by activity bucket

## 6. Data Sources

The analytics page should compose existing Overdeck sources rather than inventing a parallel system.

### Primary sources
- SQLite `cost_events`
- SQLite `processed_sessions`
- Claude transcript JSONL reconciliation results
- agent runtime/session mapping
- issue/workspace metadata already available in dashboard read models
- TLDR metrics already stored in cost rows and/or daemon status

### Secondary sources
- tracker issue metadata for titles/project labels
- branch/workspace naming
- review/merge/test status stores where needed for attribution

## 7. APIs and Export

### Dashboard APIs
Add machine-readable endpoints for the analytics page.

Required API families:
- overall summary
- breakdowns by issue/workspace/agent/activity/model/tool/MCP/shell command
- drilldown for a single issue
- drilldown for a single workspace
- TLDR impact summary

### Export
Support export to:
- JSON
- CSV

Exports must include:
- selected filters/time range
- summary metrics
- activity breakdowns
- one-shot/retry fields
- TLDR impact fields

## 8. Compact Views

Add a compact summary mode suitable for:
- CLI reporting
- future statusline/status widget views
- fast dashboard summary cards

This compact mode should answer, at minimum:
- today's cost
- month's cost
- top activity bucket
- worst one-shot bucket
- top issue/workspace by cost
- TLDR savings in period

## 9. Classification Requirements

Activity classification should be deterministic in v1 and derived from:
- tool usage patterns
- shell command patterns
- known Overdeck phase/agent type metadata
- limited keyword rules on user prompts when necessary

Do not require an LLM call for per-turn classification in v1.

## 10. UX Requirements

### The page must support
- sortable tables
- clear empty states
- links into issues/workspaces
- drilldown from aggregate rows
- obvious labeling of selected time window and filters
- visually distinct one-shot/retry indicators
- visually distinct TLDR savings indicators

### Nice-to-have but not required for first ship
- charts
- sparklines
- heatmaps
- saved filter presets

The critical requirement is analytical usefulness, not chart polish.

## 11. Implementation Notes

### Likely architectural direction
- Extend current reporting/cost services rather than creating a separate subsystem
- Aggregate from SQLite first, then enrich with issue/workspace metadata
- Reuse existing dashboard event/read-model architecture where possible
- Keep API responses shaped for dashboard drilldown, not just raw logs

### Important constraint
Do not reduce analytics to project-level totals only. Overdeck's differentiator is issue/workspace/agent-type attribution.

## 12. Acceptance Criteria

- [ ] A dashboard page exists for usage analytics
- [ ] Users can filter by time window including today, 7 days, 30 days, month, and custom range
- [ ] Users can break down usage by issue, workspace, agent type, activity, model, tool, MCP server, and shell command
- [ ] The page includes all required activity buckets, including Coding and Debugging
- [ ] One-shot rate is shown by activity and by agent type
- [ ] Retry-heavy hotspots are visible by issue/workspace/activity
- [ ] Usage is associated with Overdeck issues and workspaces, not just raw session files
- [ ] Planning, implementation, review, test, and merge usage can be compared on the same issue
- [ ] TLDR impact is shown with token savings and bypass/interception metrics
- [ ] Users can answer whether TLDR is reducing exploration overhead from the analytics page
- [ ] JSON and CSV export exist for the same analytics data
- [ ] A compact summary mode exists for CLI/statusline-style consumption

## 13. Success Criteria

This feature is successful when a user can open one page and quickly answer:
- where cost is going
- where retries are happening
- which lifecycle stages are expensive
- which activity buckets are inefficient
- whether TLDR indexing is paying off

## Related
- GitHub issue: PAN-724
- Existing reporting baseline: `docs/prds/reporting-prd.md`
- Cost architecture: `docs/cost-tracking.md`
- TLDR system: `docs/TLDR.md`
