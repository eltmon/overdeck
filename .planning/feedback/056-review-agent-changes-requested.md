---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T15:05:46Z
---

CODE REVIEW BLOCKED for PAN-540:

1. src/lib/settings-api.ts:136-143 and src/lib/settings-api.ts:492-509 introduce a MiniMax-only defaults preset but getDefaultConversationModelApi() still returns claude-sonnet-4-6 whenever OpenAI is disabled. That means saving MiniMax-only settings produces a disabled default conversation model, and the chat UI consumes that value via src/dashboard/frontend/src/components/chat/defaultConversationModel.ts:27-35 and callers such as ConversationPanel.tsx:64 / ComposerFooter.tsx:74. 2. src/dashboard/frontend/src/components/Settings/SettingsPage.tsx:487-499 drops existing conversations/tmux/openrouter fields when applying MiniMax defaults, and saveSettingsApi() persists those omissions as undefined at src/lib/settings-api.ts:262-265. Clicking the preset can silently erase unrelated settings. 3. There are no regression tests covering either bug: no test for MiniMax-only default_conversation_model selection, and no frontend test for handleRestoreMiniMaxDefaults preserving unrelated settings while applying the preset.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
