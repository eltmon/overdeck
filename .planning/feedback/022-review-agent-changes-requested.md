---
specialist: review-agent
issueId: PAN-936
outcome: changes-requested
timestamp: 2026-05-04T05:48:56Z
---

# Verdict: CHANGES_REQUESTED

## Summary
This PR delivers most of PAN-936: Rally Feature cards now plan instead of execute, Rally child-story data flows into planning, and story work agents ingest synthesized feature context. The verdict is changes requested because two reviewer-raised issues still block merge: the Rally planning route currently drops child-story statuses by reading fields the service does not return, and FEATURE-CONTEXT.md still omits the parent feature title required by the vBRIEF acceptance criteria. Fix both root-cause contract gaps, then rerun review.

## Blockers (MUST fix before merge)

### 1. Rally child-story statuses are dropped in the planning route — `src/dashboard/server/routes/issues.ts:605` — `~`
**Raised by**: correctness
**Why it blocks**: The Rally planning path builds `childStories` from `RallyClient.getChildIssues()`, but the route reads `c.rawState || c.state` even though the service contract only exposes `status`, so Feature planning context can emit missing or wrong child-story states.

Map this route from the service contract it actually receives (`c.status`), or explicitly extend the service interface if raw Rally state must survive through the route, then add a route-level test that asserts the exact child-story status written into planning context.

### 2. Story feature context omits the parent feature title required by the vBRIEF — `src/lib/cloister/work-agent-prompt.ts:370` — `!`
**Raised by**: requirements
**Why it blocks**: The vBRIEF acceptance criterion requires `.planning/FEATURE-CONTEXT.md` to include the parent feature title, but the synthesized file currently writes only `Parent Feature: <ref>`, so the requirement is still only partially implemented.

Load the parent feature title when synthesizing `FEATURE-CONTEXT.md`, include it in the file alongside the existing narratives and dependency notes, and extend the feature-context test coverage to assert the title is present.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Inspector panel still maintains four independent polling loops — `src/dashboard/frontend/src/components/InspectorPanel.tsx:187` — `~`
**Raised by**: performance
Consolidate low-frequency inspector metadata into a single snapshot fetch or move more of this state onto the existing event-driven model so an open inspector does not multiply request traffic every 15–30 seconds.

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/specialists.ts:1757` — `?` — Review restart still uses a shell-string `execAsync` for `git branch --show-current`. Prefer `execFile` with `cwd` to remove shell startup overhead and quoting fragility. (performance)
- `src/lib/beads-query.ts:19` — `?` — JSONL fallback bead reads still scan the entire file into memory. Keep it unless the fallback becomes common, then replace it with a streaming or indexed fallback. (performance)
- `src/lib/vbrief/beads.ts:308` — `?` — JSONL fallback title lookup still scans the whole file. Apply the same streaming/indexed fallback only if this degraded path becomes frequent. (performance)
- `bun.lock` — `?` — `npm audit` cannot validate a Bun-only lockfile. If CI dependency scanning matters here, use a scanner that understands Bun lockfiles instead of npm audit. (security)

## Cross-cutting groups

**Feature-planning contract drift** (related findings that share a root cause — fix together):
- [blocker-1] Rally child-story statuses are dropped in the planning route
- [blocker-2] Story feature context omits the parent feature title required by the vBRIEF

**Inspector/runtime efficiency** (related findings that share a root cause — fix together):
- [high-1] Inspector panel still maintains four independent polling loops
- [nit-1] Review restart still uses a shell-string `execAsync` for `git branch --show-current`

**Fallback-path scaling** (related findings that share a root cause — fix together):
- [nit-2] JSONL fallback bead reads still scan the entire file into memory
- [nit-3] JSONL fallback title lookup still scans the whole file

## What's good
- The PR correctly shifts Feature cards and inspector actions toward planning-only behavior instead of execution controls.
- The tracker and service layers now carry Rally child-issue retrieval through to planning, and the work-agent pipeline reads synthesized feature context locally before startup.
- The changed code paths harden security overall by validating Rally IDs and replacing a shell-interpolated GitHub CLI call with argv-based process execution.

## Review stats
- Blockers: 2   High: 1   Medium: 0   Nits: 4
- By reviewer: correctness=1, security=1, performance=3, requirements=1
- Files touched: 69   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-936 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

