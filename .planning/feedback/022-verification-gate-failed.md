---
specialist: verification-gate
issueId: PAN-714
outcome: failed
timestamp: 2026-04-15T03:47:29Z
---

VERIFICATION FAILED for PAN-714 (attempt 1/10):

Failed check: test

Verification FAILED at test (18388ms):

text() method: without installing the canvas npm package

stderr | src/components/TerminalPanel.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/PlanDialog.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/__tests__/recoveryCoordinator.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/AgentInfoSection.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/Settings/__tests__/OpenRouterModelBrowser.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/lib/__tests__/snapshotCache.test.ts
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/ContainerSection.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/MergedSummaryCard.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/Settings/__tests__/OpenRouterPage.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/upgrade-announcement/UpgradeAnnouncement.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/TerminalSessionWrapper.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

stderr | src/components/inspector/ReviewPipelineSection.test.tsx
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

Terminated


## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-714 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-714 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
