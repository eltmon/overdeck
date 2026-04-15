---
specialist: review-agent
issueId: PAN-509
outcome: changes-requested
timestamp: 2026-04-13T00:05:02Z
---

CODE REVIEW BLOCKED for PAN-509:

BLOCKING ISSUES:

1. [usePipelinePhase.ts:62] review-feedback phase only triggers when reviewStatus === "failed", but the backend writes reviewStatus = "blocked" on review rejection (see src/dashboard/server/routes/specialists.ts:302 and :1221 — both set "blocked", never "failed"). As a result the new "Review Feedback" phase badge and auto-switch will never fire in real usage. Extend the check to `rs === "blocked" || rs === "failed"` and add a test case for rs === "blocked".

2. [usePipelinePhase.ts:27-71] The PipelinePhase type and PHASE_LABELS include "verifying", and the function docstring lists it in the precedence chain, but derivePipelinePhase never assigns phase = "verifying". Either wire it up (e.g. when agent signals done but verification gate is running) or remove "verifying" from PipelinePhase, PHASE_LABELS, PHASE_CHIP_COLORS, and the precedence comment. Dead phase values are misleading.

3. [DetailPanelLayout.tsx:60-68 vs InspectorPanel.tsx:175-183] Both components now declare their own useQuery for ["review-status", issueId] with DIFFERENT refetchInterval values (15000 vs 30000). They share the cache key so it works, but the effective refetch cadence is implicit and confusing. Hoist the query to a single owner (DetailPanelLayout) and pass reviewStatus down as a prop, or lift it into a shared custom hook. Same applies to the ability for these to drift.

REQUIRED FIXES:
- Handle rs === "blocked" in derivePipelinePhase + test
- Resolve the "verifying" phase: implement it or delete it from the types/labels/colors/docs
- Consolidate the duplicated review-status useQuery to a single source of truth

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-509/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
