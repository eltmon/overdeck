---
specialist: review-agent
issueId: PAN-509
outcome: changes-requested
timestamp: 2026-04-12T23:42:29Z
---

CODE REVIEW BLOCKED for PAN-509:

1) MergedSummaryCard.tsx:15 formatCost bug — returns "$0.50¢" (mixes $ and ¢ symbols). 2) DetailPanelLayout.tsx:248 prUrl hardcoded to null — prUrl exists on contract type but is not plumbed through. 3) InspectorPanel.tsx duplicates phase-derivation logic (derivePhaseLabel + PHASE_BADGE_COLORS) that already lives in usePipelinePhase.ts/TerminalTabs.tsx — two parallel implementations can drift; should use usePipelinePhase hook.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-509/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
