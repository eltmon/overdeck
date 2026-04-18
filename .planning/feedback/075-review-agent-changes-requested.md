---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T22:56:37Z
---

CODE REVIEW BLOCKED for PAN-540:

Blocking review: the settings UI still presents deprecated model IDs in the override modal, so users can re-select deprecated models immediately after this migration. src/dashboard/frontend/src/components/Settings/AgentCards/ModelOverrideModal.tsx:62-74 still lists gpt-5.2-codex, o3-deep-research, gemini-3-pro-preview, gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash, glm-4.7, and glm-4.7-flash, while the backend deprecates or supersedes these in src/lib/model-capabilities.ts:33-48 and exposes current model IDs elsewhere. This leaves the UI inconsistent with the new settings API and defeats the automatic migration flow. There is also no frontend regression test covering this modal/model list behavior; the added SettingsPage tests only cover buildMiniMaxFormData in src/dashboard/frontend/src/components/Settings/__tests__/SettingsPage.test.ts:1-79, so this regression is not caught.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
