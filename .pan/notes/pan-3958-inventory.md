# PAN-3958 inventory — row-level audit output

Generated 2026-09-23 against `origin/main` `0260c28298d` by `.pan/notes/pan-3958-audit.cjs`
(TypeScript compiler API, per-file AST, no type checker). Companion to `.pan/drafts/pan-3958.md`;
the PRD's per-module table (§9) and Shape C table (§10) summarise these rows.

**How to read the counts.** Caller counts come from an identifier index: every identifier with the
export's name in non-test source outside its declaration/import counts. Name collisions (a local
variable or property with the same name) can only *raise* a count, so "DEAD" (zero production
references) is reliable and "LIVE" is an upper bound. `tsc --noEmit` is the oracle when a row is
acted on. "ext" = references in other production files, "self" = references inside the defining
file, "yield*" = references inside an `Effect.gen` generator, "tests" = references in test files.

Regenerate: `node scripts/audit-effect-boundary.mjs --json --usage > /tmp/pan-3958.json` (the
maintained port of the planning script, same classification and JSON keys), then
compare counts; line numbers drift as phases land.

## A. Shape A — Promise façades (220)

`file:line` exported name ← private body · bridge · prod call sites (external/self) · yield* sites · test refs

- [LIVE] `src/lib/agent-directory-cleanup.ts:442` `findOrphanedAgentDirs` ← `findOrphanedAgentDirsPromise` · Effect.tryPromise · ext 0/self 1 · yield* 0 · tests 7
- [LIVE] `src/lib/agent-directory-cleanup.ts:456` `cleanupAgentDirectories` ← `cleanupAgentDirectoriesPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 6
- [DEAD] `src/lib/agent-directory-cleanup.ts:471` `findClosedIssueAgentDirs` ← `findClosedIssueAgentDirsPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/agent-directory-cleanup.ts:487` `cleanupClosedIssueAgentDirectories` ← `cleanupClosedIssueAgentDirectoriesPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 7
- [LIVE] `src/lib/agent-enrichment.ts:273` `countPendingAskUserQuestionsForAgent` ← `countPendingAskUserQuestionsForAgentPromise` · Effect.promise · ext 1/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/agent-enrichment.ts:313` `countPendingAskUserQuestionsForCurrentAgentSession` ← `countPendingAskUserQuestionsForCurrentAgentSessionPromise` · Effect.promise · ext 3/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/agent-enrichment.ts:827` `computeAgentEnrichment` ← `computeAgentEnrichmentPromise` · Effect.tryPromise · ext 2/self 0 · yield* 1 · tests 24
- [LIVE] `src/lib/agent-enrichment.ts:844` `getAgentWorkspace` ← `getAgentWorkspacePromise` · Effect.promise · ext 1/self 2 · yield* 0 · tests 4
- [LIVE] `src/lib/agent-enrichment.ts:850` `getAgentJsonlPath` ← `getAgentJsonlPathPromise` · Effect.promise · ext 1/self 3 · yield* 1 · tests 8
- [LIVE] `src/lib/agent-enrichment.ts:856` `getAgentJsonlMtime` ← `getAgentJsonlMtimePromise` · Effect.promise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/agent-enrichment.ts:862` `getPendingQuestions` ← `getPendingQuestionsPromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 14
- [LIVE] `src/lib/agent-enrichment.ts:868` `getAgentPendingQuestions` ← `getAgentPendingQuestionsPromise` · Effect.promise · ext 2/self 0 · yield* 2 · tests 1
- [LIVE] `src/lib/agent-input-detection.ts:378` `detectAwaitingInputForAgent` ← `detectAwaitingInputForAgentPromise` · Effect.tryPromise · ext 8/self 0 · yield* 0 · tests 17
- [LIVE] `src/lib/caveman/workspace.ts:241` `injectCavemanSettings` ← `injectCavemanSettingsPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 9
- [LIVE] `src/lib/caveman/workspace.ts:256` `readCavemanVariant` ← `readCavemanVariantPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 7
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:649` `pruneCheckpointRefsForAgents` ← `pruneCheckpointRefsForAgentsPromise` · Effect.promise · ext 2/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/checkpoint/checkpoint-manager.ts:657` `pruneStaleCheckpointRefs` ← `pruneStaleCheckpointRefsPromise` · Effect.promise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:665` `deleteLegacyCheckpointRefs` ← `deleteLegacyCheckpointRefsPromise` · Effect.promise · ext 2/self 0 · yield* 1 · tests 1
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:670` `diffAgainstMain` ← `diffAgainstMainPromise` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 0
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:682` `diffAgainstMainFiles` ← `diffAgainstMainFilesPromise` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 0
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:693` `findCommitAtTime` ← `findCommitAtTimePromise` · Effect.promise · ext 4/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/checkpoint/checkpoint-manager.ts:701` `diffSinceCommit` ← `diffSinceCommitPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:713` `diffFilesAgainstHead` ← `diffFilesAgainstHeadPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:725` `diffPatchSinceCommit` ← `diffPatchSinceCommitPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/checkpoint/checkpoint-manager.ts:738` `diffPatchFilesAgainstHead` ← `diffPatchFilesAgainstHeadPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cliproxy.ts:867` `bridgeCodexAuthToCliproxy` ← `bridgeCodexAuthToCliproxyTask` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 1
- [LIVE] `src/lib/cliproxy.ts:882` `bridgeGeminiAuthToCliproxy` ← `bridgeGeminiAuthToCliproxyTask` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 3
- [LIVE] `src/lib/cliproxy.ts:900` `installCliproxy` ← `installCliproxyTask` · Effect.tryPromise · ext 7/self 0 · yield* 1 · tests 0
- [LIVE] `src/lib/cliproxy.ts:909` `isCliproxyRunning` ← `isCliproxyRunningTask` · Effect.promise · ext 10/self 0 · yield* 0 · tests 8
- [DEAD] `src/lib/cliproxy.ts:913` `checkCliproxyPort` ← `checkCliproxyPortTask` · Effect.promise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cliproxy.ts:917` `startCliproxy` ← `startCliproxyTask` · Effect.tryPromise · ext 6/self 0 · yield* 1 · tests 7
- [LIVE] `src/lib/cliproxy.ts:930` `stopCliproxy` ← `stopCliproxyTask` · Effect.tryPromise · ext 6/self 0 · yield* 1 · tests 6
- [LIVE] `src/lib/cliproxy.ts:937` `restartCliproxy` ← `restartCliproxyTask` · Effect.tryPromise · ext 5/self 0 · yield* 1 · tests 2
- [LIVE] `src/lib/cloister/ci-failure-feedback.ts:261` `recordCiTestGatePass` ← `recordCiTestGatePassPromise` · Effect.promise · ext 1/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/cloister/ci-failure-feedback.ts:579` `relayCiFailureFeedback` ← `relayCiFailureFeedbackPromise` · Effect.promise · ext 3/self 0 · yield* 0 · tests 19
- [LIVE] `src/lib/cloister/feedback-writer.ts:188` `clearFeedbackFiles` ← `clearFeedbackFilesPromise` · Effect.tryPromise · ext 0/self 1 · yield* 0 · tests 4
- [LIVE] `src/lib/cloister/feedback-writer.ts:203` `writeFeedbackFile` ← `writeFeedbackFilePromise` · Effect.tryPromise · ext 10/self 0 · yield* 0 · tests 25
- [LIVE] `src/lib/cloister/handoff-context.ts:335` `captureHandoffContext` ← `captureHandoffContextPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cloister/handoff.ts:234` `performHandoff` ← `performHandoffPromise` · Effect.tryPromise · ext 2/self 0 · yield* 1 · tests 0
- [LIVE] `src/lib/cloister/review-agent.ts:776` `killAllReviewerSessions` ← `killAllReviewerSessionsPromise` · Effect.promise · ext 8/self 2 · yield* 2 · tests 3
- [LIVE] `src/lib/cloister/review-agent.ts:786` `killAllReviewSessions` ← `killAllReviewSessionsPromise` · Effect.promise · ext 2/self 0 · yield* 0 · tests 6
- [LIVE] `src/lib/cloister/review-context.ts:598` `buildReviewContext` ← `buildReviewContextPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 18
- [LIVE] `src/lib/cloister/review-convoy.ts:359` `buildConvoyPrompt` ← `buildConvoyPromptPromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 1
- [LIVE] `src/lib/cloister/review-convoy.ts:373` `spawnReviewSubRoleForIssue` ← `spawnReviewSubRoleForIssuePromise` · Effect.promise · ext 3/self 1 · yield* 1 · tests 15
- [LIVE] `src/lib/cloister/review-verdict-feedback.ts:339` `deliverReviewVerdictFeedback` ← `deliverReviewVerdictFeedbackPromise` · Effect.promise · ext 4/self 0 · yield* 1 · tests 40
- [LIVE] `src/lib/cloister/service-reactive.ts:459` `onIssueStateChange` ← `onIssueStateChangePromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 16
- [LIVE] `src/lib/cloister/service-reactive.ts:469` `handleCloisterDomainEvent` ← `handleCloisterDomainEventPromise` · Effect.promise · ext 2/self 0 · yield* 0 · tests 10
- [LIVE] `src/lib/cloister/session-rotation.ts:278` `buildMergeAgentMemory` ← `buildMergeAgentMemoryPromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 4
- [LIVE] `src/lib/cloister/session-rotation.ts:289` `rotateSpecialistSession` ← `rotateSpecialistSessionPromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 4
- [LIVE] `src/lib/cloister/session-rotation.ts:300` `checkAndRotateIfNeeded` ← `checkAndRotateIfNeededPromise` · Effect.promise · ext 1/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/cloister/specialist-context.ts:378` `generateContextDigest` ← `generateContextDigestPromise` · Effect.promise · ext 0/self 2 · yield* 0 · tests 10
- [LIVE] `src/lib/cloister/specialist-context.ts:389` `regenerateContextDigest` ← `regenerateContextDigestPromise` · Effect.promise · ext 3/self 0 · yield* 1 · tests 1
- [DEAD] `src/lib/cloister/specialist-handoff-logger.ts:282` `getSpecialistHandoffStats` ← `getSpecialistHandoffStatsPromise` · Effect.promise · ext 0/self 0 · yield* 0 · tests 8
- [LIVE] `src/lib/cloister/specialist-handoff-logger.ts:292` `updateSpecialistHandoffStatus` ← `updateSpecialistHandoffStatusPromise` · Effect.promise · ext 2/self 0 · yield* 1 · tests 10
- [LIVE] `src/lib/cloister/triggers.ts:340` `checkTaskCompletion` ← `checkTaskCompletionPromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 0
- [LIVE] `src/lib/cloister/triggers.ts:352` `checkAllTriggers` ← `checkAllTriggersPromise` · Effect.promise · ext 2/self 0 · yield* 1 · tests 0
- [DEAD] `src/lib/cloister/uat-failure-feedback.ts:168` `relayUatFailureFeedback` ← `relayUatFailureFeedbackPromise` · Effect.promise · ext 0/self 0 · yield* 0 · tests 14
- [DEAD] `src/lib/cloister/validation.ts:750` `runMergeValidation` ← `runMergeValidationPromise` · Effect.promise · ext 0/self 0 · yield* 0 · tests 16
- [LIVE] `src/lib/cloister/validation.ts:781` `runQualityGates` ← `runQualityGatesPromise` · Effect.promise · ext 4/self 0 · yield* 0 · tests 30
- [LIVE] `src/lib/cloister/verification-runner.ts:964` `runVerificationForIssueInProcess` ← `runVerificationForIssuePromise` · Effect.promise · ext 1/self 1 · yield* 0 · tests 6
- [LIVE] `src/lib/codex-auth.ts:636` `checkCodexAuthStatus` ← `checkCodexAuthStatusPromise` · Effect.tryPromise · ext 3/self 0 · yield* 3 · tests 1
- [LIVE] `src/lib/config-yaml/load.ts:563` `loadConfigNoMigration` ← `loadConfigWithoutMigration` · Effect.tryPromise · ext 3/self 1 · yield* 1 · tests 3
- [LIVE] `src/lib/config.ts:528` `loadConfig` ← `loadConfigFromFile` · Effect.tryPromise · ext 14/self 0 · yield* 0 · tests 36
- [DEAD] `src/lib/config.ts:536` `saveConfig` ← `saveConfigToFile` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/config.ts:563` `getConversationsConfig` ← `readConversationsConfig` · Effect.tryPromise · ext 10/self 0 · yield* 10 · tests 1
- [LIVE] `src/lib/conversations/enrichment/enrich-session.ts:558` `enrichSession` ← `enrichSessionPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 22
- [LIVE] `src/lib/conversations/smart-compaction.ts:1154` `runModelSummary` ← `runModelSummaryPromise` · Effect.tryPromise · ext 1/self 3 · yield* 0 · tests 1
- [LIVE] `src/lib/conversations/smart-compaction.ts:1174` `generateSmartSummary` ← `generateSmartSummaryPromise` · Effect.tryPromise · ext 4/self 0 · yield* 0 · tests 5
- [LIVE] `src/lib/conversations/summary-fork.ts:776` `generateFallbackSummary` ← `generateFallbackSummaryPromise` · Effect.tryPromise · ext 5/self 1 · yield* 0 · tests 10
- [LIVE] `src/lib/conversations/summary-fork.ts:788` `reserveSummaryForkSession` ← `reserveSummaryForkSessionPromise` · Effect.tryPromise · ext 1/self 1 · yield* 0 · tests 1
- [LIVE] `src/lib/conversations/summary-fork.ts:799` `copySessionFromCompactBoundary` ← `copySessionFromCompactBoundaryPromise` · Effect.tryPromise · ext 1/self 1 · yield* 0 · tests 1
- [DEAD] `src/lib/conversations/summary-fork.ts:811` `createSummaryFork` ← `createSummaryForkPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 13
- [LIVE] `src/lib/costs/reconciler.ts:832` `reconcile` ← `reconcilePromise` · Effect.tryPromise · ext 24/self 0 · yield* 0 · tests 44
- [LIVE] `src/lib/costs/sync-wal.ts:161` `syncWalFromAllProjects` ← `syncWalFromAllProjectsPromise` · Effect.tryPromise · ext 2/self 0 · yield* 1 · tests 8
- [DEAD] `src/lib/costs/sync-wal.ts:168` `syncWalFromDir` ← `syncWalFromDirPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 15
- [LIVE] `src/lib/git-utils.ts:460` `cleanupStaleLocks` ← `cleanupStaleLocksPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 15
- [DEAD] `src/lib/git-utils.ts:482` `getWorkspaceGitInfo` ← `getWorkspaceGitInfoPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 3
- [DEAD] `src/lib/git-utils.ts:500` `hasStaleLocks` ← `hasStaleLocksPromise` · Effect.promise · ext 0/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/git/operations.ts:240` `gitRevParse` ← `gitRevParsePromise` · Effect.promise · ext 0/self 8 · yield* 0 · tests 0
- [LIVE] `src/lib/git/operations.ts:248` `gitFetch` ← `gitFetchPromise` · Effect.tryPromise · ext 0/self 1 · yield* 0 · tests 4
- [LIVE] `src/lib/git/operations.ts:270` `gitPush` ← `gitPushPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 19
- [DEAD] `src/lib/git/operations.ts:297` `gitForcePush` ← `gitForcePushPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 4
- [DEAD] `src/lib/git/operations.ts:316` `gitMerge` ← `gitMergePromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/github-app.ts:906` `getPullRequestState` ← `getPullRequestStatePromise` · Effect.tryPromise · ext 11/self 0 · yield* 0 · tests 18
- [DEAD] `src/lib/github-app.ts:917` `getPullRequestHeadState` ← `getPullRequestHeadStatePromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/github-app.ts:928` `listPullRequestsForHead` ← `listPullRequestsForHeadPromise` · Effect.tryPromise · ext 5/self 0 · yield* 0 · tests 7
- [LIVE] `src/lib/github-app.ts:940` `getIssueState` ← `getIssueStatePromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 9
- [DEAD] `src/lib/github-app.ts:951` `listOpenIssuesWithLabels` ← `listOpenIssuesWithLabelsPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/github-app.ts:964` `getCiCheckRunsState` ← `getCiCheckRunsStatePromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/github-app.ts:975` `mergePullRequestWithApp` ← `mergePullRequestWithAppPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 3
- [LIVE] `src/lib/health.ts:453` `isAgentAlive` ← `isAgentAlivePromise` · Effect.promise · ext 0/self 2 · yield* 0 · tests 0
- [LIVE] `src/lib/hume.ts:225` `createHumeConfig` ← `createHumeConfigPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/hume.ts:244` `deleteHumeConfig` ← `deleteHumeConfigPromise` · Effect.tryPromise · ext 3/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/memory/checkpoint-client.ts:96` `claimTranscriptRange` ← `postWorkerRequest` · Effect.tryPromise · ext 3/self 2 · yield* 0 · tests 4
- [LIVE] `src/lib/memory/checkpoint-client.ts:104` `commitTranscriptRange` ← `postWorkerRequest` · Effect.tryPromise · ext 3/self 2 · yield* 0 · tests 4
- [LIVE] `src/lib/memory/checkpoint-client.ts:112` `releaseTranscriptRange` ← `postWorkerRequest` · Effect.tryPromise · ext 2/self 2 · yield* 0 · tests 3
- [LIVE] `src/lib/memory/checkpoint-client.ts:122` `getTranscriptCheckpoint` ← `postWorkerRequest` · Effect.tryPromise · ext 9/self 2 · yield* 0 · tests 16
- [LIVE] `src/lib/memory/checkpoint-client.ts:130` `listTranscriptCheckpoints` ← `postWorkerRequest` · Effect.tryPromise · ext 2/self 2 · yield* 0 · tests 0
- [LIVE] `src/lib/openai-auth.ts:146` `getOpenAIAuthStatus` ← `getOpenAIAuthStatusPromise` · Effect.tryPromise · ext 3/self 0 · yield* 1 · tests 3
- [LIVE] `src/lib/openai-compatible-proxy.ts:66` `ensureOpenAICompatibleProxyRunning` ← `ensureOpenAICompatibleProxyRunningPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 6
- [LIVE] `src/lib/platform-lifecycle.ts:689` `stopDashboard` ← `stopDashboardPromise` · Effect.tryPromise · ext 5/self 0 · yield* 0 · tests 13
- [LIVE] `src/lib/platform-lifecycle.ts:696` `waitForDashboardHealth` ← `waitForDashboardHealthPromise` · Effect.tryPromise · ext 3/self 0 · yield* 0 · tests 5
- [LIVE] `src/lib/platform-lifecycle.ts:708` `waitForTraefikHealth` ← `waitForTraefikHealthPromise` · Effect.promise · ext 2/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/platform-lifecycle.ts:715` `isTraefikContainerRunning` ← `isTraefikContainerRunningPromise` · Effect.promise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/platform-lifecycle.ts:719` `startTraefik` ← `startTraefikPromise` · Effect.tryPromise · ext 1/self 1 · yield* 0 · tests 0
- [LIVE] `src/lib/platform-lifecycle.ts:723` `stopTraefik` ← `stopTraefikPromise` · Effect.promise · ext 1/self 1 · yield* 0 · tests 0
- [LIVE] `src/lib/platform-lifecycle.ts:727` `restartDashboard` ← `restartDashboardPromise` · Effect.tryPromise · ext 6/self 0 · yield* 0 · tests 45
- [LIVE] `src/lib/platform-lifecycle.ts:745` `restartCliproxy` ← `restartCliproxyPromise` · Effect.tryPromise · ext 5/self 0 · yield* 1 · tests 2
- [LIVE] `src/lib/platform-lifecycle.ts:757` `restartTraefik` ← `restartTraefikPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/prd-draft.ts:84` `hasPRDDraft` ← `hasPRDDraftPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 8
- [DEAD] `src/lib/prd-draft.ts:88` `readPRDDraft` ← `readPRDDraftPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 6
- [DEAD] `src/lib/prd-draft.ts:92` `writePRDDraft` ← `writePRDDraftPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 20
- [DEAD] `src/lib/prd-draft.ts:96` `listPRDDrafts` ← `listPRDDraftsPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 4
- [DEAD] `src/lib/prd-draft.ts:100` `deletePRDDraft` ← `deletePRDDraftPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 6
- [DEAD] `src/lib/prd-draft.ts:104` `getPRDDraftInfo` ← `getPRDDraftInfoPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/prd-locations.ts:170` `findDraftPrd` ← `findDraftPrdAsync` · Effect.promise · ext 1/self 0 · yield* 0 · tests 9
- [LIVE] `src/lib/projects.ts:1167` `renameProject` ← `updateProjectsConfigAsync` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 0
- [DEAD] `src/lib/projects.ts:1190` `registerProject` ← `updateProjectsConfigAsync` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/projects.ts:1202` `unregisterProject` ← `updateProjectsConfigAsync` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/provider-health.ts:277` `probeProvider` ← `probeProviderPromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 5
- [LIVE] `src/lib/provider-health.ts:285` `validateProviderHealth` ← `validateProviderHealthPromise` · Effect.tryPromise · ext 2/self 0 · yield* 1 · tests 2
- [LIVE] `src/lib/rebase-helper.ts:279` `rebaseAndPushRepos` ← `rebaseAndPushReposPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 7
- [LIVE] `src/lib/remote-workspace.ts:225` `createRemoteWorkspace` ← `createRemoteWorkspacePromise` · Effect.tryPromise · ext 7/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/reopen.ts:75` `reopenWorkspaceState` ← `reopenWorkspaceStatePromise` · Effect.tryPromise · ext 2/self 0 · yield* 1 · tests 3
- [LIVE] `src/lib/restart-lock.ts:192` `readRestartLockHolder` ← `readRestartLockHolderPromise` · Effect.tryPromise · ext 6/self 0 · yield* 0 · tests 18
- [LIVE] `src/lib/restart-lock.ts:204` `acquireRestartLock` ← `acquireRestartLockPromise` · Effect.tryPromise · ext 5/self 0 · yield* 0 · tests 19
- [LIVE] `src/lib/restart-status.ts:286` `writeRestartStatus` ← `writeRestartStatusPromise` · Effect.tryPromise · ext 7/self 0 · yield* 0 · tests 25
- [LIVE] `src/lib/restart-status.ts:300` `readRestartStatus` ← `readRestartStatusPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 8
- [LIVE] `src/lib/restart-status.ts:312` `readRestartEvents` ← `readRestartEventsPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/review-artifacts.ts:183` `buildRichReviewArtifactBody` ← `buildRichReviewArtifactBodyPromise` · Effect.tryPromise · ext 0/self 1 · yield* 0 · tests 0
- [LIVE] `src/lib/review-artifacts.ts:199` `createReviewArtifactsForIssue` ← `createReviewArtifactsForIssuePromise` · Effect.tryPromise · ext 4/self 0 · yield* 1 · tests 2
- [LIVE] `src/lib/runtime/index.ts:106` `isRuntimeInstalled` ← `isRuntimeInstalledPromise` · Effect.promise · ext 0/self 1 · yield* 0 · tests 0
- [DEAD] `src/lib/runtime/index.ts:112` `getInstalledRuntimes` ← `getInstalledRuntimesPromise` · Effect.promise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/runtimes/ohmypi-fifo.ts:137` `createOhmypiFifo` ← `createOhmypiFifoPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/runtimes/pi-fifo.ts:152` `createPiFifo` ← `createPiFifoPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 14
- [LIVE] `src/lib/safety/dangerous-git-ops.ts:180` `runGitClean` ← `runGitCleanPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 3
- [LIVE] `src/lib/safety/dangerous-git-ops.ts:207` `dryRunGitClean` ← `dryRunGitCleanPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/safety/dangerous-git-ops.ts:222` `runGitResetHard` ← `runGitResetHardPromise` · Effect.tryPromise · ext 2/self 0 · yield* 1 · tests 2
- [DEAD] `src/lib/safety/dangerous-git-ops.ts:239` `runGitCheckoutOverwrite` ← `runGitCheckoutOverwritePromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/session-format-converter.ts:305` `convertConversationTranscript` ← `convertConversationTranscriptPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/settings-api.ts:1530` `saveSettingsApi` ← `saveSettingsApiPromise` · Effect.tryPromise · ext 1/self 2 · yield* 1 · tests 41
- [LIVE] `src/lib/settings-api.ts:1544` `updateSettingsApi` ← `updateSettingsApiPromise` · Effect.tryPromise · ext 0/self 2 · yield* 0 · tests 0
- [DEAD] `src/lib/settings-api.ts:1558` `setRoleConfig` ← `setRoleConfigPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/settings-api.ts:1573` `updateProviderApiKey` ← `updateProviderApiKeyPromise` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 0
- [LIVE] `src/lib/settings-api.ts:1587` `saveOpenRouterFavorites` ← `saveOpenRouterFavoritesPromise` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 2
- [LIVE] `src/lib/settings-api.ts:1601` `saveDesignLanguage` ← `saveDesignLanguagePromise` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 8
- [LIVE] `src/lib/shadow-mode.ts:158` `resolveShadowMode` ← `resolveShadowModePromise` · Effect.tryPromise · ext 0/self 2 · yield* 0 · tests 5
- [LIVE] `src/lib/shadow-mode.ts:172` `isShadowModeEnabled` ← `isShadowModeEnabledPromise` · Effect.tryPromise · ext 0/self 1 · yield* 0 · tests 3
- [LIVE] `src/lib/shadow-mode.ts:186` `shouldSkipTrackerUpdate` ← `shouldSkipTrackerUpdatePromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 5
- [DEAD] `src/lib/shadow-mode.ts:202` `getShadowModeStatus` ← `getShadowModeStatusPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 3
- [DEAD] `src/lib/shadow-mode.ts:216` `getShadowModeSummary` ← `getShadowModeSummaryPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/shadow-state.ts:357` `getShadowState` ← `getShadowStatePromise` · Effect.tryPromise · ext 1/self 7 · yield* 0 · tests 11
- [LIVE] `src/lib/shadow-state.ts:372` `isShadowed` ← `isShadowedPromise` · Effect.tryPromise · ext 1/self 3 · yield* 0 · tests 7
- [LIVE] `src/lib/shadow-state.ts:385` `createShadowState` ← `createShadowStatePromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 20
- [LIVE] `src/lib/shadow-state.ts:402` `updateShadowState` ← `updateShadowStatePromise` · Effect.tryPromise · ext 4/self 0 · yield* 1 · tests 9
- [DEAD] `src/lib/shadow-state.ts:420` `updateTrackerStatusCache` ← `updateTrackerStatusCachePromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 2
- [DEAD] `src/lib/shadow-state.ts:435` `markAsSynced` ← `markAsSyncedPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 3
- [LIVE] `src/lib/shadow-state.ts:450` `listShadowedIssues` ← `listShadowedIssuesPromise` · Effect.tryPromise · ext 2/self 1 · yield* 0 · tests 2
- [DEAD] `src/lib/shadow-state.ts:462` `getDisplayStatus` ← `getDisplayStatusPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/shadow-state.ts:477` `needsSync` ← `needsSyncPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 6
- [DEAD] `src/lib/shadow-state.ts:490` `getUnsyncedHistory` ← `getUnsyncedHistoryPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 3
- [LIVE] `src/lib/shadow-state.ts:505` `getPendingSyncCount` ← `getPendingSyncCountPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/smee.ts:348` `startSmeeClient` ← `startSmeeClientPromise` · Effect.tryPromise · ext 0/self 1 · yield* 0 · tests 10
- [DEAD] `src/lib/smee.ts:361` `stopSmeeClient` ← `stopSmeeClientPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/stashes.ts:289` `listStashes` ← `listStashesPromise` · Effect.tryPromise · ext 4/self 1 · yield* 4 · tests 3
- [DEAD] `src/lib/stashes.ts:298` `createNamedStash` ← `createNamedStashPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 2
- [DEAD] `src/lib/stashes.ts:309` `popStash` ← `popStashPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/stashes.ts:320` `dropStash` ← `dropStashPromise` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 3
- [DEAD] `src/lib/stashes.ts:331` `applyStash` ← `applyStashPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/stashes.ts:342` `createRecoveryBranchFromStash` ← `createRecoveryBranchFromStashPromise` · Effect.tryPromise · ext 1/self 0 · yield* 1 · tests 3
- [LIVE] `src/lib/test-runner.ts:390` `runTests` ← `runTestsPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tmux.ts:999` `ensureManagedTmuxContextOnce` ← `ensureManagedTmuxContextOncePromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tmux.ts:1344` `capturePane` ← `capturePaneText` · Effect.tryPromise · ext 32/self 1 · yield* 5 · tests 57
- [LIVE] `src/lib/tmux.ts:1354` `listPaneValues` ← `listPaneValuesText` · Effect.tryPromise · ext 3/self 1 · yield* 1 · tests 30
- [LIVE] `src/lib/tts-daemon.ts:738` `resolveQwenTtsPackageDir` ← `resolveQwenTtsPackageDirPromise` · Effect.tryPromise · ext 0/self 2 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:745` `resolveTtsDaemonScript` ← `resolveTtsDaemonScriptPromise` · Effect.tryPromise · ext 0/self 2 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:752` `getTtsDaemonVenvDir` ← `getTtsDaemonVenvDirPromise` · Effect.tryPromise · ext 0/self 3 · yield* 0 · tests 4
- [LIVE] `src/lib/tts-daemon.ts:759` `getTtsDaemonPython` ← `getTtsDaemonPythonPromise` · Effect.tryPromise · ext 0/self 2 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:766` `hasTtsDaemonState` ← `hasTtsDaemonStatePromise` · Effect.promise · ext 1/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/tts-daemon.ts:770` `isTtsDaemonManuallyStopped` ← `isTtsDaemonManuallyStoppedPromise` · Effect.promise · ext 1/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/tts-daemon.ts:774` `getTtsDaemonAuthToken` ← `getTtsDaemonAuthTokenPromise` · Effect.tryPromise · ext 0/self 3 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:781` `getTtsDaemonAuthHeaders` ← `getTtsDaemonAuthHeadersPromise` · Effect.tryPromise · ext 4/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:788` `getTtsDaemonStatus` ← `getTtsDaemonStatusPromise` · Effect.tryPromise · ext 4/self 5 · yield* 0 · tests 7
- [LIVE] `src/lib/tts-daemon.ts:797` `waitForTtsDaemonHealth` ← `waitForTtsDaemonHealthPromise` · Effect.tryPromise · ext 0/self 1 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:807` `startTtsDaemon` ← `startTtsDaemonPromise` · Effect.tryPromise · ext 6/self 0 · yield* 0 · tests 7
- [LIVE] `src/lib/tts-daemon.ts:816` `runTtsDaemonForeground` ← `runTtsDaemonForegroundPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:825` `stopTtsDaemon` ← `stopTtsDaemonPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:834` `installTtsDaemonDependencies` ← `installTtsDaemonDependenciesPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-daemon.ts:841` `installTtsSystemdUnit` ← `installTtsSystemdUnitPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/tts-daemon.ts:848` `ttsDaemonInstallState` ← `ttsDaemonInstallStatePromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-speak.ts:206` `resolveAndSpeak` ← `resolveAndSpeakPromise` · Effect.tryPromise · ext 5/self 0 · yield* 0 · tests 45
- [LIVE] `src/lib/tts-voices.ts:67` `loadVoices` ← `loadVoicesPromise` · Effect.tryPromise · ext 7/self 5 · yield* 0 · tests 7
- [LIVE] `src/lib/tts-voices.ts:75` `saveVoices` ← `saveVoicesPromise` · Effect.tryPromise · ext 0/self 3 · yield* 0 · tests 1
- [LIVE] `src/lib/tts-voices.ts:85` `addVoice` ← `addVoicePromise` · Effect.tryPromise · ext 3/self 0 · yield* 0 · tests 9
- [LIVE] `src/lib/tts-voices.ts:95` `deleteVoice` ← `deleteVoicePromise` · Effect.tryPromise · ext 7/self 0 · yield* 0 · tests 9
- [LIVE] `src/lib/tts-voices.ts:103` `clearVoices` ← `clearVoicesPromise` · Effect.tryPromise · ext 3/self 0 · yield* 0 · tests 5
- [LIVE] `src/lib/tts-voices.ts:111` `findVoiceById` ← `findVoiceByIdPromise` · Effect.tryPromise · ext 7/self 0 · yield* 0 · tests 21
- [LIVE] `src/lib/tts-voices.ts:121` `findVoiceByName` ← `findVoiceByNamePromise` · Effect.tryPromise · ext 4/self 0 · yield* 0 · tests 8
- [LIVE] `src/lib/tunnel.ts:297` `addTunnelIngress` ← `addTunnelIngressPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tunnel.ts:315` `removeTunnelIngress` ← `removeTunnelIngressPromise` · Effect.tryPromise · ext 3/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/webhook-handlers.ts:414` `handleCheckSuite` ← `handleCheckSuitePromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 6
- [LIVE] `src/lib/webhook-handlers.ts:423` `handleCheckRun` ← `handleCheckRunPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 6
- [LIVE] `src/lib/webhook-handlers.ts:432` `handlePullRequest` ← `handlePullRequestPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 16
- [LIVE] `src/lib/webhook-handlers.ts:441` `handlePullRequestReview` ← `handlePullRequestReviewPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/webhook-handlers.ts:450` `handlePullRequestReviewComment` ← `handlePullRequestReviewCommentPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/webhook-handlers.ts:459` `handleIssueComment` ← `handleIssueCommentPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/webhook-handlers.ts:468` `handlePullRequestReviewThread` ← `handlePullRequestReviewThreadPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/webhook-handlers.ts:477` `handleStatus` ← `handleStatusPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 5
- [LIVE] `src/lib/work-agent-lifecycle.ts:356` `getWorkAgentLifecycleState` ← `getWorkAgentLifecycleStateSnapshot` · Effect.promise · ext 9/self 0 · yield* 9 · tests 8
- [DEAD] `src/lib/work/done-preflight.ts:104` `checkUncommittedChanges` ← `checkUncommittedChangesPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/work/done-preflight.ts:107` `runPreflightChecks` ← `runPreflightChecksPromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 4
- [LIVE] `src/lib/workspace-manager.ts:90` `createWorkspace` ← `createWorkspacePromise` · Effect.tryPromise · ext 11/self 0 · yield* 0 · tests 140
- [LIVE] `src/lib/workspace-manager.ts:108` `addReposToWorkspace` ← `addReposToWorkspacePromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/workspace-manager.ts:117` `addNewRepoToWorkspace` ← `addNewRepoToWorkspacePromise` · Effect.tryPromise · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/workspace-manager.ts:126` `getContainersReferencingWorkspacePath` ← `getContainersReferencingWorkspacePathPromise` · Effect.tryPromise · ext 2/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/workspace-manager.ts:136` `stopWorkspaceDocker` ← `stopWorkspaceDockerPromise` · Effect.tryPromise · ext 6/self 0 · yield* 1 · tests 32
- [LIVE] `src/lib/workspace-manager.ts:145` `removeWorkspace` ← `removeWorkspacePromise` · Effect.tryPromise · ext 3/self 0 · yield* 0 · tests 2
- [DEAD] `src/lib/xbrief/dag.ts:715` `readPlanFile` ← `readPlanFileFromDisk` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/xbrief/lifecycle-io.ts:433` `moveXBrief` ← `moveXBriefPromise` · Effect.tryPromise · ext 0/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/xbrief/lifecycle-io.ts:444` `transitionXBriefOnMain` ← `transitionXBriefOnMainPromise` · Effect.tryPromise · ext 11/self 0 · yield* 1 · tests 6

## B. Shape B — sync façades (301)

- [LIVE] `src/lib/activity-logger.ts:394` `emitActivityEntry` ← `emitActivityEntrySync` · Effect.sync · ext 8/self 0 · yield* 0 · tests 38
- [DEAD] `src/lib/activity-logger.ts:399` `emitActivityDetailed` ← `emitActivityDetailedSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/activity-logger.ts:404` `emitActivityTts` ← `emitActivityTtsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 5
- [DEAD] `src/lib/activity-logger.ts:409` `emitDashboardLifecycle` ← `emitDashboardLifecycleSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/agent-input-detection.ts:397` `detectAwaitingInputFromPane` ← `detectAwaitingInputFromPaneSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/agents/agent-state.ts:106` `getAgentState` ← `getAgentStateSync` · Effect.try · ext 81/self 6 · yield* 41 · tests 85
- [LIVE] `src/lib/backup.ts:136` `createBackup` ← `createBackupSync` · Effect.try · ext 4/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/backup.ts:149` `listBackups` ← `listBackupsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/backup.ts:180` `cleanOldBackups` ← `cleanOldBackupsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/bridge-token.ts:52` `readBridgeToken` ← `readBridgeTokenSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/bridge-token.ts:59` `writeBridgeToken` ← `writeBridgeTokenSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/child-env.ts:111` `buildChildEnv` ← `buildChildEnvSync` · Effect.sync · ext 1/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/child-env.ts:118` `buildChildEnvWithoutTmux` ← `buildChildEnvWithoutTmuxSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/claude-mcp.ts:87` `ensurePlaywrightIsolation` ← `ensurePlaywrightIsolationSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/claude-mcp.ts:92` `ensureExcalidrawMcp` ← `ensureExcalidrawMcpSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/claude-mcp.ts:97` `getIsolatedPlaywrightMcpConfig` ← `getIsolatedPlaywrightMcpConfigSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/claude-permissions.ts:173` `resolvePermissionMode` ← `resolvePermissionModeSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/claude-permissions.ts:179` `getClaudePermissionFlags` ← `getClaudePermissionFlagsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/claude-permissions.ts:184` `getClaudePermissionFlagsString` ← `getClaudePermissionFlagsStringSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/claude-permissions.ts:189` `bypassPrefixForAgentFlag` ← `bypassPrefixForAgentFlagSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/claude-permissions.ts:194` `buildClaudeUserSettings` ← `buildClaudeUserSettingsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cloister/database.ts:396` `writeHealthEvent` ← `writeHealthEventSync` · Effect.try · ext 1/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/database.ts:410` `writeHealthEvents` ← `writeHealthEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cloister/database.ts:424` `getHealthHistory` ← `getHealthHistorySync` · Effect.try · ext 4/self 0 · yield* 1 · tests 4
- [DEAD] `src/lib/cloister/database.ts:440` `getRecentHealthHistory` ← `getRecentHealthHistorySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/database.ts:455` `getAllHealthHistory` ← `getAllHealthHistorySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/database.ts:470` `getLatestHealthEvent` ← `getLatestHealthEventSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/database.ts:484` `getAgentsWithHistory` ← `getAgentsWithHistorySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/database.ts:496` `cleanupOldEvents` ← `cleanupOldEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/database.ts:510` `deleteAgentHistory` ← `deleteAgentHistorySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/database.ts:524` `getDatabaseStats` ← `getDatabaseStatsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/specialist-completion.ts:112` `hasPendingCompletion` ← `_pendingCompletions.has` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/specialist-logs.ts:574` `createRunLog` ← `createRunLogSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/specialist-logs.ts:586` `appendToRunLog` ← `appendToRunLogSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/specialist-logs.ts:598` `finalizeRunLog` ← `finalizeRunLogSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cloister/specialist-logs.ts:610` `getRunLog` ← `getRunLogSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cloister/specialist-logs.ts:621` `listRunLogs` ← `listRunLogsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cloister/specialist-logs.ts:632` `cleanupOldLogs` ← `cleanupOldLogsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cloister/specialist-logs.ts:643` `cleanupAllLogs` ← `cleanupAllLogsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/config-migration.ts:296` `needsMigration` ← `needsMigrationSync` · Effect.sync · ext 0/self 2 · yield* 0 · tests 0
- [LIVE] `src/lib/config-migration.ts:300` `hasLegacySettings` ← `hasLegacySettingsSync` · Effect.sync · ext 0/self 2 · yield* 0 · tests 0
- [DEAD] `src/lib/config-migration.ts:304` `convertToYamlConfig` ← `convertToYamlConfigSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/config-migration.ts:309` `migrateConfig` ← `migrateConfigSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/config-migration.ts:319` `getMigrationStatus` ← `getMigrationStatusSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/config-migration.ts:324` `cleanupLegacyRuntimeSymlinks` ← `cleanupLegacyRuntimeSymlinksSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/config-migration.ts:329` `migrateSyncTargets` ← `migrateSyncTargetsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/config-yaml/load.ts:594` `loadConfig` ← `loadConfigSync` · Effect.try · ext 14/self 0 · yield* 0 · tests 36
- [DEAD] `src/lib/config.ts:546` `getDefaultConfig` ← `getDefaultConfigSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/config.ts:550` `getDashboardApiUrl` ← `getDashboardApiUrlSync` · Effect.sync · ext 1/self 0 · yield* 0 · tests 3
- [DEAD] `src/lib/config.ts:554` `getDevrootPath` ← `getDevrootPathSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 2
- [DEAD] `src/lib/config.ts:558` `findDevrootForProject` ← `findDevrootForProjectSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:307` `appendSummary` ← `appendSummarySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:318` `logHistory` ← `logHistorySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:328` `searchHistory` ← `searchHistorySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:334` `getRecentHistory` ← `getRecentHistorySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/context.ts:340` `estimateTokens` ← `estimateTokensSync` · Effect.sync · ext 15/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:344` `checkContextBudget` ← `checkContextBudgetSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:350` `createContextBudget` ← `createContextBudgetSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:355` `materializeOutput` ← `materializeOutputSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:365` `listMaterialized` ← `listMaterializedSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/context.ts:371` `readMaterialized` ← `readMaterializedSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/conversations/correlator.ts:175` `buildCorrelationMap` ← `buildCorrelationMapSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/jsonl-parser.ts:548` `getProjectDirs` ← `getProjectDirsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cost-parsers/jsonl-parser.ts:555` `getSessionFiles` ← `getSessionFilesSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cost-parsers/jsonl-parser.ts:564` `getAllSessionFiles` ← `getAllSessionFilesSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/jsonl-parser.ts:571` `parseClaudeSession` ← `parseClaudeSessionSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cost-parsers/jsonl-parser.ts:580` `parseAllSessions` ← `parseAllSessionsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/jsonl-parser.ts:589` `getRecentSessions` ← `getRecentSessionsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/jsonl-parser.ts:598` `getActiveSessionModel` ← `getActiveSessionModelSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/ohmypi-parser.ts:448` `parseOhmypiSession` ← `parseOhmypiSessionSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/ohmypi-parser.ts:456` `parseOhmypiSessionCostEvents` ← `parseOhmypiSessionCostEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/pi-parser.ts:336` `parsePiSession` ← `parsePiSessionSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:270` `loadSessionMap` ← `loadSessionMapSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:277` `saveSessionMap` ← `saveSessionMapSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:286` `linkSessionToIssue` ← `linkSessionToIssueSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:297` `completeSession` ← `completeSessionSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:308` `getIssueSessions` ← `getIssueSessionsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:317` `getIssueCostSummary` ← `getIssueCostSummarySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:326` `getAllIssuesWithCosts` ← `getAllIssuesWithCostsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:336` `findSessionById` ← `findSessionByIdSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost-parsers/session-map.ts:345` `updateSessionFromJSONL` ← `updateSessionFromJSONLSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:664` `calculateCost` ← `calculateCostSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:670` `getPricing` ← `getPricingSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:676` `logCost` ← `logCostSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:685` `logUsage` ← `logUsageSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:694` `readCosts` ← `readCostsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:700` `readTodayCosts` ← `readTodayCostsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:704` `readIssueCosts` ← `readIssueCostsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:710` `summarizeCosts` ← `summarizeCostsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:715` `getDailySummary` ← `getDailySummarySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:717` `getWeeklySummary` ← `getWeeklySummarySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:719` `getMonthlySummary` ← `getMonthlySummarySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cost.ts:723` `createBudget` ← `createBudgetSync` · Effect.try · ext 2/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cost.ts:731` `getBudget` ← `getBudgetSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:733` `getAllBudgets` ← `getAllBudgetsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cost.ts:735` `updateBudgetSpent` ← `updateBudgetSpentSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cost.ts:744` `checkBudget` ← `checkBudgetSync` · Effect.sync · ext 2/self 0 · yield* 0 · tests 2
- [LIVE] `src/lib/cost.ts:747` `deleteBudget` ← `deleteBudgetSync` · Effect.try · ext 2/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/cost.ts:755` `generateReport` ← `generateReportSync` · Effect.sync · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cost.ts:761` `formatCost` ← `formatCostSync` · Effect.sync · ext 28/self 0 · yield* 0 · tests 2
- [DEAD] `src/lib/costs/aggregator.ts:377` `loadCache` ← `loadCacheSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/aggregator.ts:384` `saveCache` ← `saveCacheSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/aggregator.ts:391` `updateCacheFromEvents` ← `updateCacheFromEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/aggregator.ts:401` `rebuildCache` ← `rebuildCacheSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/aggregator.ts:408` `syncCache` ← `syncCacheSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/aggregator.ts:415` `getCostsByIssue` ← `getCostsByIssueSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/aggregator.ts:422` `getCostsForIssue` ← `getCostsForIssueSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/aggregator.ts:431` `setIssueBudget` ← `setIssueBudgetSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/events.ts:508` `appendCostEvent` ← `appendCostEventSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/events.ts:517` `readEvents` ← `readEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/costs/events.ts:526` `tailEvents` ← `tailEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/events.ts:535` `readEventsFromLine` ← `readEventsFromLineSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/events.ts:544` `getLastEventMetadata` ← `getLastEventMetadataSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/events.ts:551` `replaceEventsFile` ← `replaceEventsFileSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/events.ts:560` `deduplicateEvents` ← `deduplicateEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/migration.ts:513` `migrateAllSessions` ← `migrateAllSessionsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/costs/migration.ts:520` `needsMigration` ← `needsMigrationSync` · Effect.try · ext 0/self 2 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/migration.ts:527` `migrateIfNeeded` ← `migrateIfNeededSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/costs/retention.ts:140` `pruneOldEvents` ← `pruneOldEventsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/costs/retention.ts:149` `needsPruning` ← `needsPruningSync` · Effect.try · ext 0/self 4 · yield* 0 · tests 2
- [DEAD] `src/lib/costs/retention.ts:158` `getRetentionStatus` ← `getRetentionStatusSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cv.ts:292` `getAgentCV` ← `getAgentCVSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/cv.ts:296` `saveAgentCV` ← `saveAgentCVSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/cv.ts:304` `startWork` ← `startWorkSync` · Effect.try · ext 9/self 0 · yield* 0 · tests 13
- [DEAD] `src/lib/cv.ts:316` `completeWork` ← `completeWorkSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cv.ts:326` `getAgentRankings` ← `getAgentRankingsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/cv.ts:331` `formatCV` ← `formatCVSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/env-loader.ts:138` `loadOverdeckEnv` ← `loadOverdeckEnvSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/git-activity.ts:39` `appendGitOperation` ← `appendGitOperationSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 2
- [DEAD] `src/lib/git-activity.ts:51` `listGitOperations` ← `listGitOperationsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/harness-policy.ts:160` `canUseModelWithAuth` ← `canUseModelWithAuthSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/harness-policy.ts:167` `canUseHarness` ← `canUseHarnessSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:338` `initHook` ← `initHookSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:345` `getHook` ← `getHookSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:349` `pushToHook` ← `pushToHookSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:360` `checkHook` ← `checkHookSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:365` `popFromHook` ← `popFromHookSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:376` `clearHook` ← `clearHookSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:384` `reorderHookItems` ← `reorderHookItemsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:395` `sendMail` ← `sendMailSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:405` `collectMail` ← `collectMailSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/hooks.ts:409` `generateFixedPointPrompt` ← `generateFixedPointPromptSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/internal-token.ts:114` `getInternalToken` ← `getInternalTokenSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/internal-token.ts:121` `ensureInternalToken` ← `ensureInternalTokenSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/issue-id.ts:208` `parseIssueId` ← `parseIssueIdSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/issue-id.ts:215` `extractPrefix` ← `extractPrefixSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/issue-id.ts:219` `extractNumber` ← `extractNumberSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/issue-id.ts:223` `normalizeIssueId` ← `normalizeIssueIdSync` · Effect.sync · ext 24/self 0 · yield* 2 · tests 0
- [DEAD] `src/lib/issue-id.ts:227` `resolveIssueId` ← `resolveIssueIdSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/issue-id.ts:231` `resolveBareNumericId` ← `resolveBareNumericIdSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/issue-id.ts:238` `extractStandardPrefix` ← `extractStandardPrefixSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/issue-id.ts:243` `extractStandardNumber` ← `extractStandardNumberSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/launcher-generator.ts:1003` `generateLauncherScript` ← `generateLauncherScriptSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/launcher-generator.ts:1008` `generateLauncherWrapper` ← `generateLauncherWrapperSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/merge-set.ts:162` `upsertMergeSet` ← `upsertMergeSetSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 10
- [LIVE] `src/lib/merge-set.ts:169` `getMergeSet` ← `getMergeSetSync` · Effect.try · ext 7/self 0 · yield* 5 · tests 3
- [DEAD] `src/lib/merge-set.ts:176` `getAllMergeSets` ← `getAllMergeSetsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/merge-set.ts:183` `deleteMergeSet` ← `deleteMergeSetSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/merge-set.ts:190` `buildMergeSetForIssue` ← `buildMergeSetForIssueSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/merge-set.ts:197` `ensureMergeSetForIssue` ← `ensureMergeSetForIssueSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/merge-set.ts:207` `withRepoArtifactUrl` ← `withRepoArtifactUrlSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/merge-set.ts:216` `withRepoState` ← `withRepoStateSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-capabilities.ts:1479` `resolveModelId` ← `resolveModelIdSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 3
- [DEAD] `src/lib/model-capabilities.ts:1483` `getModelCapability` ← `getModelCapabilitySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 3
- [DEAD] `src/lib/model-capabilities.ts:1488` `getModelsBySkill` ← `getModelsBySkillSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-capabilities.ts:1493` `getModelsForProvider` ← `getModelsForProviderSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-capabilities.ts:1498` `getCheapestModels` ← `getCheapestModelsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-capabilities.ts:1502` `getValueScore` ← `getValueScoreSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-capabilities.ts:1508` `getAllSkillDimensions` ← `getAllSkillDimensionsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:565` `isOpenRouterModel` ← `isOpenRouterModelSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:569` `getModelProvider` ← `getModelProviderSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:574` `requiresExternalKey` ← `requiresExternalKeySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:579` `getModelsByProvider` ← `getModelsByProviderSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:584` `applyTierAwareFallback` ← `applyTierAwareFallbackSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:592` `applyFallback` ← `applyFallbackSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:598` `getFallbackModel` ← `getFallbackModelSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/model-fallback.ts:602` `detectEnabledProviders` ← `detectEnabledProvidersSync` · Effect.sync · ext 1/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:607` `filterAvailableModels` ← `filterAvailableModelsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-fallback.ts:614` `getAvailableModels` ← `getAvailableModelsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-validation.ts:52` `normalizeModelOverride` ← `normalizeModelOverrideSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-validation.ts:56` `requireModelOverride` ← `requireModelOverrideSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/model-validation.ts:60` `shellQuoteModelId` ← `shellQuoteModelIdSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/multi-tool-sync.ts:136` `resolveAlsoSyncTools` ← `resolveAlsoSyncToolsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/multi-tool-sync.ts:140` `syncSkillsToTools` ← `syncSkillsToToolsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/multi-tool-sync.ts:151` `runMultiToolSync` ← `runMultiToolSyncSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/pipeline-notifier.ts:95` `setPipelineHandler` ← `setPipelineHandlerSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/pipeline-notifier.ts:99` `notifyPipeline` ← `notifyPipelineSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 5
- [DEAD] `src/lib/platform-lifecycle.ts:761` `readPlatformConfig` ← `readPlatformConfigSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 5
- [DEAD] `src/lib/prd-draft.ts:80` `getPRDDraftPath` ← `getPRDDraftPathSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/prd-locations.ts:154` `canonicalPrdSubdir` ← `canonicalPrdSubdirSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/prd-locations.ts:162` `findPrdAtStatus` ← `findPrdAtStatusSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/prd-locations.ts:177` `findPrdAnywhere` ← `findPrdAnywhereSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/project-repos.ts:262` `normalizeForge` ← `normalizeForgeSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/project-repos.ts:267` `inferProjectForge` ← `inferProjectForgeSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/project-repos.ts:272` `resolveConfiguredRepos` ← `resolveConfiguredReposSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/project-repos.ts:283` `resolveProjectReposForIssue` ← `resolveProjectReposForIssueSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/project-repos.ts:290` `resolveProjectReposFromResolvedIssue` ← `resolveProjectReposFromResolvedIssueSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/projects.ts:1297` `initializeProjectsConfig` ← `initializeProjectsConfigSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/provider-health.ts:305` `invalidateProbeCache` ← `invalidateProbeCacheSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/providers.ts:691` `getProviderForModel` ← `getProviderForModelSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/providers.ts:695` `getProviderEnv` ← `getProviderEnvSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/release-set.ts:55` `upsertReleaseSet` ← `upsertReleaseSetSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/release-set.ts:61` `getReleaseSet` ← `getReleaseSetSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/release-set.ts:67` `getAllReleaseSets` ← `getAllReleaseSetsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/release-set.ts:73` `deleteReleaseSet` ← `deleteReleaseSetSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/release-set.ts:79` `withComponentState` ← `withComponentStateSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/remote/fly-api.ts:369` `createFlyApiClient` ← `createFlyApiClientSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/remote/workspace-metadata.ts:111` `saveWorkspaceMetadata` ← `saveWorkspaceMetadataSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/remote/workspace-metadata.ts:125` `loadWorkspaceMetadata` ← `loadWorkspaceMetadataSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/remote/workspace-metadata.ts:131` `listWorkspaceMetadata` ← `listWorkspaceMetadataSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/remote/workspace-metadata.ts:136` `findRemoteWorkspaceMetadata` ← `findRemoteWorkspaceMetadataSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/remote/workspace-metadata.ts:142` `deleteWorkspaceMetadata` ← `deleteWorkspaceMetadataSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/resource-utils.ts:38` `parseIssueIdFromText` ← `parseIssueIdFromTextSync` · Effect.sync · ext 1/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/resource-utils.ts:43` `parseContainerServiceName` ← `parseContainerServiceNameSync` · Effect.sync · ext 1/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtime/metrics.ts:344` `saveMetrics` ← `saveMetricsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtime/metrics.ts:352` `recordTask` ← `recordTaskSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtime/metrics.ts:362` `getRuntimeMetrics` ← `getRuntimeMetricsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtime/metrics.ts:368` `getAllRuntimeMetrics` ← `getAllRuntimeMetricsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtime/metrics.ts:373` `getAggregatedMetrics` ← `getAggregatedMetricsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/runtime/metrics.ts:378` `getIssueTasks` ← `getIssueTasksSync` · Effect.sync · ext 1/self 0 · yield* 1 · tests 1
- [DEAD] `src/lib/runtime/metrics.ts:383` `getRecentTasks` ← `getRecentTasksSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtime/metrics.ts:388` `clearMetrics` ← `clearMetricsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtimes/ohmypi-fifo.ts:153` `writeOhmypiCommand` ← `writeOhmypiCommandSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtimes/ohmypi-fifo.ts:170` `destroyOhmypiFifo` ← `destroyOhmypiFifoSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtimes/pi-fifo.ts:171` `writePiCommand` ← `writePiCommandSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/runtimes/pi-fifo.ts:188` `destroyPiFifo` ← `destroyPiFifoSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/settings.ts:355` `loadSettings` ← `loadSettingsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/settings.ts:359` `saveSettings` ← `saveSettingsSync` · Effect.try · ext 5/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/settings.ts:369` `validateSettings` ← `validateSettingsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/settings.ts:374` `getDefaultSettings` ← `getDefaultSettingsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/settings.ts:378` `getAvailableModels` ← `getAvailableModelsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/settings.ts:384` `isAnthropicModel` ← `isAnthropicModelSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/settings.ts:389` `getClaudeModelFlag` ← `getClaudeModelFlagSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/settings.ts:394` `getAgentCommand` ← `getAgentCommandSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/shell.ts:72` `detectShell` ← `detectShellSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/shell.ts:75` `getShellRcFile` ← `getShellRcFileSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/shell.ts:79` `hasAlias` ← `hasAliasSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/shell.ts:83` `addAlias` ← `addAliasSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/shell.ts:90` `getAliasInstructions` ← `getAliasInstructionsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/skills-merge.ts:366` `mergeSkillsIntoWorkspace` ← `mergeSkillsIntoWorkspaceSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/skills-merge.ts:376` `applyProjectTemplateOverlay` ← `applyProjectTemplateOverlaySync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/skills-merge.ts:386` `cleanupGitignore` ← `cleanupGitignoreSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/skills-merge.ts:396` `cleanupWorkspaceGitignore` ← `cleanupWorkspaceGitignoreSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/skills-merge.ts:410` `mergePanSkillsIntoWorkspace` ← `mergePanSkillsIntoWorkspaceSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/smart-model-selector.ts:484` `selectModel` ← `selectModelSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/smart-model-selector.ts:492` `selectAllModels` ← `selectAllModelsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/smart-model-selector.ts:499` `getSimpleModelMapping` ← `getSimpleModelMappingSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/smee.ts:374` `isSmeeRunning` ← `isSmeeRunningSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/smee.ts:378` `startSmeeProcess` ← `startSmeeProcessSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/smee.ts:382` `stopSmeeProcess` ← `stopSmeeProcessSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/smee.ts:386` `isSmeeProcessRunning` ← `isSmeeProcessRunningSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/supervisor.ts:197` `getSupervisorPort` ← `getSupervisorPortSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/supervisor.ts:201` `getSupervisorUrl` ← `getSupervisorUrlSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/supervisor.ts:205` `isSupervisorRunning` ← `isSupervisorRunningSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/supervisor.ts:213` `startSupervisorProcess` ← `startSupervisorProcessSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/supervisor.ts:226` `stopSupervisorProcess` ← `stopSupervisorProcessSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/sync.ts:1036` `isOverdeckSymlink` ← `isOverdeckSymlinkSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/sync.ts:1041` `migrateStalePersonalContent` ← `migrateStalePersonalContentSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 9
- [DEAD] `src/lib/sync.ts:1048` `removeLegacySkills070` ← `removeLegacySkills070Sync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/sync.ts:1055` `refreshCache` ← `refreshCacheSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/sync.ts:1062` `planSync` ← `planSyncSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/sync.ts:1069` `executeSync` ← `executeSyncSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/sync.ts:1076` `syncContextLayers` ← `syncContextLayersSync` · Effect.try · ext 2/self 0 · yield* 1 · tests 4
- [DEAD] `src/lib/sync.ts:1083` `planHooksSync` ← `planHooksSyncSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/sync.ts:1090` `syncHooks` ← `syncHooksSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/sync.ts:1097` `syncStatusline` ← `syncStatuslineSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/sync.ts:1104` `mirrorProjectSkills` ← `mirrorProjectSkillsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/sync.ts:1114` `syncPiSettings` ← `syncPiSettingsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/tldr-daemon.ts:499` `getTldrMetrics` ← `getTldrMetricsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/tldr-daemon.ts:510` `captureTldrMetrics` ← `captureTldrMetricsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/tldr-daemon.ts:520` `getTldrDaemonService` ← `getTldrDaemonServiceSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 2
- [DEAD] `src/lib/tldr-daemon.ts:527` `removeTldrDaemonService` ← `removeTldrDaemonServiceSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/tldr-daemon.ts:532` `listTldrDaemonServices` ← `listTldrDaemonServicesSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/tmux.ts:1371` `detectTerminalApiError` ← `detectTerminalApiErrorSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/tracker-utils.ts:182` `parseGitHubRepos` ← `parseGitHubReposSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/tracker-utils.ts:190` `resolveGitHubIssue` ← `resolveGitHubIssueSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 9
- [LIVE] `src/lib/tracker-utils.ts:200` `isGitHubIssue` ← `isGitHubIssueSync` · Effect.try · ext 14/self 0 · yield* 7 · tests 0
- [DEAD] `src/lib/tracker-utils.ts:211` `resolveTrackerType` ← `resolveTrackerTypeSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 6
- [DEAD] `src/lib/traefik.ts:245` `generateOverdeckTraefikConfig` ← `generateOverdeckTraefikConfigSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/traefik.ts:259` `cleanupTemplateFiles` ← `cleanupTemplateFilesSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/traefik.ts:271` `generateTlsConfig` ← `generateTlsConfigSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/traefik.ts:283` `ensureProjectCerts` ← `ensureProjectCertsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/traefik.ts:295` `cleanupStaleTlsSections` ← `cleanupStaleTlsSectionsSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/tts-speak.ts:194` `buildTtsSpeakPayload` ← `buildTtsSpeakPayloadSync` · Effect.sync · ext 1/self 0 · yield* 0 · tests 3
- [DEAD] `src/lib/webhook-handlers.ts:486` `isTrackedRepository` ← `isTrackedRepositorySync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/work-agent-lifecycle.ts:362` `assertCanStartFresh` ← `assertCanStartFreshSync` · Effect.try · ext 3/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/work-agent-lifecycle.ts:376` `assertCanResumeSession` ← `assertCanResumeSessionSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/work/done-preflight.ts:101` `checkIncompletePlanItems` ← `checkIncompletePlanItemsSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace-config.ts:439` `replacePlaceholders` ← `replacePlaceholdersSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace-config.ts:445` `getDefaultWorkspaceConfig` ← `getDefaultWorkspaceConfigSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace-config.ts:449` `getServiceFromTemplate` ← `getServiceFromTemplateSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace-manager.ts:62` `migrateOverdeckToPan` ← `migrateOverdeckToPanSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 1
- [DEAD] `src/lib/workspace-manager.ts:71` `copyOverdeckSettingsToWorkspace` ← `copyOverdeckSettingsToWorkspaceSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace-manager.ts:81` `ensurePanGitignore` ← `ensurePanGitignoreSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/workspace-manager.ts:99` `preTrustDirectory` ← `preTrustDirectorySync` · Effect.try · ext 9/self 0 · yield* 0 · tests 7
- [DEAD] `src/lib/workspace/devcontainer-renderer.ts:297` `createWorkspacePlaceholders` ← `createWorkspacePlaceholdersSync` · Effect.sync · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace/devcontainer-renderer.ts:308` `sanitizeComposeFile` ← `sanitizeComposeFileSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace/devcontainer-renderer.ts:317` `processTemplates` ← `processTemplatesSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [DEAD] `src/lib/workspace/devcontainer-renderer.ts:329` `renderDevcontainer` ← `renderDevcontainerSync` · Effect.try · ext 0/self 0 · yield* 0 · tests 0
- [LIVE] `src/lib/workspace/ensure-devcontainer.ts:157` `ensureDevcontainer` ← `ensureDevcontainerSync` · Effect.sync · ext 3/self 0 · yield* 0 · tests 1
- [LIVE] `src/lib/xbrief/lifecycle-io.ts:423` `findXBriefByIssue` ← `findXBriefByIssueSync` · Effect.try · ext 2/self 0 · yield* 1 · tests 16


## C. Shape C — true twins (82)

See PRD §10 for the per-row decision. Raw rows:

| # | Sync twin (`file:line`) | Other variant [kind] | Sync-twin callers in non-async fns | …in async/gen fns | Test refs | Other-variant prod refs | Twin blocks on child process | Decision |
|---|---|---|---|---|---|---|---|---|
| 1 | `src/lib/cloister/config.ts:644` `updateCloisterConfigSync` | `updateCloisterConfig` [effect] | 0 | 0 | 0 | 0 | no | C1 delete both (no prod caller) |
| 2 | `src/lib/cloister/cost-monitor.ts:165` `recordCostSync` | `recordCost` [effect] | 0 | 0 | 17 | 0 | no | C1 delete both (no prod caller) |
| 3 | `src/lib/cloister/cost-monitor.ts:362` `resetCostTrackingSync` | `resetCostTracking` [effect] | 0 | 0 | 2 | 0 | no | C1 delete both (no prod caller) |
| 4 | `src/lib/cloister/handoff-logger.ts:176` `readIssueHandoffEventsSync` | `readIssueHandoffEvents` [effect] | 0 | 0 | 0 | 0 | no | C1 delete both (no prod caller) |
| 5 | `src/lib/cloister/handoff-logger.ts:187` `readAgentHandoffEventsSync` | `readAgentHandoffEvents` [effect] | 0 | 0 | 0 | 0 | no | C1 delete both (no prod caller) |
| 6 | `src/lib/cloister/handoff-logger.ts:287` `updateHandoffOutcomeSync` | `updateHandoffOutcome` [effect] | 0 | 0 | 0 | 0 | no | C1 delete both (no prod caller) |
| 7 | `src/lib/cloister/handoff-logger.ts:330` `getPendingVerificationHandoffsSync` | `getPendingVerificationHandoffs` [effect] | 0 | 0 | 0 | 0 | no | C1 delete both (no prod caller) |
| 8 | `src/lib/cloister/task-readiness.ts:23` `isTaskReadySync` | `isTaskReady` [effect] | 0 | 0 | 11 | 0 | no | C1 delete both (no prod caller) |
| 9 | `src/lib/cloister/task-readiness.ts:56` `getUnblockedItemsSync` | `getUnblockedItems` [effect] | 0 | 0 | 7 | 0 | no | C1 delete both (no prod caller) |
| 10 | `src/lib/cloister/test-agent.ts:27` `detectTestCommandSync` | `detectTestCommand` [effect] | 0 | 0 | 20 | 0 | no | C1 delete both (no prod caller) |
| 11 | `src/lib/projects.ts:532` `saveProjectsConfigSync` | `saveProjectsConfig` [effect] | 0 | 0 | 5 | 0 | no | C1 delete both (no prod caller) |
| 12 | `src/lib/router-config.ts:90` `writeRouterConfigSync` | `writeRouterConfig` [effect] | 0 | 0 | 10 | 0 | no | C1 delete both (no prod caller) |
| 13 | `src/lib/runtimes/pi.ts:469` `createPiRuntimeSync` | `createPiRuntime` [sync] | 0 | 0 | 2 | 0 | no | C1 delete both (no prod caller) |
| 14 | `src/lib/xbrief/acceptance-criteria.ts:164` `checkAllCriteriaCompletedSync` | `checkAllCriteriaCompleted` [effect] | 0 | 0 | 6 | 0 | no | C1 delete both (no prod caller) |
| 15 | `src/lib/agents/agent-state.ts:516` `recordAgentFailureSync` | `recordAgentFailure` [effect] | 0 | 0 | 0 | 2 | no | C2 delete sync twin |
| 16 | `src/lib/projects.ts:612` `setProjectAutoMergeDefaultSync` | `setProjectAutoMergeDefault` [async] | 0 | 0 | 0 | 1 | no | C2 delete sync twin |
| 17 | `src/lib/projects.ts:689` `setProjectSwarmPolicySync` | `setProjectSwarmPolicy` [async] | 0 | 0 | 0 | 1 | no | C2 delete sync twin |
| 18 | `src/lib/projects.ts:718` `setProjectMergeTrainSync` | `setProjectMergeTrain` [async] | 0 | 0 | 0 | 1 | no | C2 delete sync twin |
| 19 | `src/lib/pty-token.ts:17` `readPtyTokenSync` | `readPtyToken` [async] | 0 | 0 | 2 | 5 | no | C2 delete sync twin |
| 20 | `src/lib/pty-token.ts:35` `writePtyTokenSync` | `writePtyToken` [async] | 0 | 0 | 9 | 5 | no | C2 delete sync twin |
| 21 | `src/lib/tmux.ts:695` `createSessionSync` | `createSession` [effect] | 0 | 0 | 7 | 15 | yes | C2 delete sync twin |
| 22 | `src/lib/tmux.ts:737` `sendKeysSync` | `sendKeys` [effect] | 0 | 0 | 0 | 8 | yes | C2 delete sync twin |
| 23 | `src/lib/xbrief/io.ts:468` `isPlanningCompleteSync` | `isPlanningComplete` [effect] | 0 | 0 | 7 | 4 | no | C2 delete sync twin |
| 24 | `src/lib/agents/supervisor-liveness.ts:45` `supervisorProcessAliveSync` | `supervisorProcessAlive` [async] | 1 | 0 | 9 | 0 | no | C3 delete unused async variant; keep sync — server sync sites: src/lib/cloister/confirmed-session-query.ts:20 |
| 25 | `src/lib/backup.ts:88` `restoreBackupSync` | `restoreBackup` [effect] | 0 | 2 | 4 | 0 | no | C3 delete unused Effect variant; keep sync |
| 26 | `src/lib/cloister/handoff-logger.ts:83` `logHandoffEventSync` | `logHandoffEvent` [effect] | 0 | 1 | 0 | 0 | no | C3 delete unused Effect variant; keep sync |
| 27 | `src/lib/costs/wal.ts:54` `appendToWalSync` | `appendToWal` [effect] | 1 | 0 | 7 | 0 | no | C3 delete unused Effect variant; keep sync |
| 28 | `src/lib/manifest.ts:39` `hashFileSync` | `hashFile` [effect] | 21 | 0 | 18 | 0 | no | C3 delete unused Effect variant; keep sync |
| 29 | `src/lib/manifest.ts:59` `readManifestSync` | `readManifest` [effect] | 8 | 0 | 4 | 0 | no | C3 delete unused Effect variant; keep sync |
| 30 | `src/lib/manifest.ts:78` `writeManifestSync` | `writeManifest` [effect] | 6 | 0 | 2 | 0 | no | C3 delete unused Effect variant; keep sync |
| 31 | `src/lib/manifest.ts:290` `collectSourceFilesSync` | `collectSourceFiles` [effect] | 14 | 0 | 3 | 0 | no | C3 delete unused Effect variant; keep sync |
| 32 | `src/lib/persistent-logger.ts:43` `logDeaconEventSync` | `logDeaconEvent` [effect] | 0 | 13 | 6 | 0 | no | C3 delete unused Effect variant; keep sync |
| 33 | `src/lib/persistent-logger.ts:53` `logAgentLifecycleSync` | `logAgentLifecycle` [effect] | 8 | 48 | 29 | 0 | no | C3 delete unused Effect variant; keep sync — server sync sites: src/dashboard/server/services/agent-projection.ts:55, src/dashboard/server/services/agent-projection.ts:276 |
| 34 | `src/lib/projects.ts:749` `findProjectByTeamSync` | `findProjectByTeam` [effect] | 4 | 22 | 20 | 0 | no | C3 delete unused Effect variant; keep sync — server sync sites: src/lib/cloister/work-agent-prompt.ts:503 |
| 35 | `src/lib/projects.ts:767` `findProjectByPathSync` | `findProjectByPath` [effect] | 9 | 22 | 60 | 0 | no | C3 delete unused Effect variant; keep sync — server sync sites: src/dashboard/server/routes/orders.ts:88, src/dashboard/server/services/uat-train.ts:96, src/lib/cloister/ci-failure-feedback.ts:137 |
| 36 | `src/lib/projects.ts:924` `hasProjectsSync` | `hasProjects` [effect] | 0 | 1 | 0 | 0 | no | C3 delete unused Effect variant; keep sync |
| 37 | `src/lib/providers.ts:642` `setupCredentialFileAuthSync` | `setupCredentialFileAuth` [effect] | 0 | 4 | 2 | 0 | no | C3 delete unused Effect variant; keep sync |
| 38 | `src/lib/providers.ts:675` `clearCredentialFileAuthSync` | `clearCredentialFileAuth` [effect] | 0 | 4 | 2 | 0 | no | C3 delete unused Effect variant; keep sync |
| 39 | `src/lib/runtime/claude.ts:29` `createClaudeAdapterSync` | `createClaudeAdapter` [sync] | 3 | 0 | 0 | 0 | no | C3 delete unused sync variant; keep sync |
| 40 | `src/lib/runtime/metrics.ts:110` `loadMetricsSync` | `loadMetrics` [effect] | 7 | 0 | 0 | 0 | no | C3 delete unused Effect variant; keep sync |
| 41 | `src/lib/runtimes/claude-code.ts:444` `createClaudeCodeRuntimeSync` | `createClaudeCodeRuntime` [sync] | 1 | 0 | 3 | 0 | no | C3 delete unused sync variant; keep sync |
| 42 | `src/lib/runtimes/codex.ts:916` `createCodexRuntimeSync` | `createCodexRuntime` [sync] | 1 | 0 | 1 | 0 | no | C3 delete unused sync variant; keep sync |
| 43 | `src/lib/runtimes/ohmypi.ts:412` `createOhmypiRuntimeSync` | `createOhmypiRuntime` [sync] | 1 | 0 | 1 | 0 | no | C3 delete unused sync variant; keep sync |
| 44 | `src/lib/tmux.ts:677` `querySessionSync` | `querySession` [effect] | 2 | 0 | 6 | 0 | yes | C3 delete unused Effect variant; keep sync + S: convert server-reachable sync callers to the async variant — server sync sites: src/lib/cloister/confirmed-session-query.ts:7 |
| 45 | `src/lib/xbrief/lifecycle.ts:141` `ensureXBriefDirsSync` | `ensureXBriefDirs` [effect] | 0 | 2 | 18 | 0 | no | C3 delete unused Effect variant; keep sync |
| 46 | `src/lib/agents/agent-state.ts:274` `setAgentPausedSync` | `setAgentPaused` [effect] | 0 | 4 | 18 | 5 | no | C4 delete sync twin; its callers await the other variant |
| 47 | `src/lib/agents/agent-state.ts:353` `clearAgentPausedSync` | `clearAgentPaused` [effect] | 0 | 4 | 23 | 4 | no | C4 delete sync twin; its callers await the other variant |
| 48 | `src/lib/agents/agent-state.ts:398` `clearAgentTroubledSync` | `clearAgentTroubled` [effect] | 0 | 1 | 16 | 2 | no | C4 delete sync twin; its callers await the other variant |
| 49 | `src/lib/agents/runtime-pid-probe.ts:120` `findAgentRuntimePidInSubtreeSync` | `findAgentRuntimePidInSubtree` [async] | 0 | 0 | 8 | 2 | yes | C4 delete sync twin; its callers await the other variant |
| 50 | `src/lib/config-yaml/load.ts:33` `getConversationsConfigSync` | `getConversationsConfig` [effect] | 0 | 5 | 1 | 10 | no | C4 delete sync twin; its callers await the other variant |
| 51 | `src/lib/agents/activity.ts:268` `getLatestSessionIdSync` | `getLatestSessionId` [effect] | 3 | 8 | 26 | 2 | no | C5 delete the Effect variant (<=2 prod refs); its callers call the sync twin — server sync sites: src/dashboard/server/routes/agents/shared.ts:279 |
| 52 | `src/lib/cloister/config.ts:590` `loadCloisterConfigSync` | `loadCloisterConfig` [effect] | 15 | 6 | 25 | 2 | no | C5 delete the Effect variant (<=2 prod refs); its callers call the sync twin — server sync sites: src/dashboard/server/routes/cloister.ts:181, src/dashboard/server/services/cloister-control-surface.ts:46, src/lib/cloister/concurrency.ts:63 |
| 53 | `src/lib/overdeck/control-settings.ts:413` `isDeaconGloballyPausedSync` | `isDeaconGloballyPaused` [sync] | 2 | 1 | 12 | 4 | no | C5 alias pair (both sync): keep `isDeaconGloballyPaused`, delete the other — server sync sites: src/lib/cloister/deacon-swarm.ts:239 |
| 54 | `src/lib/overdeck/control-settings.ts:428` `setDeaconGloballyPausedSync` | `setDeaconGloballyPaused` [sync] | 1 | 0 | 0 | 2 | no | C5 alias pair (both sync): keep `setDeaconGloballyPaused`, delete the other |
| 55 | `src/lib/overdeck/control-settings.ts:529` `getFlywheelActiveRunIdSync` | `getFlywheelActiveRunId` [sync] | 2 | 0 | 2 | 2 | no | C5 alias pair (both sync): keep `getFlywheelActiveRunIdSync`, delete the other |
| 56 | `src/lib/projects.ts:860` `resolveProjectFromIssueSync` | `resolveProjectFromIssue` [effect] | 44 | 74 | 184 | 1 | no | C5 delete the Effect variant (<=2 prod refs); its callers call the sync twin |
| 57 | `src/lib/tmux.ts:984` `getAgentSessionsSync` | `getAgentSessions` [effect] | 1 | 0 | 11 | 1 | no | C5 delete the Effect variant (<=2 prod refs); its callers call the sync twin |
| 58 | `src/lib/xbrief/acceptance-criteria.ts:82` `extractAcceptanceCriteriaSync` | `extractAcceptanceCriteria` [effect] | 1 | 0 | 6 | 2 | no | C5 delete the Effect variant (<=2 prod refs); its callers call the sync twin |
| 59 | `src/lib/agents/agent-state.ts:128` `saveAgentStateSync` | `saveAgentState` [effect] | 16 | 36 | 83 | 28 | no | C6 keep both; header lists the sync callers |
| 60 | `src/lib/agents/liveness.ts:224` `isAliveSync` | `isAlive` [async] | 2 | 0 | 6 | 16 | no | C6 keep both; header lists the sync callers |
| 61 | `src/lib/agents/queries.ts:17` `listRunningAgentsSync` | `listRunningAgents` [effect] | 10 | 8 | 36 | 14 | no | C6 keep both; header lists the sync callers — server sync sites: src/dashboard/server/services/cloister-control-surface.ts:36, src/lib/cloister/concurrency.ts:94, src/lib/cloister/concurrency.ts:128 |
| 62 | `src/lib/agents/runtime-state.ts:88` `getAgentRuntimeStateSync` | `getAgentRuntimeState` [effect] | 12 | 13 | 52 | 15 | no | C6 keep both; header lists the sync callers — server sync sites: src/lib/cloister/concurrency.ts:372 |
| 63 | `src/lib/agents/termination.ts:155` `stopAgentSync` | `stopAgent` [effect] | 1 | 7 | 28 | 36 | no | C6 keep both; header lists the sync callers — server sync sites: src/lib/cloister/concurrency.ts:384 |
| 64 | `src/lib/cloister/config.ts:624` `saveCloisterConfigSync` | `saveCloisterConfig` [effect] | 2 | 1 | 4 | 3 | no | C6 keep both; header lists the sync callers — server sync sites: src/lib/cloister/config.ts:600, src/lib/cloister/config.ts:647 |
| 65 | `src/lib/cloister/handoff-logger.ts:148` `readHandoffEventsSync` | `readHandoffEvents` [effect] | 4 | 0 | 0 | 3 | no | C6 keep both; header lists the sync callers — server sync sites: src/lib/cloister/handoff-logger.ts:177, src/lib/cloister/handoff-logger.ts:188, src/lib/cloister/handoff-logger.ts:219 |
| 66 | `src/lib/projects-config-lock.ts:65` `acquireProjectsConfigLockSync` | `acquireProjectsConfigLock` [async] | 1 | 0 | 2 | 2 | no | C6 keep both; header lists the sync callers |
| 67 | `src/lib/projects-config-write.ts:51` `atomicWriteProjectsConfigSync` | `atomicWriteProjectsConfig` [async] | 3 | 0 | 0 | 2 | no | C6 keep both; header lists the sync callers |
| 68 | `src/lib/projects-config-write.ts:103` `withProjectsConfigWriteSync` | `withProjectsConfigWrite` [async] | 3 | 0 | 0 | 2 | no | C6 keep both; header lists the sync callers |
| 69 | `src/lib/projects-config-write.ts:136` `updateProjectsConfigTextSync` | `updateProjectsConfigText` [async] | 1 | 0 | 0 | 2 | no | C6 keep both; header lists the sync callers |
| 70 | `src/lib/projects.ts:459` `loadProjectsConfigSync` | `loadProjectsConfig` [effect] | 16 | 5 | 21 | 6 | no | C6 keep both; header lists the sync callers |
| 71 | `src/lib/projects.ts:543` `listProjectsSync` | `listProjects` [effect] | 28 | 34 | 98 | 16 | no | C6 keep both; header lists the sync callers — server sync sites: src/dashboard/server/routes/misc/meta.ts:135, src/dashboard/server/routes/misc/trackers.ts:75 |
| 72 | `src/lib/projects.ts:916` `getProjectSync` | `getProject` [effect] | 22 | 34 | 85 | 11 | no | C6 keep both; header lists the sync callers — server sync sites: src/dashboard/server/routes/orders.ts:80 |
| 73 | `src/lib/runtimes/muse-session.ts:44` `resolveMuseSessionPathSync` | `resolveMuseSessionPath` [async] | 2 | 0 | 0 | 8 | no | C6 keep both; header lists the sync callers |
| 74 | `src/lib/tmux.ts:597` `listSessionsSync` | `listSessions` [effect] | 7 | 1 | 22 | 32 | yes | C6 keep both; header lists the sync callers |
| 75 | `src/lib/tmux.ts:619` `listSessionNamesSync` | `listSessionNames` [effect] | 4 | 4 | 14 | 40 | no | C6 keep both; header lists the sync callers — server sync sites: src/lib/cloister/swarm-foreman.ts:18 |
| 76 | `src/lib/tmux.ts:687` `sessionExistsSync` | `sessionExists` [effect] | 6 | 6 | 90 | 99 | yes | C6 keep both; header lists the sync callers + S: convert server-reachable sync callers to the async variant — server sync sites: src/lib/cloister/agent-death.ts:46 |
| 77 | `src/lib/tmux.ts:725` `killSessionSync` | `killSession` [effect] | 2 | 0 | 20 | 34 | yes | C6 keep both; header lists the sync callers |
| 78 | `src/lib/ui-theme.ts:44` `getUiThemeSync` | `getUiTheme` [async] | 1 | 0 | 2 | 1 | no | C6 keep both; header lists the sync callers |
| 79 | `src/lib/xbrief/io.ts:175` `findWorkspaceDraftPlanSync` | `findWorkspaceDraftPlan` [effect] | 1 | 1 | 0 | 3 | no | C6 keep both; header lists the sync callers |
| 80 | `src/lib/xbrief/io.ts:207` `findPlanSync` | `findPlan` [effect] | 8 | 7 | 17 | 13 | no | C6 keep both; header lists the sync callers |
| 81 | `src/lib/xbrief/io.ts:253` `readPlanSync` | `readPlan` [effect] | 10 | 2 | 20 | 12 | no | C6 keep both; header lists the sync callers |
| 82 | `src/lib/xbrief/io.ts:435` `readWorkspacePlanSync` | `readWorkspacePlan` [effect] | 10 | 11 | 76 | 7 | no | C6 keep both; header lists the sync callers — server sync sites: src/lib/cloister/handoff-context.ts:173, src/lib/cloister/task-readiness.ts:24 |


## D. `*Async` / `*Promise` exported pairs (20)

- `src/lib/cloister/review-context.ts:473` `buildReviewContextPromise` (Promise) + `buildReviewContext` [effect] · twin prod refs 1 · base prod refs 1
- `src/lib/cloister/review-monitor.ts:66` `waitForReviewerOutputsPromise` (Promise) + `waitForReviewerOutputs` [effect] · twin prod refs 0 · base prod refs 0
- `src/lib/cloister/review-verdict-report.ts:28` `findVerdictReportAsync` (Async) + `findVerdictReport` [sync] · twin prod refs 0 · base prod refs 1
- `src/lib/cloister/uat-failure-feedback.ts:69` `relayUatFailureFeedbackPromise` (Promise) + `relayUatFailureFeedback` [effect] · twin prod refs 1 · base prod refs 0
- `src/lib/concurrency.ts:3` `withConcurrencyLimitPromise` (Promise) + `withConcurrencyLimit` [effect] · twin prod refs 3 · base prod refs 7
- `src/lib/github-app.ts:482` `getCiCheckRunsStatePromise` (Promise) + `getCiCheckRunsState` [effect] · twin prod refs 3 · base prod refs 0
- `src/lib/github-app.ts:575` `listPullRequestsForHeadPromise` (Promise) + `listPullRequestsForHead` [effect] · twin prod refs 1 · base prod refs 5
- `src/lib/github-app.ts:604` `getIssueStatePromise` (Promise) + `getIssueState` [effect] · twin prod refs 1 · base prod refs 2
- `src/lib/github-app.ts:613` `listOpenIssuesWithLabelsPromise` (Promise) + `listOpenIssuesWithLabels` [effect] · twin prod refs 2 · base prod refs 0
- `src/lib/orders/io.ts:35` `readOrderBookAsync` (Async) + `readOrderBook` [sync] · twin prod refs 1 · base prod refs 3
- `src/lib/orders/resolver.ts:157` `getBookAsync` (Async) + `getBook` [sync] · twin prod refs 1 · base prod refs 10
- `src/lib/planning/auto-spawn-consent.ts:113` `readAutoSpawnOnFinalizeFlagAsync` (Async) + `readAutoSpawnOnFinalizeFlag` [sync] · twin prod refs 2 · base prod refs 0
- `src/lib/prd-locations.ts:121` `findDraftPrdAsync` (Async) + `findDraftPrd` [effect] · twin prod refs 1 · base prod refs 1
- `src/lib/projects.ts:579` `resolveProjectKeyForCwdAsync` (Async) + `resolveProjectKeyForCwd` [sync] · twin prod refs 1 · base prod refs 0
- `src/lib/projects.ts:1159` `listProjectsAsync` (Async) + `listProjects` [effect] · twin prod refs 10 · base prod refs 16
- `src/lib/runtimes/kimi-code.ts:180` `waitForNewKimiSessionAsync` (Async) + `waitForNewKimiSession` [async] · twin prod refs 7 · base prod refs 1
- `src/lib/tmux.ts:1197` `sendKeysAsync` (Async) + `sendKeys` [effect] · twin prod refs 5 · base prod refs 8
- `src/lib/tts-daemon.ts:114` `resolveQwenTtsPackageDirPromise` (Promise) + `resolveQwenTtsPackageDir` [effect] · twin prod refs 1 · base prod refs 2
- `src/lib/work/done-preflight.ts:39` `checkIncompletePlanItemsPromise` (Promise) + `checkIncompletePlanItems` [effect] · twin prod refs 3 · base prod refs 0
- `src/lib/xbrief/continue-state.ts:251` `readItemStatusesAsync` (Async) + `readItemStatuses` [sync] · twin prod refs 1 · base prod refs 12

## E. Dead exports (name index, approximate — confirm with tsc)

```text
exports scanned 4771
exported, referenced nowhere (not even own file): 222
exported, referenced only inside own file (drop export keyword): 488
exported, referenced only by tests (and not own file): 229
exported, referenced by tests + own file only: 678
top files (unused + test-only unused):
   12 src/lib/cost.ts
   10 src/lib/hooks.ts
   9 src/lib/context.ts
   9 src/lib/overdeck/control-settings.ts
   9 src/lib/overdeck/conversations.ts
   9 src/lib/paths.ts
   8 src/lib/model-capabilities.ts
   8 src/lib/model-fallback.ts
   7 src/lib/agent-runtime.ts
   7 src/lib/cloister/merge-agent.ts
   7 src/lib/merge-set.ts
   7 src/lib/projects.ts
   7 src/lib/tmux.ts
   6 src/lib/checkpoint/checkpoint-manager.ts
   6 src/lib/cloister/reap-terminal-sessions.ts
   6 src/lib/settings.ts
   6 src/lib/xbrief/dag.ts
   5 src/lib/cloister/handoff-logger.ts
   5 src/lib/config-migration.ts
   5 src/lib/cv.ts
   5 src/lib/harness-policy.ts
   5 src/lib/project-repos.ts
   5 src/lib/shell.ts
   5 src/lib/cloister/cost-monitor.ts
   5 src/lib/cloister/health.ts
```

Rows (`DEAD` = no reference anywhere, not even its own file; `TESTONLY` = referenced only by tests):

```text
DEAD src/lib/agent-runtime.ts 120 emitWaitingStart
DEAD src/lib/agent-runtime.ts 126 emitWaitingClear
DEAD src/lib/agent-runtime.ts 131 emitModelSet
DEAD src/lib/agent-runtime.ts 138 emitMessageReceived
DEAD src/lib/agent-runtime.ts 144 emitChannelReply
DEAD src/lib/agent-runtime.ts 149 emitResolution
DEAD src/lib/agent-runtime.ts 155 emitContextSaturationChanged
DEAD src/lib/agents/agent-state-source.ts 39 readActiveReviewArtifactContext
DEAD src/lib/agents/pinned-launch.ts 43 readPinnedAgentLaunchSync
DEAD src/lib/agents/runtime-command.ts 102 getPiLauncherFields
DEAD src/lib/agents/spawn-prep.ts 393 selectHardestPlanItem
DEAD src/lib/agents/tier-escalation.ts 93 decideVerificationFailureEscalation
DEAD src/lib/agents/tier-supervisor.ts 240 shouldHaltDispatch
DEAD src/lib/artifacts/thumbnails.ts 78 readPlaceholderThumbnail
DEAD src/lib/artifacts/thumbnails.ts 145 readThumbnailFile
DEAD src/lib/boot-no-resume.ts 28 isExplicitNoResumeRequest
DEAD src/lib/bridge-token.ts 52 readBridgeToken
DEAD src/lib/checkpoint/checkpoint-manager.ts 540 hasCheckpoint
DEAD src/lib/checkpoint/checkpoint-manager.ts 582 diffCheckpointToHead
DEAD src/lib/checkpoint/checkpoint-manager.ts 638 deleteAllCheckpoints
DEAD src/lib/checkpoint/checkpoint-manager.ts 657 pruneStaleCheckpointRefs
DEAD src/lib/checkpoint/checkpoint-manager.ts 701 diffSinceCommit
DEAD src/lib/checkpoint/checkpoint-manager.ts 761 runCheckpointGit
DEAD src/lib/claude-permissions.ts 184 getClaudePermissionFlagsString
DEAD src/lib/claude-settings-overlay.ts 206 injectProviderEnvOverlay
DEAD src/lib/claude-settings-overlay.ts 271 removeProviderEnvOverlay
DEAD src/lib/cloister/config.ts 644 updateCloisterConfigSync
DEAD src/lib/cloister/config.ts 654 getCloisterConfigPath
DEAD src/lib/cloister/confirmed-session-query.ts 35 consumeConfirmedSessionDetail
DEAD src/lib/cloister/deacon-swarm-record.ts 29 readSwarmSupersededAttempts
DEAD src/lib/cloister/handoff-logger.ts 176 readIssueHandoffEventsSync
DEAD src/lib/cloister/handoff-logger.ts 187 readAgentHandoffEventsSync
DEAD src/lib/cloister/handoff-logger.ts 203 getHandoffStats
DEAD src/lib/cloister/handoff-logger.ts 287 updateHandoffOutcomeSync
DEAD src/lib/cloister/handoff-logger.ts 330 getPendingVerificationHandoffsSync
DEAD src/lib/cloister/handoff.ts 208 shouldHandoff
DEAD src/lib/cloister/idle-stack-reaper.ts 121 resetIdleStackGraceClock
DEAD src/lib/cloister/label-reconciler.ts 67 reconcilePipelineLabelsPatrol
DEAD src/lib/cloister/memory-verdict-cache.ts 57 setCachedMemoryVerdictForTests
DEAD src/lib/cloister/merge-agent.ts 909 logMergeHistory
DEAD src/lib/cloister/merge-agent.ts 986 captureTmuxOutput
DEAD src/lib/cloister/merge-agent.ts 1051 isMergeAgentRunning
DEAD src/lib/cloister/merge-agent.ts 1058 sendMessageToAgent
DEAD src/lib/cloister/planning-wedge.ts 235 readAgentBackgroundTaskWedgeEvidence
DEAD src/lib/cloister/reap-terminal-sessions.ts 81 isAdvancingLifecycleReclaimable
DEAD src/lib/cloister/review-agent.ts 807 isReviewStaleSync
DEAD src/lib/cloister/review-verdict-report.ts 28 findVerdictReportAsync
DEAD src/lib/cloister/specialist-completion.ts 58 waitForSpecialistCompletion
DEAD src/lib/cloister/specialist-completion.ts 112 hasPendingCompletion
DEAD src/lib/cloister/specialist-completion.ts 119 cancelAllPendingCompletions
DEAD src/lib/cloister/stall-sweeper.ts 285 forgetResolvedSweeperRows
DEAD src/lib/cloister/test-verdict.ts 160 resetUnsignaledTestEscalationsForTests
DEAD src/lib/cloister/test-verdict.ts 164 recordUnsignaledTestEscalation
DEAD src/lib/cloister/test-verdict.ts 185 resolveSlotFeedbackAgentId
DEAD src/lib/cloister/uat-assemble-deps.ts 26 buildUatAssembleSession
DEAD src/lib/cloister/verification-types.ts 22 INTERRUPTED_VERIFICATION_NOTE
DEAD src/lib/config-migration.ts 309 migrateConfig
DEAD src/lib/config-migration.ts 319 getMigrationStatus
DEAD src/lib/config.ts 558 findDevrootForProject
DEAD src/lib/context.ts 307 appendSummary
DEAD src/lib/context.ts 318 logHistory
DEAD src/lib/context.ts 328 searchHistory
DEAD src/lib/context.ts 334 getRecentHistory
DEAD src/lib/context.ts 344 checkContextBudget
DEAD src/lib/context.ts 350 createContextBudget
DEAD src/lib/context.ts 355 materializeOutput
DEAD src/lib/context.ts 365 listMaterialized
DEAD src/lib/context.ts 371 readMaterialized
DEAD src/lib/conversations/hash-resolver.ts 191 resolveJsonl
DEAD src/lib/cost-parsers/jsonl-parser.ts 510 importSessionToCostLog
DEAD src/lib/cost.ts 676 logCost
DEAD src/lib/cost.ts 685 logUsage
DEAD src/lib/cost.ts 694 readCosts
DEAD src/lib/cost.ts 700 readTodayCosts
DEAD src/lib/cost.ts 704 readIssueCosts
DEAD src/lib/cost.ts 715 getDailySummary
DEAD src/lib/cost.ts 717 getWeeklySummary
DEAD src/lib/cost.ts 719 getMonthlySummary
DEAD src/lib/cost.ts 731 getBudget
DEAD src/lib/cost.ts 733 getAllBudgets
DEAD src/lib/cost.ts 735 updateBudgetSpent
DEAD src/lib/cv.ts 296 saveAgentCV
DEAD src/lib/cv.ts 316 completeWork
DEAD src/lib/cv.ts 326 getAgentRankings
DEAD src/lib/cv.ts 331 formatCV
DEAD src/lib/db-provisioners/flyway-postgres.ts 588 getFlywayPostgresSnapshotHelp
DEAD src/lib/dns.ts 207 restartDnsmasq
DEAD src/lib/docker-stats.ts 255 getDockerNetworks
DEAD src/lib/docker-stats.ts 277 getDockerVolumes
DEAD src/lib/env-loader.ts 119 hasEnvFile
DEAD src/lib/env-loader.ts 126 getEnvFilePath
DEAD src/lib/flywheel-state-retention.ts 195 compactFlywheelStateFile
DEAD src/lib/harness-policy.ts 52 ACP_KIMI_ONLY_BLOCK_REASON
DEAD src/lib/harness-policy.ts 59 KIMI_CODE_KIMI_ONLY_BLOCK_REASON
DEAD src/lib/harness-policy.ts 68 KIMI_NATIVE_ID_FOREIGN_HARNESS_BLOCK_REASON
DEAD src/lib/harness-policy.ts 160 canUseModelWithAuth
DEAD src/lib/health.ts 109 sendHealthNudge
DEAD src/lib/hooks.ts 338 initHook
DEAD src/lib/hooks.ts 345 getHook
DEAD src/lib/hooks.ts 349 pushToHook
DEAD src/lib/hooks.ts 360 checkHook
DEAD src/lib/hooks.ts 365 popFromHook
DEAD src/lib/hooks.ts 376 clearHook
DEAD src/lib/hooks.ts 395 sendMail
DEAD src/lib/hooks.ts 405 collectMail
DEAD src/lib/hooks.ts 409 generateFixedPointPrompt
DEAD src/lib/lifecycle/auto-close-out-canonical-state.ts 19 sweepAutoCloseOutCache
DEAD src/lib/linear-mcp-auth.ts 266 appendLinearMcpAuthRequiredEvent
DEAD src/lib/memory/poller.ts 230 getTranscriptPoller
DEAD src/lib/memory/poller.ts 250 unregisterTranscriptForPolling
DEAD src/lib/memory/query-expansion.ts 78 getCachedMemoryQueryExpansion
DEAD src/lib/memory/worker-pool.ts 324 getMemoryExtractionWorkerPool
DEAD src/lib/memory/worker-pool.ts 328 getMemoryPipelineWorkerPool
DEAD src/lib/memory/worker-pool.ts 332 enqueueMemoryExtractionJob
DEAD src/lib/memory/worker-pool.ts 340 enqueueReconciledMemoryExtractionJobs
DEAD src/lib/merge-set.ts 176 getAllMergeSets
DEAD src/lib/merge-set.ts 190 buildMergeSetForIssue
DEAD src/lib/merge-set.ts 207 withRepoArtifactUrl
DEAD src/lib/merge-set.ts 216 withRepoState
DEAD src/lib/model-capabilities.ts 1488 getModelsBySkill
DEAD src/lib/model-capabilities.ts 1493 getModelsForProvider
DEAD src/lib/model-capabilities.ts 1498 getCheapestModels
DEAD src/lib/model-capabilities.ts 1502 getValueScore
DEAD src/lib/model-capabilities.ts 1508 getAllSkillDimensions
DEAD src/lib/model-fallback.ts 565 isOpenRouterModel
DEAD src/lib/model-fallback.ts 584 applyTierAwareFallback
DEAD src/lib/model-validation.ts 52 normalizeModelOverride
DEAD src/lib/model-validation.ts 56 requireModelOverride
DEAD src/lib/model-validation.ts 60 shellQuoteModelId
DEAD src/lib/overdeck/claude-session-file-search.ts 93 findSubagentTranscriptById
DEAD src/lib/overdeck/control-settings.ts 234 SettingsApi
DEAD src/lib/overdeck/control-settings.ts 386 setBootReconciliationDecision
DEAD src/lib/overdeck/control-settings.ts 407 setBootReconciliationGrace
DEAD src/lib/overdeck/control-settings.ts 458 setFlywheelActiveRunId
DEAD src/lib/overdeck/control-settings.ts 509 ConfigApi
DEAD src/lib/overdeck/conversations.ts 1205 listArchivedConversationNames
DEAD src/lib/overdeck/conversations.ts 1327 markAllEndedOnStartup
DEAD src/lib/overdeck/conversations.ts 1465 clearStuckForks
DEAD src/lib/overdeck/conversations.ts 1575 setImportedConversationLinks
DEAD src/lib/overdeck/cost-sync.ts 116 getCostBreakdownByStageAndModelSync
DEAD src/lib/overdeck/issues.ts 308 IssueWriterLive
DEAD src/lib/overdeck/issues.ts 310 IssuesApi
DEAD src/lib/overdeck/merge.ts 131 QueueEntryStatus
DEAD src/lib/overdeck/observability.ts 136 ObservabilityRpcLive
DEAD src/lib/overdeck/process-services.ts 505 EmptyProcessServicesLive
DEAD src/lib/pan-dir/context.ts 44 workspaceContextTmpPath
DEAD src/lib/paths.ts 39 HANDOFFS_DIR
DEAD src/lib/paths.ts 254 CACHE_SKILLS_DIR
DEAD src/lib/paths.ts 264 DOCS_INDEX_FILE
DEAD src/lib/paths.ts 265 DOCS_BUDGET_STATE_FILE
DEAD src/lib/paths.ts 266 DOCS_DISABLE_STATE_FILE
DEAD src/lib/paths.ts 267 DOCS_TELEMETRY_FILE
DEAD src/lib/paths.ts 385 sessionIdFromFile
DEAD src/lib/pipeline-notifier.ts 95 setPipelineHandler
DEAD src/lib/platform-lifecycle.ts 669 describeStageFailure
DEAD src/lib/prereqs/registry.ts 147 getMissingToolsForFeature
DEAD src/lib/project-repos.ts 262 normalizeForge
DEAD src/lib/project-repos.ts 267 inferProjectForge
DEAD src/lib/project-repos.ts 272 resolveConfiguredRepos
DEAD src/lib/project-repos.ts 283 resolveProjectReposForIssue
DEAD src/lib/project-repos.ts 290 resolveProjectReposFromResolvedIssue
DEAD src/lib/projects.ts 689 setProjectSwarmPolicySync
DEAD src/lib/projects.ts 932 createDefaultProjectsConfig
DEAD src/lib/projects.ts 1071 getSpecialistPromptOverride
DEAD src/lib/projects.ts 1293 hasProjects
DEAD src/lib/provider-health.ts 305 invalidateProbeCache
DEAD src/lib/providers.ts 510 getDirectProviders
DEAD src/lib/providers.ts 733 clearCredentialFileAuth
DEAD src/lib/release-set.ts 61 getReleaseSet
DEAD src/lib/release-set.ts 67 getAllReleaseSets
DEAD src/lib/release-set.ts 79 withComponentState
DEAD src/lib/remote/index.ts 54 getRemoteProvider
DEAD src/lib/remote/workspace-metadata.ts 125 loadWorkspaceMetadata
DEAD src/lib/remote/workspace-metadata.ts 131 listWorkspaceMetadata
DEAD src/lib/remote/workspace-metadata.ts 136 findRemoteWorkspaceMetadata
DEAD src/lib/remote/workspace-metadata.ts 142 deleteWorkspaceMetadata
DEAD src/lib/runtime-census.ts 185 resetRuntimeCensusForTests
DEAD src/lib/runtime/index.ts 21 createRuntimeRegistry
DEAD src/lib/runtime/index.ts 116 registryGetAvailable
DEAD src/lib/runtime/index.ts 122 registrySyncToAll
DEAD src/lib/runtime/interface.ts 216 DEFAULT_FEATURES
DEAD src/lib/settings.ts 384 isAnthropicModel
DEAD src/lib/settings.ts 389 getClaudeModelFlag
DEAD src/lib/settings.ts 394 getAgentCommand
DEAD src/lib/shadow-utils.ts 46 formatState
DEAD src/lib/shell.ts 72 detectShell
DEAD src/lib/shell.ts 75 getShellRcFile
DEAD src/lib/shell.ts 79 hasAlias
DEAD src/lib/shell.ts 83 addAlias
DEAD src/lib/shell.ts 90 getAliasInstructions
DEAD src/lib/skills-merge.ts 376 applyProjectTemplateOverlay
DEAD src/lib/smart-model-selector.ts 484 selectModel
DEAD src/lib/smart-model-selector.ts 492 selectAllModels
DEAD src/lib/smart-model-selector.ts 499 getSimpleModelMapping
DEAD src/lib/state-migration-manifest.ts 42 verifyStateMigrationManifest
DEAD src/lib/supervisor.ts 197 getSupervisorPort
DEAD src/lib/supervisor.ts 201 getSupervisorUrl
DEAD src/lib/supervisor.ts 205 isSupervisorRunning
DEAD src/lib/supervisor.ts 226 stopSupervisorProcess
DEAD src/lib/sync.ts 1036 isOverdeckSymlink
DEAD src/lib/systemd.ts 161 uninstallSupervisorUnit
DEAD src/lib/terminal-backends/herdr-api.ts 444 setHerdrApiClient
DEAD src/lib/tldr-daemon.ts 527 removeTldrDaemonService
DEAD src/lib/tldr-daemon.ts 532 listTldrDaemonServices
DEAD src/lib/tmux.ts 942 confirmDelivery
DEAD src/lib/tmux.ts 1110 querySession
DEAD src/lib/tmux.ts 1381 getReviewSessions
DEAD src/lib/work-agent-lifecycle.ts 376 assertCanResumeSession
DEAD src/lib/work/done-preflight.ts 101 checkIncompletePlanItems
DEAD src/lib/workspace-config.ts 439 replacePlaceholders
DEAD src/lib/workspace-config.ts 445 getDefaultWorkspaceConfig
DEAD src/lib/workspace-config.ts 449 getServiceFromTemplate
DEAD src/lib/xbrief/dag.ts 266 blockingParentTotal
DEAD src/lib/xbrief/dag.ts 271 deriveSynthesisMetadata
DEAD src/lib/xbrief/dag.ts 559 isTaskCommand
DEAD src/lib/xbrief/dag.ts 589 applyTaskOperation
DEAD src/lib/xbrief/dag.ts 681 activePlanWriters
DEAD src/lib/xbrief/dag.ts 727 verifyActiveSlicePromptReduction
DEAD src/lib/xbrief/io.ts 373 readTierRetries
DEAD src/lib/xbrief/io.ts 389 recordTierRetry
DEAD src/lib/xbrief/lifecycle-io.ts 364 writeContinueStateForIssue
DEAD src/lib/xbrief/lifecycle.ts 131 resolveXBriefRoot
TESTONLY src/lib/acp/host.ts 786 readPersistedAcpSessionId
TESTONLY src/lib/acp/runtime-model.ts 455 parsePermissionRequest
TESTONLY src/lib/agent-directory-cleanup.ts 107 getPlanningIssueId
TESTONLY src/lib/agent-input-detection.ts 397 detectAwaitingInputFromPane
TESTONLY src/lib/agents/delivery.ts 85 resetDeliveryBackendSelection
TESTONLY src/lib/agents/dispatch-tier.ts 78 chooseTierAssignment
TESTONLY src/lib/agents/fast-track.ts 91 escalateFastTrackItem
TESTONLY src/lib/agents/fast-track.ts 122 groupFastTrack
TESTONLY src/lib/agents/fast-track.ts 177 autoMergeFastTrackBatch
TESTONLY src/lib/agents/monitor-transport.ts 85 isMonitorLive
TESTONLY src/lib/agents/runtime-command.ts 98 hasAgentRuntimeInSubtree
TESTONLY src/lib/agents/spawn-prep.ts 181 applyTierAssignment
TESTONLY src/lib/agents/supervisor-liveness.ts 51 supervisorProcessAlive
TESTONLY src/lib/agents/tier-metrics.ts 48 readTierFeedDeliveries
TESTONLY src/lib/agents/tier-metrics.ts 64 computeWarmHitFractions
TESTONLY src/lib/artifacts/index-store.ts 224 createArtifactIndexRepository
TESTONLY src/lib/backlog/backlog-auto-trigger.ts 51 startPeriodicReviewPass
TESTONLY src/lib/backlog/backlog-auto-trigger.ts 65 stopPeriodicReviewPass
TESTONLY src/lib/backlog/pickup.ts 233 selectUnblockTargets
TESTONLY src/lib/boot-no-resume.ts 37 getNoResumeMode
TESTONLY src/lib/claude-permissions.ts 173 resolvePermissionMode
TESTONLY src/lib/claude-permissions.ts 179 getClaudePermissionFlags
TESTONLY src/lib/cloister/agent-death.ts 40 describeAgentDeath
TESTONLY src/lib/cloister/agent-gc.ts 187 confirmLiveAgentTerminality
TESTONLY src/lib/cloister/agent-grace.ts 3 isStartingWithinGrace
TESTONLY src/lib/cloister/autonomous-work-dispatch.ts 64 clearAutonomousWorkDispatchCaches
TESTONLY src/lib/cloister/bridge-pool-patrol.ts 43 __resetBridgePoolPatrolState
TESTONLY src/lib/cloister/ci-failure-feedback.ts 106 resetCiFailureFeedbackStateForTests
TESTONLY src/lib/cloister/complexity.ts 94 detectComplexity
TESTONLY src/lib/cloister/concurrency.ts 93 describeRunningAgents
TESTONLY src/lib/cloister/concurrency.ts 285 resetPatrolDispatchBudget
TESTONLY src/lib/cloister/concurrency.ts 309 releaseAdvancingSlot
TESTONLY src/lib/cloister/confirmed-session-query.ts 6 queryConfirmedSession
TESTONLY src/lib/cloister/conflict-gate.ts 235 __resetConflictGateProbeCacheForTests
TESTONLY src/lib/cloister/cost-monitor.ts 165 recordCostSync
TESTONLY src/lib/cloister/cost-monitor.ts 304 getAgentCost
TESTONLY src/lib/cloister/cost-monitor.ts 314 getIssueCost
TESTONLY src/lib/cloister/cost-monitor.ts 323 getDailyTotal
TESTONLY src/lib/cloister/cost-monitor.ts 362 resetCostTrackingSync
TESTONLY src/lib/cloister/database.ts 107 closeHealthDatabase
TESTONLY src/lib/cloister/deacon-api-recovery.ts 36 __resetApiErrorRecoveryStateForTests
TESTONLY src/lib/cloister/deacon-lite.ts 41 __resetStuckWorkAgentCooldownForTests
TESTONLY src/lib/cloister/deacon-lite.ts 191 __resetStalledReviewCooldownForTests
TESTONLY src/lib/cloister/deacon-swarm-record.ts 350 persistAndVerifySwarmSlotCompletion
TESTONLY src/lib/cloister/disk-pressure-patrol.ts 119 resetDiskPressurePatrolForTests
TESTONLY src/lib/cloister/health.ts 143 getMultipleAgentHealth
TESTONLY src/lib/cloister/health.ts 220 getAgentsToPoke
TESTONLY src/lib/cloister/health.ts 230 getAgentsToKill
TESTONLY src/lib/cloister/health.ts 267 getHealthEmoji
TESTONLY src/lib/cloister/health.ts 288 getHealthLabel
TESTONLY src/lib/cloister/hygiene-scheduler.ts 86 isHygieneSchedulerRunning
TESTONLY src/lib/cloister/idle-stack-reaper.ts 79 __resetIdleStackReaperState
TESTONLY src/lib/cloister/memory-governor.ts 105 resetGovernorModeForTests
TESTONLY src/lib/cloister/memory-governor.ts 354 canAdmit
TESTONLY src/lib/cloister/memory-pressure-patrol.ts 362 __resetMemoryPressurePatrolState
TESTONLY src/lib/cloister/merge-agent.ts 1010 scanGitPatterns
TESTONLY src/lib/cloister/merge-agent.ts 1153 scanForConflictMarkers
TESTONLY src/lib/cloister/merge-agent.ts 1327 runProjectQualityGates
TESTONLY src/lib/cloister/merge-completeness.ts 220 reconcileStrandedRepos
TESTONLY src/lib/cloister/merged-docker-cleanup-worker.ts 143 resetMergedDockerCleanupWorkerForTests
TESTONLY src/lib/cloister/merged-docker-cleanup-worker.ts 148 getMergedDockerCleanupStateForTests
TESTONLY src/lib/cloister/modal-detector.ts 43 paneShowsModelSwitch
TESTONLY src/lib/cloister/modal-detector.ts 65 handleKnownAgentModal
TESTONLY src/lib/cloister/parked-residue.ts 67 reconcileTerminalIssueResidue
TESTONLY src/lib/cloister/preemption.ts 207 tryYieldForAdvancingDispatch
TESTONLY src/lib/cloister/prompts.ts 188 loadPromptFrontmatter
TESTONLY src/lib/cloister/reap-terminal-sessions.ts 150 selectMergedWorkSessions
TESTONLY src/lib/cloister/reap-terminal-sessions.ts 170 selectMergedAdvancingSessions
TESTONLY src/lib/cloister/reap-terminal-sessions.ts 191 selectNonMergedTerminalAdvancingSessions
TESTONLY src/lib/cloister/reap-terminal-sessions.ts 213 isIdlePastThreshold
TESTONLY src/lib/cloister/reap-terminal-sessions.ts 252 selectAwaitingTestWorkSessions
TESTONLY src/lib/cloister/resource-pressure-patrol.ts 9 patrolResourcePressure
TESTONLY src/lib/cloister/review-convoy-liveness.ts 24 evaluateReviewConvoyLiveness
TESTONLY src/lib/cloister/review-verdict-report.ts 41 parseVerdictReport
TESTONLY src/lib/cloister/service.ts 799 setCloisterService
TESTONLY src/lib/cloister/specialist-context.ts 341 hasContextDigest
TESTONLY src/lib/cloister/specialist-context.ts 355 deleteContextDigest
TESTONLY src/lib/cloister/specialist-handoff-logger.ts 68 logSpecialistHandoff
TESTONLY src/lib/cloister/specialist-handoff-logger.ts 85 createSpecialistHandoff
TESTONLY src/lib/cloister/specialist-handoff-logger.ts 149 readIssueSpecialistHandoffs
TESTONLY src/lib/cloister/specialist-handoff-logger.ts 220 getTodaySpecialistHandoffs
TESTONLY src/lib/cloister/specialist-logs.ts 475 checkLogSizeLimit
TESTONLY src/lib/cloister/stale-check-classifier.ts 70 selectRerunCandidates
TESTONLY src/lib/cloister/stale-check-github.ts 20 listRecentMainRuns
TESTONLY src/lib/cloister/stale-check-github.ts 38 listPrHeadFailingRuns
TESTONLY src/lib/cloister/stale-check-github.ts 67 getPrHead
TESTONLY src/lib/cloister/stale-check-github.ts 81 rerunFailedRun
TESTONLY src/lib/cloister/swarm-failed-slot.ts 14 SWARM_SUPERSEDED_RETENTION
TESTONLY src/lib/cloister/swarm-failed-slot.ts 30 nextSwarmSlotIndex
TESTONLY src/lib/cloister/swarm-slot-reconcile.ts 197 listSlotOwnership
TESTONLY src/lib/cloister/test-verdict.ts 110 decideUnsignaledTestAction
TESTONLY src/lib/cloister/uat-failure-feedback.ts 168 relayUatFailureFeedback
TESTONLY src/lib/cloister/uat-promote-notify.ts 36 notifyFlywheelOfUatPromote
TESTONLY src/lib/codex-auth.ts 207 paneShowsCodexAuthBurn
TESTONLY src/lib/codex-auth.ts 226 isCodexAuthRouted
TESTONLY src/lib/codex-auth.ts 263 applyCodexAuthBurnFlag
TESTONLY src/lib/compliance/triggers.ts 38 matchMemoryFirstTriggerPhrases
TESTONLY src/lib/config-migration.ts 304 convertToYamlConfig
TESTONLY src/lib/config-migration.ts 324 cleanupLegacyRuntimeSymlinks
TESTONLY src/lib/config-migration.ts 329 migrateSyncTargets
TESTONLY src/lib/config-yaml/domain-mergers.ts 152 mergeRtkConfigs
TESTONLY src/lib/config-yaml/domain-mergers.ts 234 mergeDocsConfigs
TESTONLY src/lib/config.ts 536 saveConfig
TESTONLY src/lib/config.ts 546 getDefaultConfig
TESTONLY src/lib/config.ts 554 getDevrootPath
TESTONLY src/lib/conversation-search/chunker.ts 129 chunkConversationJsonlFile
TESTONLY src/lib/conversation-search/health.ts 46 resetConversationSearchHealthForTests
TESTONLY src/lib/conversations/switch-strategy.ts 26 getEffectiveTargetWindow
TESTONLY src/lib/conversations/switch-strategy.ts 41 decideSwitchStrategy
TESTONLY src/lib/conversations/system-probe.ts 74 resetSystemCapabilitiesCache
TESTONLY src/lib/cost.ts 710 summarizeCosts
TESTONLY src/lib/cv.ts 292 getAgentCV
TESTONLY src/lib/docker-stats.ts 68 resetCachedDockerContainerLifecycleSnapshotForTests
TESTONLY src/lib/docs/corpus.ts 100 loadDocsCorpus
TESTONLY src/lib/docs/index-builder.ts 386 deterministicDocsTestEmbedding
TESTONLY src/lib/flywheel-merge-order.ts 83 planMergeTrain
TESTONLY src/lib/flywheel-merge-order.ts 92 declaredIssueFootprint
TESTONLY src/lib/flywheel-merge-order.ts 172 planUatCandidate
TESTONLY src/lib/github-graphql-cooldown.ts 25 noteGraphQLRateLimit
TESTONLY src/lib/github-graphql-cooldown.ts 30 isInGraphQLCooldown
TESTONLY src/lib/harness-policy.ts 45 OHMYPI_ANTHROPIC_SUBSCRIPTION_BLOCK_REASON
TESTONLY src/lib/harness-resolve.ts 15 resetHarnessResolveCachesForTests
TESTONLY src/lib/harness-skill-sync.ts 24 SKILL_SYNC_HARNESSES
TESTONLY src/lib/hooks.ts 384 reorderHookItems
TESTONLY src/lib/internal-token.ts 103 _resetInternalTokenCacheForTests
TESTONLY src/lib/issue-id.ts 238 extractStandardPrefix
TESTONLY src/lib/issue-id.ts 243 extractStandardNumber
TESTONLY src/lib/launcher-generator.ts 1008 generateLauncherWrapper
TESTONLY src/lib/lifecycle/archive-planning.ts 82 inferBranchFromWorkspace
TESTONLY src/lib/linear-mcp-auth.ts 187 _resetLinearMcpAuthProjectionCacheForTests
TESTONLY src/lib/manifest.ts 361 readManifest
TESTONLY src/lib/memory/paths.ts 40 resolveIssueMemoryRoot
TESTONLY src/lib/memory/paths.ts 69 resolveCheckpointFile
TESTONLY src/lib/memory/pending.ts 37 setStatusRollupEnqueuer
TESTONLY src/lib/memory/pending.ts 45 setStatusRollupProcessor
TESTONLY src/lib/memory/session-briefing.ts 192 readSessionBriefingMarker
TESTONLY src/lib/memory/settings.ts 89 clearMemorySettingsCache
TESTONLY src/lib/merge-set.ts 142 patchMergeSetRepoSync
TESTONLY src/lib/merge-set.ts 151 patchMergeSetReposSync
TESTONLY src/lib/merge-set.ts 197 ensureMergeSetForIssue
TESTONLY src/lib/model-capabilities.ts 1401 modelSupportsEffortSync
TESTONLY src/lib/model-capabilities.ts 1479 resolveModelId
TESTONLY src/lib/model-capabilities.ts 1483 getModelCapability
TESTONLY src/lib/model-fallback.ts 569 getModelProvider
TESTONLY src/lib/model-fallback.ts 574 requiresExternalKey
TESTONLY src/lib/model-fallback.ts 579 getModelsByProvider
TESTONLY src/lib/model-fallback.ts 592 applyFallback
TESTONLY src/lib/model-fallback.ts 598 getFallbackModel
TESTONLY src/lib/model-fallback.ts 607 filterAvailableModels
TESTONLY src/lib/openai-auth.ts 153 getOpenAIAuthStatusSync
TESTONLY src/lib/orders/resolver.ts 127 ensureOrderIssueStore
TESTONLY src/lib/overdeck/affected-criteria.ts 13 parseAffectedCriteria
TESTONLY src/lib/overdeck/control-settings.ts 73 SettingsResolverLive
TESTONLY src/lib/overdeck/control-settings.ts 133 SettingsWriterLive
TESTONLY src/lib/overdeck/control-settings.ts 330 getLastCleanShutdownAt
TESTONLY src/lib/overdeck/control-settings.ts 395 stampBootReconciliation
TESTONLY src/lib/overdeck/conversation-forks.ts 261 __setForkPipelineRuntimeOverridesForTest
TESTONLY src/lib/overdeck/conversation-forks.ts 265 __resetForkPipelineRuntimeOverridesForTest
TESTONLY src/lib/overdeck/conversation-forks.ts 592 getInFlightForkPipelineCount
TESTONLY src/lib/overdeck/conversations.ts 255 ConversationsResolverLive
TESTONLY src/lib/overdeck/conversations.ts 318 TranscriptsResolverLive
TESTONLY src/lib/overdeck/conversations.ts 376 TranscriptsWriterLive
TESTONLY src/lib/overdeck/conversations.ts 416 ConversationWriterLive
TESTONLY src/lib/overdeck/conversations.ts 1527 importLegacyConversation
TESTONLY src/lib/overdeck/cost-sync.ts 527 queryCostEventsSync
TESTONLY src/lib/overdeck/discovered-sessions.ts 19 resetDiscoveredSessionsSchemaBootstrap
TESTONLY src/lib/overdeck/event-reads.ts 68 listAgentRuntimeEventEvidenceSync
TESTONLY src/lib/overdeck/infra.ts 543 closeOverdeckDatabaseSync
TESTONLY src/lib/overdeck/merge.ts 425 MergeResolverLive
TESTONLY src/lib/overdeck/merge.ts 530 MergeWriterLive
TESTONLY src/lib/overdeck/merge.ts 948 getQueueForProject
TESTONLY src/lib/overdeck/observability.ts 110 ObservabilityLive
TESTONLY src/lib/overdeck/planning-promotion.ts 208 completePlanningFilesToStage
TESTONLY src/lib/overdeck/title-refinement.ts 123 resetTitleRefinementState
TESTONLY src/lib/paths.ts 63 LEGACY_RUNTIME_DIRS
TESTONLY src/lib/paths.ts 297 getDocsDir
TESTONLY src/lib/persistent-logger.ts 71 logDeaconEvent
TESTONLY src/lib/persistent-logger.ts 83 logAgentLifecycle
TESTONLY src/lib/planning/spawn-planning-session.ts 161 buildPlanningAgentState
TESTONLY src/lib/platform-lifecycle.ts 761 readPlatformConfig
TESTONLY src/lib/projects.ts 718 setProjectMergeTrainSync
TESTONLY src/lib/projects.ts 1215 findProjectByTeam
TESTONLY src/lib/projects.ts 1228 findProjectByPath
TESTONLY src/lib/projects/create-errors.ts 200 timedOutFailure
TESTONLY src/lib/projects/create-errors.ts 225 unknownOutcomeFailure
TESTONLY src/lib/projects/create.ts 271 __resetRemoteProbeMemoForTests
TESTONLY src/lib/providers.ts 691 getProviderForModel
TESTONLY src/lib/pty-token.ts 17 readPtyTokenSync
TESTONLY src/lib/pty-token.ts 35 writePtyTokenSync
TESTONLY src/lib/remote/fly-api.ts 369 createFlyApiClient
TESTONLY src/lib/remote/remote-completion.ts 83 resetRemoteClaudeCredentialRefreshForTests
TESTONLY src/lib/remote/remote-completion.ts 100 refreshClaudeCredentialsForActiveRemoteAgents
TESTONLY src/lib/router-config.ts 38 generateRouterConfigFromWorkTypes
TESTONLY src/lib/router-config.ts 90 writeRouterConfigSync
TESTONLY src/lib/router-config.ts 104 getRouterConfigPath
TESTONLY src/lib/runtimes/index.ts 160 setGlobalRegistry
TESTONLY src/lib/settings.ts 355 loadSettings
TESTONLY src/lib/settings.ts 369 validateSettings
TESTONLY src/lib/settings.ts 374 getDefaultSettings
TESTONLY src/lib/shadow-mode.ts 121 hasProjectShadowConfig
TESTONLY src/lib/skills-merge.ts 386 cleanupGitignore
TESTONLY src/lib/skills-merge.ts 396 cleanupWorkspaceGitignore
TESTONLY src/lib/skills-merge.ts 410 mergePanSkillsIntoWorkspace
TESTONLY src/lib/stashes.ts 258 getNextReviewTempSequence
TESTONLY src/lib/stashes.ts 269 isOlderThanDays
TESTONLY src/lib/stashes.ts 298 createNamedStash
TESTONLY src/lib/stashes.ts 309 popStash
TESTONLY src/lib/stashes.ts 331 applyStash
TESTONLY src/lib/state-migration-lock.ts 22 acquireStateMigrationLock
TESTONLY src/lib/terminal-backends/prompt-guard.ts 101 resetPromptGuard
TESTONLY src/lib/terminal-backends/registry.ts 31 registeredTerminalBackends
TESTONLY src/lib/terminal-backends/select.ts 164 resetHostTerminalBackendName
TESTONLY src/lib/tldr-daemon.ts 520 getTldrDaemonService
TESTONLY src/lib/tmux.ts 290 _resetWarnedManagedServerDirtyForTest
TESTONLY src/lib/tmux.ts 695 createSessionSync
TESTONLY src/lib/tmux.ts 737 sendKeysSync
TESTONLY src/lib/tmux.ts 1371 detectTerminalApiError
TESTONLY src/lib/transcript-landing.ts 126 hasNewTranscriptUserRecord
TESTONLY src/lib/webhook-handlers.ts 486 isTrackedRepository
TESTONLY src/lib/workspace/devcontainer-renderer.ts 297 createWorkspacePlaceholders
TESTONLY src/lib/workspace/stack-health.ts 472 resetWorkspaceStackHealthTransitionsForTests
TESTONLY src/lib/workspaces/create.ts 209 clearParentBranchCache
TESTONLY src/lib/workspaces/resolver.ts 84 getWorkspaceByName
TESTONLY src/lib/xbrief/io.ts 456 isPlanningProposed
TESTONLY src/lib/xbrief/io.ts 468 isPlanningCompleteSync
TESTONLY src/lib/xbrief/lifecycle-io.ts 331 promoteXBriefToProposed
TESTONLY src/lib/xbrief/quality-lint.ts 400 qualityLintErrors
TESTONLY src/lib/xbrief/swarm-readiness.ts 56 resolveIssueFootprint
TESTONLY src/lib/xbrief/xbrief-index.ts 143 resetXBriefIndex
```


## F. Per-harness storage knowledge (all non-test `src/`; rows under `src/lib/runtimes/` are today's owners, every other row is a W9 site to classify)

```text
== claude-projects: 30 files, 62 lines
   src/cli/commands/conversations/index.ts:31,33
   src/cli/commands/conversations/scan.ts:2
   src/dashboard/frontend/src/App.tsx:516
   src/dashboard/server/routes/agents/control.ts:158
   src/dashboard/server/routes/palette.ts:234
   src/dashboard/server/services/conversation-lifecycle.ts:270,347,360,513,523
   src/dashboard/server/services/conversation-search-watcher.ts:289
   src/dashboard/server/services/conversation/session-files.ts:15,17
   src/lib/agent-enrichment.ts:180
   src/lib/agents/activity.ts:141
   src/lib/agents/transcript-resolver.ts:209,237
   src/lib/claude-settings-overlay.ts:73,74,75,93,94
   src/lib/conversation-search/indexer.ts:369
   src/lib/conversations/harness-discovery.ts:32
   src/lib/conversations/hash-resolver.ts:123,126,129
   src/lib/conversations/scanner.ts:4,10
   src/lib/conversations/session-fork.ts:32
   src/lib/conversations/transcript-path.ts:30
   src/lib/cost-parsers/jsonl-parser.ts:5,77,551,567,585,594
   src/lib/costs/migration.ts:53
   src/lib/costs/reconciler.ts:9,131,810
   src/lib/harness-binary.ts:20
   src/lib/memory/backfill.ts:4,11
   src/lib/overdeck/claude-session-file-search.ts:2,69,80,98,117
   src/lib/overdeck/conversation-forks.ts:93,119
   src/lib/paths.ts:344,360,369
   src/lib/remote/remote-completion.ts:193,198
   src/lib/runtimes/claude-code.ts:6,7,33
   src/lib/runtimes/types.ts:165
   src/lib/session-format-converter.ts:8
== codex-sessions: 20 files, 51 lines
   src/autopreso/agent.ts:38
   src/cli/commands/cost.ts:130
   src/dashboard/server/services/codex-conversation-parser.ts:5
   src/lib/agents/spawn-prep.ts:757
   src/lib/cliproxy.ts:89
   src/lib/codex-auth.ts:71
   src/lib/codex/app-server-host.ts:521
   src/lib/codex/app-server-manager.ts:75
   src/lib/config-migration.ts:214
   src/lib/context-layers/detach.ts:71,72
   src/lib/context-layers/launch-sources.ts:19,21,22
   src/lib/conversations/harness-discovery.ts:47
   src/lib/cost-parsers/codex-parser.ts:5,237
   src/lib/launcher-generator.ts:67,68,395,397
   src/lib/memory/transcript-source.ts:232
   src/lib/openai-auth.ts:53,130,154
   src/lib/overdeck/conversation-reads.ts:99
   src/lib/paths.ts:64
   src/lib/runtimes/codex-skills.ts:5
   src/lib/runtimes/codex.ts:5,16,17,197,199,228,291,298…
== kimi: 11 files, 38 lines
   src/lib/agents/provider-env.ts:34
   src/lib/agents/recovery.ts:309,337,352,668,694,716
   src/lib/agents/transcript-resolver.ts:186,213,214,239,259
   src/lib/config-yaml/schema.ts:660
   src/lib/harness-binary.ts:188,193
   src/lib/harness-skill-sync.ts:20
   src/lib/overdeck/conversation-reads.ts:114
   src/lib/overdeck/conversation-runtime.ts:682,750,854,866
   src/lib/providers.ts:521
   src/lib/runtimes/kimi-code.ts:89,97,127,128,146,186,226,230…
   src/lib/runtimes/kimi-context-envelope.ts:34,44,57
== opencode: 0 files, 0 lines
== pi: 7 files, 11 lines
   src/cli/commands/cost.ts:131
   src/lib/conversations/harness-discovery.ts:37
   src/lib/cost-parsers/pi-parser.ts:5
   src/lib/ohmypi-codex-auth.ts:7
   src/lib/pi-codex-auth.ts:6,30,64
   src/lib/providers.ts:751
   src/lib/sync.ts:955,978,988
== omp: 6 files, 11 lines
   src/lib/conversations/harness-discovery.ts:42
   src/lib/cost-parsers/ohmypi-parser.ts:5
   src/lib/launcher-generator.ts:278
   src/lib/ohmypi-codex-auth.ts:5,6,11,27,61
   src/lib/ohmypi-models.ts:5,95
   src/lib/providers.ts:775
== transcriptKind: 13 files, 44 lines
   src/dashboard/server/services/conversation-lifecycle.ts:353
   src/dashboard/server/services/conversation/activity-summary.ts:49,62,88,89,90,91,154
   src/dashboard/server/ws-rpc.ts:131,894
   src/lib/agents/delivery.ts:885
   src/lib/agents/messaging.ts:663,698
   src/lib/overdeck/conversation-delivery.ts:185,451
   src/lib/overdeck/conversation-forks.ts:126,130,134,354,432,825
   src/lib/overdeck/conversation-list.ts:125,126
   src/lib/overdeck/conversation-message.ts:358,455,529
   src/lib/overdeck/conversation-pane-choice.ts:33
   src/lib/overdeck/conversation-reads.ts:94,100,108,115
   src/lib/overdeck/conversation-runtime.ts:272,324,325,333,342,345,613
   src/lib/session-history.ts:59,60,61,62,63,64
```


## G. Glued declarations left by `a09d03c0246` (PAN-1379) — `}async function` on one line

```text
src/lib/agent-enrichment.ts:204
src/lib/agent-enrichment.ts:616
src/lib/agent-enrichment.ts:630
src/lib/agent-input-detection.ts:327
src/lib/caveman/workspace.ts:81
src/lib/caveman/workspace.ts:225
src/lib/checkpoint/checkpoint-manager.ts:125
src/lib/checkpoint/checkpoint-manager.ts:194
src/lib/checkpoint/checkpoint-manager.ts:198
src/lib/checkpoint/checkpoint-manager.ts:208
src/lib/checkpoint/checkpoint-manager.ts:223
src/lib/checkpoint/checkpoint-manager.ts:235
src/lib/checkpoint/checkpoint-manager.ts:285
src/lib/checkpoint/checkpoint-manager.ts:298
src/lib/checkpoint/checkpoint-manager.ts:304
src/lib/checkpoint/checkpoint-manager.ts:310
src/lib/checkpoint/checkpoint-manager.ts:335
src/lib/checkpoint/checkpoint-manager.ts:372
src/lib/checkpoint/checkpoint-manager.ts:395
src/lib/checkpoint/checkpoint-manager.ts:400
src/lib/checkpoint/checkpoint-manager.ts:437
src/lib/checkpoint/checkpoint-manager.ts:447
src/lib/checkpoint/checkpoint-manager.ts:454
src/lib/checkpoint/checkpoint-manager.ts:463
src/lib/checkpoint/checkpoint-manager.ts:468
src/lib/cloister/feedback-writer.ts:52
src/lib/cloister/handoff-context.ts:80
src/lib/cloister/handoff.ts:46
src/lib/cloister/merge-rebase.ts:28
src/lib/cloister/review-agent.ts:700
src/lib/cloister/review-context.ts:473
src/lib/cloister/review-monitor.ts:66
src/lib/cloister/service-reactive.ts:193
src/lib/cloister/session-rotation.ts:87
src/lib/cloister/session-rotation.ts:182
src/lib/cloister/session-rotation.ts:257
src/lib/cloister/specialist-context.ts:133
src/lib/cloister/specialist-context.ts:308
src/lib/cloister/specialist-handoff-logger.ts:152
src/lib/cloister/specialist-handoff-logger.ts:224
src/lib/cloister/triggers.ts:228
src/lib/cloister/triggers.ts:310
src/lib/cloister/validation.ts:228
src/lib/cloister/validation.ts:290
src/lib/conversations/enrichment/enrich-session.ts:481
src/lib/conversations/smart-compaction.ts:695
src/lib/conversations/summary-fork.ts:605
src/lib/costs/sync-wal.ts:32
src/lib/costs/sync-wal.ts:84
src/lib/git/operations.ts:44
src/lib/git/operations.ts:54
src/lib/git/operations.ts:83
src/lib/git/operations.ts:154
src/lib/git/operations.ts:196
src/lib/github-app.ts:285
src/lib/github-app.ts:515
src/lib/health.ts:89
src/lib/health.ts:126
src/lib/health.ts:216
src/lib/health.ts:273
src/lib/hume.ts:67
src/lib/hume.ts:170
src/lib/openai-auth.ts:129
src/lib/openai-compatible-proxy.ts:39
src/lib/platform-lifecycle.ts:420
src/lib/platform-lifecycle.ts:486
src/lib/platform-lifecycle.ts:505
src/lib/platform-lifecycle.ts:514
src/lib/platform-lifecycle.ts:530
src/lib/platform-lifecycle.ts:616
src/lib/platform-lifecycle.ts:651
src/lib/prd-draft.ts:37
src/lib/prd-draft.ts:39
src/lib/prd-draft.ts:41
src/lib/prd-draft.ts:43
src/lib/prd-draft.ts:57
src/lib/prd-draft.ts:59
src/lib/provider-health.ts:72
src/lib/provider-health.ts:231
src/lib/rebase-helper.ts:36
src/lib/remote-workspace.ts:27
src/lib/restart-lock.ts:141
src/lib/restart-lock.ts:156
src/lib/review-artifacts.ts:31
src/lib/review-artifacts.ts:95
src/lib/runtime/index.ts:85
src/lib/runtime/index.ts:88
src/lib/runtimes/pi-fifo.ts:63
src/lib/safety/dangerous-git-ops.ts:74
src/lib/safety/dangerous-git-ops.ts:104
src/lib/safety/dangerous-git-ops.ts:118
src/lib/safety/dangerous-git-ops.ts:132
src/lib/session-format-converter.ts:186
src/lib/shadow-mode.ts:36
src/lib/shadow-mode.ts:86
src/lib/shadow-mode.ts:88
src/lib/shadow-mode.ts:98
src/lib/shadow-mode.ts:132
src/lib/shadow-state.ts:96
src/lib/shadow-state.ts:110
src/lib/shadow-state.ts:112
src/lib/shadow-state.ts:134
src/lib/shadow-state.ts:180
src/lib/shadow-state.ts:197
src/lib/shadow-state.ts:236
src/lib/shadow-state.ts:295
src/lib/shadow-state.ts:319
src/lib/shadow-state.ts:327
src/lib/shadow-state.ts:335
src/lib/smee.ts:84
src/lib/smee.ts:125
src/lib/stashes.ts:166
src/lib/stashes.ts:185
src/lib/stashes.ts:232
src/lib/stashes.ts:235
src/lib/stashes.ts:238
src/lib/stashes.ts:241
src/lib/test-runner.ts:257
src/lib/tmux.ts:454
src/lib/tts-daemon.ts:137
src/lib/tts-daemon.ts:141
src/lib/tts-daemon.ts:143
src/lib/tts-daemon.ts:185
src/lib/tts-daemon.ts:187
src/lib/tts-daemon.ts:198
src/lib/tts-daemon.ts:224
src/lib/tts-daemon.ts:453
src/lib/tts-daemon.ts:506
src/lib/tts-daemon.ts:514
src/lib/tts-daemon.ts:587
src/lib/tts-daemon.ts:631
src/lib/tts-daemon.ts:675
src/lib/tts-daemon.ts:706
src/lib/tts-daemon.ts:714
src/lib/tts-speak.ts:159
src/lib/tts-voices.ts:23
src/lib/tts-voices.ts:31
src/lib/tts-voices.ts:36
src/lib/tts-voices.ts:45
src/lib/tts-voices.ts:51
src/lib/tts-voices.ts:56
src/lib/tts-voices.ts:59
src/lib/tunnel.ts:108
src/lib/tunnel.ts:206
```
