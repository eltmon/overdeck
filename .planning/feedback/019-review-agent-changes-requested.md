---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T20:39:20Z
---

CODE REVIEW BLOCKED for PAN-705:

BLOCKER 1 — pan plan option mismatch (src/cli/index.ts:174-178): CLI registers --model and --dry-run but planCommand's PlanOptions interface has {output, json, skipDiscovery, force, shadow}. The registered options are never used by the handler; the options the handler actually reads are never registered. Users who pass --json or --skip-discovery will get 'unknown option' errors; --model is silently ignored.

BLOCKER 2 — Stale legacy command references in docs (PRD acceptance criterion violated): 15+ instances of 'pan work *' remain across 7 files: docs/TESTING-PROVIDERS.md (4x pan work issue), docs/PRD.md (2x pan work issue), docs/prds/reporting-prd.md (1x pan work issue), docs/prds/planned/PAN-632-merge-system-refactor.md (6x pan work done), docs/prds/planned/PAN-382-inspect-specialist.md (2x pan work tell), docs/prds/planned/PAN-383-uat-specialist.md (3x pan work tell/done), docs/prds/planned/pan-309-evidence-based-completion-spec.md (2x pan work done). PRD acceptance criterion: 'No doc references a legacy command path.'

SECONDARY 1 — pan show default path (src/cli/commands/show.ts:41-45): The default view calls all 4 sub-handlers sequentially (shadowCommand + cvCommand + healthCommand + contextCommand). This likely violates the PRD's requirement that 'pan show <id> produces a compact summary (<=25 lines)'.

SECONDARY 2 — Wrong TLDR hint text (src/dashboard/frontend/src/components/TldrServiceStatus.tsx:60): Changed to 'Run pan admin hooks install to enable' but pan admin hooks install configures heartbeat hooks, not TLDR. Should reference pan admin tldr start or equivalent.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
