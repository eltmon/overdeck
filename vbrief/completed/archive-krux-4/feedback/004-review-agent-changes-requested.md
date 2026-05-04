---
specialist: review-agent
issueId: KRUX-4
outcome: changes-requested
timestamp: 2026-03-21T01:53:01Z
---

CODE REVIEW BLOCKED for KRUX-4:

BLOCKED: 2 blockers + 4 issues. (1) Missing tests for 4 files: ai-service.ts, useAIAnalysis.ts, AnalysisControls.tsx, InsightCard.tsx. (2) Duplicated normalizeItems function copy-pasted in anthropic.ts:8-19 and moonshot.ts:9-20 — extract to shared module. Also: dead exports keysStatus/setAutoInterval from useAIAnalysis, missing vite externals for @anthropic-ai/sdk and openai, conflated hasActiveProvider+hasContext disabling, fragile removeAllListeners pattern.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/KRUX-4/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
