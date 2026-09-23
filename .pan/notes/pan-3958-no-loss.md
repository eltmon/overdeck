# PAN-3958 no-loss ledger

One row per exported name deleted by a PAN-3958 child PR (PRD `.pan/drafts/pan-3958.md` D5, FR-11):
the surviving name that does the work, or why nothing replaces it. `tsc --noEmit` and the unchanged
test suite are the proof.

## CH-1a: dead Shape B wrappers (#4007)

Every wrapper below was `Effect.sync(() => fooSync(…))` or `Effect.try({ try: () => fooSync(…), … })`
with no production caller. Evidence: `node scripts/audit-effect-boundary.mjs --json --usage` plus a
word-boundary `git grep` over `src packages scripts sync-sources tests apps`. No test imported or
called any of them, so no test was deleted or ported. The surviving function is unchanged.

| Module | Deleted | Survivor |
| --- | --- | --- |
| `src/lib/activity-logger.ts` | `emitActivityDetailed` | `emitActivityDetailedSync` (Shape B wrapper, no production consumer) |
| `src/lib/activity-logger.ts` | `emitActivityTts` | `emitActivityTtsSync` (Shape B wrapper, no production consumer) |
| `src/lib/activity-logger.ts` | `emitDashboardLifecycle` | `emitDashboardLifecycleSync` (Shape B wrapper, no production consumer) |
| `src/lib/agent-input-detection.ts` | `detectAwaitingInputFromPane` | `detectAwaitingInputFromPaneSync` (Shape B wrapper, no production consumer) |
| `src/lib/backup.ts` | `cleanOldBackups` | `cleanOldBackupsSync` (Shape B wrapper, no production consumer) |
| `src/lib/backup.ts` | `listBackups` | `listBackupsSync` (Shape B wrapper, no production consumer) |
| `src/lib/bridge-token.ts` | `readBridgeToken` | `readBridgeTokenSync` (Shape B wrapper, no production consumer) |
| `src/lib/bridge-token.ts` | `writeBridgeToken` | `writeBridgeTokenSync` (Shape B wrapper, no production consumer) |
| `src/lib/child-env.ts` | `buildChildEnvWithoutTmux` | `buildChildEnvWithoutTmuxSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-mcp.ts` | `ensureExcalidrawMcp` | `ensureExcalidrawMcpSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-mcp.ts` | `ensurePlaywrightIsolation` | `ensurePlaywrightIsolationSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-mcp.ts` | `getIsolatedPlaywrightMcpConfig` | `getIsolatedPlaywrightMcpConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-permissions.ts` | `buildClaudeUserSettings` | `buildClaudeUserSettingsSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-permissions.ts` | `bypassPrefixForAgentFlag` | `bypassPrefixForAgentFlagSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-permissions.ts` | `getClaudePermissionFlags` | `getClaudePermissionFlagsSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-permissions.ts` | `getClaudePermissionFlagsString` | `getClaudePermissionFlagsStringSync` (Shape B wrapper, no production consumer) |
| `src/lib/claude-permissions.ts` | `resolvePermissionMode` | `resolvePermissionModeSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `cleanupOldEvents` | `cleanupOldEventsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `deleteAgentHistory` | `deleteAgentHistorySync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `getAgentsWithHistory` | `getAgentsWithHistorySync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `getAllHealthHistory` | `getAllHealthHistorySync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `getDatabaseStats` | `getDatabaseStatsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `getLatestHealthEvent` | `getLatestHealthEventSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `getRecentHealthHistory` | `getRecentHealthHistorySync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/database.ts` | `writeHealthEvents` | `writeHealthEventsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-completion.ts` | `hasPendingCompletion` | `_pendingCompletions.has` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-logs.ts` | `appendToRunLog` | `appendToRunLogSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-logs.ts` | `cleanupAllLogs` | `cleanupAllLogsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-logs.ts` | `cleanupOldLogs` | `cleanupOldLogsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-logs.ts` | `createRunLog` | `createRunLogSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-logs.ts` | `finalizeRunLog` | `finalizeRunLogSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-logs.ts` | `getRunLog` | `getRunLogSync` (Shape B wrapper, no production consumer) |
| `src/lib/cloister/specialist-logs.ts` | `listRunLogs` | `listRunLogsSync` (Shape B wrapper, no production consumer) |
| `src/lib/config-migration.ts` | `cleanupLegacyRuntimeSymlinks` | `cleanupLegacyRuntimeSymlinksSync` (Shape B wrapper, no production consumer) |
| `src/lib/config-migration.ts` | `convertToYamlConfig` | `convertToYamlConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/config-migration.ts` | `getMigrationStatus` | `getMigrationStatusSync` (Shape B wrapper, no production consumer) |
| `src/lib/config-migration.ts` | `migrateConfig` | `migrateConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/config-migration.ts` | `migrateSyncTargets` | `migrateSyncTargetsSync` (Shape B wrapper, no production consumer) |
| `src/lib/config.ts` | `findDevrootForProject` | `findDevrootForProjectSync` (Shape B wrapper, no production consumer) |
| `src/lib/config.ts` | `getDefaultConfig` | `getDefaultConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/config.ts` | `getDevrootPath` | `getDevrootPathSync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `appendSummary` | `appendSummarySync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `checkContextBudget` | `checkContextBudgetSync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `createContextBudget` | `createContextBudgetSync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `getRecentHistory` | `getRecentHistorySync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `listMaterialized` | `listMaterializedSync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `logHistory` | `logHistorySync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `materializeOutput` | `materializeOutputSync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `readMaterialized` | `readMaterializedSync` (Shape B wrapper, no production consumer) |
| `src/lib/context.ts` | `searchHistory` | `searchHistorySync` (Shape B wrapper, no production consumer) |
| `src/lib/conversations/correlator.ts` | `buildCorrelationMap` | `buildCorrelationMapSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/jsonl-parser.ts` | `getActiveSessionModel` | `getActiveSessionModelSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/jsonl-parser.ts` | `getAllSessionFiles` | `getAllSessionFilesSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/jsonl-parser.ts` | `getProjectDirs` | `getProjectDirsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/jsonl-parser.ts` | `getRecentSessions` | `getRecentSessionsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/jsonl-parser.ts` | `getSessionFiles` | `getSessionFilesSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/jsonl-parser.ts` | `parseAllSessions` | `parseAllSessionsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/jsonl-parser.ts` | `parseClaudeSession` | `parseClaudeSessionSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/pi-parser.ts` | `parsePiSession` | `parsePiSessionSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `completeSession` | `completeSessionSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `findSessionById` | `findSessionByIdSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `getAllIssuesWithCosts` | `getAllIssuesWithCostsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `getIssueCostSummary` | `getIssueCostSummarySync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `getIssueSessions` | `getIssueSessionsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `linkSessionToIssue` | `linkSessionToIssueSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `loadSessionMap` | `loadSessionMapSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `saveSessionMap` | `saveSessionMapSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost-parsers/session-map.ts` | `updateSessionFromJSONL` | `updateSessionFromJSONLSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `calculateCost` | `calculateCostSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `getAllBudgets` | `getAllBudgetsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `getBudget` | `getBudgetSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `getDailySummary` | `getDailySummarySync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `getMonthlySummary` | `getMonthlySummarySync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `getPricing` | `getPricingSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `getWeeklySummary` | `getWeeklySummarySync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `logCost` | `logCostSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `logUsage` | `logUsageSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `readCosts` | `readCostsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `readIssueCosts` | `readIssueCostsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `readTodayCosts` | `readTodayCostsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `summarizeCosts` | `summarizeCostsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cost.ts` | `updateBudgetSpent` | `updateBudgetSpentSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `getCostsByIssue` | `getCostsByIssueSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `getCostsForIssue` | `getCostsForIssueSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `loadCache` | `loadCacheSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `rebuildCache` | `rebuildCacheSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `saveCache` | `saveCacheSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `setIssueBudget` | `setIssueBudgetSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `syncCache` | `syncCacheSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/aggregator.ts` | `updateCacheFromEvents` | `updateCacheFromEventsSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/events.ts` | `appendCostEvent` | `appendCostEventSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/events.ts` | `deduplicateEvents` | `deduplicateEventsSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/events.ts` | `getLastEventMetadata` | `getLastEventMetadataSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/events.ts` | `readEvents` | `readEventsSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/events.ts` | `readEventsFromLine` | `readEventsFromLineSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/events.ts` | `replaceEventsFile` | `replaceEventsFileSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/events.ts` | `tailEvents` | `tailEventsSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/migration.ts` | `migrateAllSessions` | `migrateAllSessionsSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/migration.ts` | `migrateIfNeeded` | `migrateIfNeededSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/retention.ts` | `getRetentionStatus` | `getRetentionStatusSync` (Shape B wrapper, no production consumer) |
| `src/lib/costs/retention.ts` | `pruneOldEvents` | `pruneOldEventsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cv.ts` | `completeWork` | `completeWorkSync` (Shape B wrapper, no production consumer) |
| `src/lib/cv.ts` | `formatCV` | `formatCVSync` (Shape B wrapper, no production consumer) |
| `src/lib/cv.ts` | `getAgentCV` | `getAgentCVSync` (Shape B wrapper, no production consumer) |
| `src/lib/cv.ts` | `getAgentRankings` | `getAgentRankingsSync` (Shape B wrapper, no production consumer) |
| `src/lib/cv.ts` | `saveAgentCV` | `saveAgentCVSync` (Shape B wrapper, no production consumer) |
| `src/lib/env-loader.ts` | `loadOverdeckEnv` | `loadOverdeckEnvSync` (Shape B wrapper, no production consumer) |
| `src/lib/git-activity.ts` | `appendGitOperation` | `appendGitOperationSync` (Shape B wrapper, no production consumer) |
| `src/lib/git-activity.ts` | `listGitOperations` | `listGitOperationsSync` (Shape B wrapper, no production consumer) |
| `src/lib/harness-policy.ts` | `canUseHarness` | `canUseHarnessSync` (Shape B wrapper, no production consumer) |
| `src/lib/harness-policy.ts` | `canUseModelWithAuth` | `canUseModelWithAuthSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `checkHook` | `checkHookSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `clearHook` | `clearHookSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `collectMail` | `collectMailSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `generateFixedPointPrompt` | `generateFixedPointPromptSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `getHook` | `getHookSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `initHook` | `initHookSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `popFromHook` | `popFromHookSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `pushToHook` | `pushToHookSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `reorderHookItems` | `reorderHookItemsSync` (Shape B wrapper, no production consumer) |
| `src/lib/hooks.ts` | `sendMail` | `sendMailSync` (Shape B wrapper, no production consumer) |
| `src/lib/internal-token.ts` | `ensureInternalToken` | `ensureInternalTokenSync` (Shape B wrapper, no production consumer) |
| `src/lib/internal-token.ts` | `getInternalToken` | `getInternalTokenSync` (Shape B wrapper, no production consumer) |
| `src/lib/issue-id.ts` | `extractNumber` | `extractNumberSync` (Shape B wrapper, no production consumer) |
| `src/lib/issue-id.ts` | `extractPrefix` | `extractPrefixSync` (Shape B wrapper, no production consumer) |
| `src/lib/issue-id.ts` | `extractStandardNumber` | `extractStandardNumberSync` (Shape B wrapper, no production consumer) |
| `src/lib/issue-id.ts` | `extractStandardPrefix` | `extractStandardPrefixSync` (Shape B wrapper, no production consumer) |
| `src/lib/issue-id.ts` | `parseIssueId` | `parseIssueIdSync` (Shape B wrapper, no production consumer) |
| `src/lib/issue-id.ts` | `resolveBareNumericId` | `resolveBareNumericIdSync` (Shape B wrapper, no production consumer) |
| `src/lib/issue-id.ts` | `resolveIssueId` | `resolveIssueIdSync` (Shape B wrapper, no production consumer) |
| `src/lib/launcher-generator.ts` | `generateLauncherScript` | `generateLauncherScriptSync` (Shape B wrapper, no production consumer) |
| `src/lib/launcher-generator.ts` | `generateLauncherWrapper` | `generateLauncherWrapperSync` (Shape B wrapper, no production consumer) |
| `src/lib/merge-set.ts` | `buildMergeSetForIssue` | `buildMergeSetForIssueSync` (Shape B wrapper, no production consumer) |
| `src/lib/merge-set.ts` | `deleteMergeSet` | `deleteMergeSetSync` (Shape B wrapper, no production consumer) |
| `src/lib/merge-set.ts` | `ensureMergeSetForIssue` | `ensureMergeSetForIssueSync` (Shape B wrapper, no production consumer) |
| `src/lib/merge-set.ts` | `getAllMergeSets` | `getAllMergeSetsSync` (Shape B wrapper, no production consumer) |
| `src/lib/merge-set.ts` | `upsertMergeSet` | `upsertMergeSetSync` (Shape B wrapper, no production consumer) |
| `src/lib/merge-set.ts` | `withRepoArtifactUrl` | `withRepoArtifactUrlSync` (Shape B wrapper, no production consumer) |
| `src/lib/merge-set.ts` | `withRepoState` | `withRepoStateSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-capabilities.ts` | `getAllSkillDimensions` | `getAllSkillDimensionsSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-capabilities.ts` | `getCheapestModels` | `getCheapestModelsSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-capabilities.ts` | `getModelCapability` | `getModelCapabilitySync` (Shape B wrapper, no production consumer) |
| `src/lib/model-capabilities.ts` | `getModelsBySkill` | `getModelsBySkillSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-capabilities.ts` | `getModelsForProvider` | `getModelsForProviderSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-capabilities.ts` | `getValueScore` | `getValueScoreSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-capabilities.ts` | `resolveModelId` | `resolveModelIdSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `applyFallback` | `applyFallbackSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `applyTierAwareFallback` | `applyTierAwareFallbackSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `filterAvailableModels` | `filterAvailableModelsSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `getAvailableModels` | `getAvailableModelsSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `getFallbackModel` | `getFallbackModelSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `getModelProvider` | `getModelProviderSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `getModelsByProvider` | `getModelsByProviderSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `isOpenRouterModel` | `isOpenRouterModelSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-fallback.ts` | `requiresExternalKey` | `requiresExternalKeySync` (Shape B wrapper, no production consumer) |
| `src/lib/model-validation.ts` | `normalizeModelOverride` | `normalizeModelOverrideSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-validation.ts` | `requireModelOverride` | `requireModelOverrideSync` (Shape B wrapper, no production consumer) |
| `src/lib/model-validation.ts` | `shellQuoteModelId` | `shellQuoteModelIdSync` (Shape B wrapper, no production consumer) |
| `src/lib/multi-tool-sync.ts` | `resolveAlsoSyncTools` | `resolveAlsoSyncToolsSync` (Shape B wrapper, no production consumer) |
| `src/lib/multi-tool-sync.ts` | `runMultiToolSync` | `runMultiToolSyncSync` (Shape B wrapper, no production consumer) |
| `src/lib/multi-tool-sync.ts` | `syncSkillsToTools` | `syncSkillsToToolsSync` (Shape B wrapper, no production consumer) |
| `src/lib/pipeline-notifier.ts` | `notifyPipeline` | `notifyPipelineSync` (Shape B wrapper, no production consumer) |
| `src/lib/pipeline-notifier.ts` | `setPipelineHandler` | `setPipelineHandlerSync` (Shape B wrapper, no production consumer) |
| `src/lib/platform-lifecycle.ts` | `readPlatformConfig` | `readPlatformConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/prd-draft.ts` | `getPRDDraftPath` | `getPRDDraftPathSync` (Shape B wrapper, no production consumer) |
| `src/lib/prd-locations.ts` | `canonicalPrdSubdir` | `canonicalPrdSubdirSync` (Shape B wrapper, no production consumer) |
| `src/lib/prd-locations.ts` | `findPrdAnywhere` | `findPrdAnywhereSync` (Shape B wrapper, no production consumer) |
| `src/lib/prd-locations.ts` | `findPrdAtStatus` | `findPrdAtStatusSync` (Shape B wrapper, no production consumer) |
| `src/lib/project-repos.ts` | `inferProjectForge` | `inferProjectForgeSync` (Shape B wrapper, no production consumer) |
| `src/lib/project-repos.ts` | `normalizeForge` | `normalizeForgeSync` (Shape B wrapper, no production consumer) |
| `src/lib/project-repos.ts` | `resolveConfiguredRepos` | `resolveConfiguredReposSync` (Shape B wrapper, no production consumer) |
| `src/lib/project-repos.ts` | `resolveProjectReposForIssue` | `resolveProjectReposForIssueSync` (Shape B wrapper, no production consumer) |
| `src/lib/project-repos.ts` | `resolveProjectReposFromResolvedIssue` | `resolveProjectReposFromResolvedIssueSync` (Shape B wrapper, no production consumer) |
| `src/lib/projects.ts` | `initializeProjectsConfig` | `initializeProjectsConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/provider-health.ts` | `invalidateProbeCache` | `invalidateProbeCacheSync` (Shape B wrapper, no production consumer) |
| `src/lib/providers.ts` | `getProviderEnv` | `getProviderEnvSync` (Shape B wrapper, no production consumer) |
| `src/lib/providers.ts` | `getProviderForModel` | `getProviderForModelSync` (Shape B wrapper, no production consumer) |
| `src/lib/release-set.ts` | `deleteReleaseSet` | `deleteReleaseSetSync` (Shape B wrapper, no production consumer) |
| `src/lib/release-set.ts` | `getAllReleaseSets` | `getAllReleaseSetsSync` (Shape B wrapper, no production consumer) |
| `src/lib/release-set.ts` | `getReleaseSet` | `getReleaseSetSync` (Shape B wrapper, no production consumer) |
| `src/lib/release-set.ts` | `upsertReleaseSet` | `upsertReleaseSetSync` (Shape B wrapper, no production consumer) |
| `src/lib/release-set.ts` | `withComponentState` | `withComponentStateSync` (Shape B wrapper, no production consumer) |
| `src/lib/remote/fly-api.ts` | `createFlyApiClient` | `createFlyApiClientSync` (Shape B wrapper, no production consumer) |
| `src/lib/remote/workspace-metadata.ts` | `deleteWorkspaceMetadata` | `deleteWorkspaceMetadataSync` (Shape B wrapper, no production consumer) |
| `src/lib/remote/workspace-metadata.ts` | `findRemoteWorkspaceMetadata` | `findRemoteWorkspaceMetadataSync` (Shape B wrapper, no production consumer) |
| `src/lib/remote/workspace-metadata.ts` | `listWorkspaceMetadata` | `listWorkspaceMetadataSync` (Shape B wrapper, no production consumer) |
| `src/lib/remote/workspace-metadata.ts` | `loadWorkspaceMetadata` | `loadWorkspaceMetadataSync` (Shape B wrapper, no production consumer) |
| `src/lib/remote/workspace-metadata.ts` | `saveWorkspaceMetadata` | `saveWorkspaceMetadataSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtime/metrics.ts` | `clearMetrics` | `clearMetricsSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtime/metrics.ts` | `getAggregatedMetrics` | `getAggregatedMetricsSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtime/metrics.ts` | `getAllRuntimeMetrics` | `getAllRuntimeMetricsSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtime/metrics.ts` | `getRecentTasks` | `getRecentTasksSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtime/metrics.ts` | `getRuntimeMetrics` | `getRuntimeMetricsSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtime/metrics.ts` | `recordTask` | `recordTaskSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtime/metrics.ts` | `saveMetrics` | `saveMetricsSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtimes/pi-fifo.ts` | `destroyPiFifo` | `destroyPiFifoSync` (Shape B wrapper, no production consumer) |
| `src/lib/runtimes/pi-fifo.ts` | `writePiCommand` | `writePiCommandSync` (Shape B wrapper, no production consumer) |
| `src/lib/settings.ts` | `getAgentCommand` | `getAgentCommandSync` (Shape B wrapper, no production consumer) |
| `src/lib/settings.ts` | `getAvailableModels` | `getAvailableModelsSync` (Shape B wrapper, no production consumer) |
| `src/lib/settings.ts` | `getClaudeModelFlag` | `getClaudeModelFlagSync` (Shape B wrapper, no production consumer) |
| `src/lib/settings.ts` | `getDefaultSettings` | `getDefaultSettingsSync` (Shape B wrapper, no production consumer) |
| `src/lib/settings.ts` | `isAnthropicModel` | `isAnthropicModelSync` (Shape B wrapper, no production consumer) |
| `src/lib/settings.ts` | `loadSettings` | `loadSettingsSync` (Shape B wrapper, no production consumer) |
| `src/lib/settings.ts` | `validateSettings` | `validateSettingsSync` (Shape B wrapper, no production consumer) |
| `src/lib/shell.ts` | `addAlias` | `addAliasSync` (Shape B wrapper, no production consumer) |
| `src/lib/shell.ts` | `detectShell` | `detectShellSync` (Shape B wrapper, no production consumer) |
| `src/lib/shell.ts` | `getAliasInstructions` | `getAliasInstructionsSync` (Shape B wrapper, no production consumer) |
| `src/lib/shell.ts` | `getShellRcFile` | `getShellRcFileSync` (Shape B wrapper, no production consumer) |
| `src/lib/shell.ts` | `hasAlias` | `hasAliasSync` (Shape B wrapper, no production consumer) |
| `src/lib/skills-merge.ts` | `applyProjectTemplateOverlay` | `applyProjectTemplateOverlaySync` (Shape B wrapper, no production consumer) |
| `src/lib/skills-merge.ts` | `cleanupGitignore` | `cleanupGitignoreSync` (Shape B wrapper, no production consumer) |
| `src/lib/skills-merge.ts` | `cleanupWorkspaceGitignore` | `cleanupWorkspaceGitignoreSync` (Shape B wrapper, no production consumer) |
| `src/lib/skills-merge.ts` | `mergePanSkillsIntoWorkspace` | `mergePanSkillsIntoWorkspaceSync` (Shape B wrapper, no production consumer) |
| `src/lib/skills-merge.ts` | `mergeSkillsIntoWorkspace` | `mergeSkillsIntoWorkspaceSync` (Shape B wrapper, no production consumer) |
| `src/lib/smart-model-selector.ts` | `getSimpleModelMapping` | `getSimpleModelMappingSync` (Shape B wrapper, no production consumer) |
| `src/lib/smart-model-selector.ts` | `selectAllModels` | `selectAllModelsSync` (Shape B wrapper, no production consumer) |
| `src/lib/smart-model-selector.ts` | `selectModel` | `selectModelSync` (Shape B wrapper, no production consumer) |
| `src/lib/smee.ts` | `isSmeeProcessRunning` | `isSmeeProcessRunningSync` (Shape B wrapper, no production consumer) |
| `src/lib/smee.ts` | `isSmeeRunning` | `isSmeeRunningSync` (Shape B wrapper, no production consumer) |
| `src/lib/smee.ts` | `startSmeeProcess` | `startSmeeProcessSync` (Shape B wrapper, no production consumer) |
| `src/lib/smee.ts` | `stopSmeeProcess` | `stopSmeeProcessSync` (Shape B wrapper, no production consumer) |
| `src/lib/supervisor.ts` | `getSupervisorPort` | `getSupervisorPortSync` (Shape B wrapper, no production consumer) |
| `src/lib/supervisor.ts` | `getSupervisorUrl` | `getSupervisorUrlSync` (Shape B wrapper, no production consumer) |
| `src/lib/supervisor.ts` | `isSupervisorRunning` | `isSupervisorRunningSync` (Shape B wrapper, no production consumer) |
| `src/lib/supervisor.ts` | `startSupervisorProcess` | `startSupervisorProcessSync` (Shape B wrapper, no production consumer) |
| `src/lib/supervisor.ts` | `stopSupervisorProcess` | `stopSupervisorProcessSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `executeSync` | `executeSyncSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `isOverdeckSymlink` | `isOverdeckSymlinkSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `migrateStalePersonalContent` | `migrateStalePersonalContentSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `mirrorProjectSkills` | `mirrorProjectSkillsSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `planHooksSync` | `planHooksSyncSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `planSync` | `planSyncSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `refreshCache` | `refreshCacheSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `removeLegacySkills070` | `removeLegacySkills070Sync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `syncHooks` | `syncHooksSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `syncPiSettings` | `syncPiSettingsSync` (Shape B wrapper, no production consumer) |
| `src/lib/sync.ts` | `syncStatusline` | `syncStatuslineSync` (Shape B wrapper, no production consumer) |
| `src/lib/tldr-daemon.ts` | `captureTldrMetrics` | `captureTldrMetricsSync` (Shape B wrapper, no production consumer) |
| `src/lib/tldr-daemon.ts` | `getTldrDaemonService` | `getTldrDaemonServiceSync` (Shape B wrapper, no production consumer) |
| `src/lib/tldr-daemon.ts` | `getTldrMetrics` | `getTldrMetricsSync` (Shape B wrapper, no production consumer) |
| `src/lib/tldr-daemon.ts` | `listTldrDaemonServices` | `listTldrDaemonServicesSync` (Shape B wrapper, no production consumer) |
| `src/lib/tldr-daemon.ts` | `removeTldrDaemonService` | `removeTldrDaemonServiceSync` (Shape B wrapper, no production consumer) |
| `src/lib/tmux.ts` | `detectTerminalApiError` | `detectTerminalApiErrorSync` (Shape B wrapper, no production consumer) |
| `src/lib/tracker-utils.ts` | `parseGitHubRepos` | `parseGitHubReposSync` (Shape B wrapper, no production consumer) |
| `src/lib/tracker-utils.ts` | `resolveTrackerType` | `resolveTrackerTypeSync` (Shape B wrapper, no production consumer) |
| `src/lib/traefik.ts` | `cleanupStaleTlsSections` | `cleanupStaleTlsSectionsSync` (Shape B wrapper, no production consumer) |
| `src/lib/traefik.ts` | `cleanupTemplateFiles` | `cleanupTemplateFilesSync` (Shape B wrapper, no production consumer) |
| `src/lib/traefik.ts` | `ensureProjectCerts` | `ensureProjectCertsSync` (Shape B wrapper, no production consumer) |
| `src/lib/traefik.ts` | `generateTlsConfig` | `generateTlsConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/webhook-handlers.ts` | `isTrackedRepository` | `isTrackedRepositorySync` (Shape B wrapper, no production consumer) |
| `src/lib/work-agent-lifecycle.ts` | `assertCanResumeSession` | `assertCanResumeSessionSync` (Shape B wrapper, no production consumer) |
| `src/lib/work/done-preflight.ts` | `checkIncompletePlanItems` | `checkIncompletePlanItemsSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace-config.ts` | `getDefaultWorkspaceConfig` | `getDefaultWorkspaceConfigSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace-config.ts` | `getServiceFromTemplate` | `getServiceFromTemplateSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace-config.ts` | `replacePlaceholders` | `replacePlaceholdersSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace-manager.ts` | `copyOverdeckSettingsToWorkspace` | `copyOverdeckSettingsToWorkspaceSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace-manager.ts` | `ensurePanGitignore` | `ensurePanGitignoreSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace-manager.ts` | `migrateOverdeckToPan` | `migrateOverdeckToPanSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace/devcontainer-renderer.ts` | `createWorkspacePlaceholders` | `createWorkspacePlaceholdersSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace/devcontainer-renderer.ts` | `processTemplates` | `processTemplatesSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace/devcontainer-renderer.ts` | `renderDevcontainer` | `renderDevcontainerSync` (Shape B wrapper, no production consumer) |
| `src/lib/workspace/devcontainer-renderer.ts` | `sanitizeComposeFile` | `sanitizeComposeFileSync` (Shape B wrapper, no production consumer) |

Also deleted, because only the wrappers above used them:

| Module | Deleted | Reason |
| --- | --- | --- |
| `src/lib/costs/index.ts` | re-exports of the 19 deleted `costs/*` wrappers | barrel lines only; no importer used them |
| `src/lib/cloister/specialist-logs.ts` | `SpecialistLogError`, private `liftLogError` | error channel of the deleted wrappers; no other reference |
| `src/lib/git-activity.ts` | `GitActivityDbError` | error channel of the deleted wrappers; no other reference |
| `src/lib/model-validation.ts` | `ModelValidationError`, private `wrapValidation` | error channel of the deleted wrappers; no other reference |
| `src/lib/remote/workspace-metadata.ts` | private `toMetadataFsError` | error mapper of the deleted wrappers |
| `src/lib/workspace/devcontainer-renderer.ts` | private `toRenderFsError` | error mapper of the deleted wrappers |

Kept although the audit lists them as dead:

| Module | Name | Why |
| --- | --- | --- |
| `src/lib/traefik.ts` | `generateOverdeckTraefikConfig` | Reached dynamically from `sync-sources/skills/pan-dev/SKILL.md` (`m.generateOverdeckTraefikConfig()` via `npx tsx -e`). That snippet already does nothing: it builds an Effect and never runs it. CH-1b should point the skill at `generateOverdeckTraefikConfigSync()` and then delete the wrapper. |
| `src/lib/cost-parsers/ohmypi-parser.ts` | `parseOhmypiSession`, `parseOhmypiSessionCostEvents` | Oh My Pi code, removed wholesale by #4003 |
| `src/lib/runtimes/ohmypi-fifo.ts` | `writeOhmypiCommand`, `destroyOhmypiFifo` | Oh My Pi code, removed wholesale by #4003 |

## CH-1b: dead Shape A façades, Effect runtime twins, dead Shape C variants (#4007)

Same evidence as CH-1a: `node scripts/audit-effect-boundary.mjs --json --usage`, a word-boundary
`git grep` over `src packages scripts sync-sources tests apps`, and an AST scan of every `.ts` file
(tests included) for imports, dynamic imports, `vi.mock` targets, member accesses and destructuring of
a deleted name. Ratchet: A 220 → 187, B 39 → 38, C 82 → 39.

### Shape A façades (33) and their private bodies (29)

| Module | Deleted façade | Body | Note |
| --- | --- | --- | --- |
| `src/lib/checkpoint/checkpoint-manager.ts` | `diffSinceCommit` | `diffSinceCommitPromise` deleted (no other caller) | no production consumer |
| `src/lib/checkpoint/checkpoint-manager.ts` | `pruneStaleCheckpointRefs` | `pruneStaleCheckpointRefsPromise` deleted (no other caller) | no production consumer |
| `src/lib/cliproxy.ts` | `checkCliproxyPort` | `checkCliproxyPortTask` kept (other in-file callers) | no production consumer |
| `src/lib/cloister/validation.ts` | `runMergeValidation` | `runMergeValidationPromise` deleted (no other caller) | no production caller since merge-agent stopped calling it in cfd48b80881 (PAN-1048) |
| `src/lib/config.ts` | `saveConfig` | `saveConfigToFile` deleted (no other caller) | no production consumer |
| `src/lib/conversations/summary-fork.ts` | `createSummaryFork` | `createSummaryForkPromise` deleted (no other caller) | replaced by the server fork route, src/lib/overdeck/conversation-forks.ts (PAN-1568, 4678b79c47f) |
| `src/lib/costs/sync-wal.ts` | `syncWalFromDir` | `syncWalFromDirPromise` deleted (no other caller) | never had a production caller; syncWalFromAllProjects is the live sweep |
| `src/lib/git-utils.ts` | `getWorkspaceGitInfo` | `getWorkspaceGitInfoPromise` deleted (no other caller) | no production consumer |
| `src/lib/git-utils.ts` | `hasStaleLocks` | `hasStaleLocksPromise` deleted (no other caller) | no production consumer |
| `src/lib/git/operations.ts` | `gitForcePush` | `gitForcePushPromise` deleted (no other caller) | no production consumer |
| `src/lib/git/operations.ts` | `gitMerge` | `gitMergePromise` deleted (no other caller) | no production consumer |
| `src/lib/github-app.ts` | `getPullRequestHeadState` | `getPullRequestHeadStatePromise` deleted (no other caller) | no production consumer |
| `src/lib/platform-lifecycle.ts` | `isTraefikContainerRunning` | `isTraefikContainerRunningPromise` deleted (no other caller) | no production consumer |
| `src/lib/prd-draft.ts` | `deletePRDDraft` | `deletePRDDraftPromise` deleted (no other caller) | no production consumer |
| `src/lib/prd-draft.ts` | `getPRDDraftInfo` | `getPRDDraftInfoPromise` deleted (no other caller) | no production consumer |
| `src/lib/prd-draft.ts` | `listPRDDrafts` | `listPRDDraftsPromise` deleted (no other caller) | no production consumer |
| `src/lib/prd-draft.ts` | `readPRDDraft` | `readPRDDraftPromise` deleted (no other caller) | no production caller since PAN-404 / 488e5d44d83 |
| `src/lib/prd-draft.ts` | `writePRDDraft` | `writePRDDraftPromise` deleted (no other caller) | callers removed with the prd-agent in a5cbf94b42b (PAN-404) |
| `src/lib/projects.ts` | `registerProject` | `updateProjectsConfigAsync` kept (other in-file callers) | no production consumer |
| `src/lib/projects.ts` | `unregisterProject` | `updateProjectsConfigAsync` kept (other in-file callers) | no production consumer |
| `src/lib/runtime/index.ts` | `getInstalledRuntimes` | `getInstalledRuntimesPromise` deleted (no other caller) | no production consumer |
| `src/lib/safety/dangerous-git-ops.ts` | `runGitCheckoutOverwrite` | `runGitCheckoutOverwritePromise` deleted (no other caller) | no production consumer |
| `src/lib/session-format-converter.ts` | `convertConversationTranscript` | `convertConversationTranscriptPromise` deleted (no other caller) | no production consumer |
| `src/lib/settings-api.ts` | `setRoleConfig` | `setRoleConfigPromise` deleted (no other caller) | no production consumer |
| `src/lib/shadow-mode.ts` | `getShadowModeStatus` | `getShadowModeStatusPromise` deleted (no other caller) | no production consumer |
| `src/lib/shadow-state.ts` | `getUnsyncedHistory` | `getUnsyncedHistoryPromise` deleted (no other caller) | no production consumer |
| `src/lib/stashes.ts` | `applyStash` | `applyStashPromise` deleted (no other caller) | no production consumer |
| `src/lib/stashes.ts` | `createNamedStash` | `createNamedStashPromise` deleted (no other caller) | no production consumer |
| `src/lib/stashes.ts` | `popStash` | `popStashPromise` deleted (no other caller) | no production consumer |
| `src/lib/tts-daemon.ts` | `ttsDaemonInstallState` | `ttsDaemonInstallStatePromise` deleted (no other caller) | no production consumer |
| `src/lib/work/done-preflight.ts` | `checkUncommittedChanges` | `checkUncommittedChangesPromise` kept (other in-file callers) | no production consumer |
| `src/lib/xbrief/dag.ts` | `readPlanFile` | `readPlanFileFromDisk` deleted (no other caller) | no production consumer |
| `src/lib/xbrief/lifecycle-io.ts` | `moveXBrief` | `moveXBriefPromise` deleted (no other caller) | no production consumer |

### Effect runtime twins (PRD W4, D9, Q4)

| Module | Deleted | Survivor |
| --- | --- | --- |
| `src/lib/runtimes/claude-code.ts` | `ClaudeCodeRuntime`, `createClaudeCodeRuntime` | `ClaudeCodeRuntimeSync`, `createClaudeCodeRuntimeSync` (the registered runtime) |
| `src/lib/runtimes/codex.ts` | `CodexRuntime`, `createCodexRuntime` | `CodexRuntimeSync`, `createCodexRuntimeSync` |
| `src/lib/runtimes/pi.ts` | `PiRuntimeSync`, `PiRuntime`, `createPiRuntimeSync`, `createPiRuntime`, and the private helpers only they used | none: never constructed after PAN-1989. `PiSpawnTimeout`, `PiSpawnConfig`, `piSessionsRoot`, `findPiTranscriptPath` stay |
| `src/lib/runtimes/index.ts` | re-exports of the eight names above and the unused `createPiRuntimeSync` import | — |

### Shape C variants (PRD §10 rules C1–C3)

| Rule | Module | Deleted | Survivor |
| --- | --- | --- | --- |
| C1 | `src/lib/cloister/config.ts` | `updateCloisterConfig` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/config.ts` | `updateCloisterConfigSync` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/cost-monitor.ts` | `recordCost` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/cost-monitor.ts` | `resetCostTracking` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `getPendingVerificationHandoffs` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `getPendingVerificationHandoffsSync` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `readAgentHandoffEvents` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `readAgentHandoffEventsSync` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `readIssueHandoffEvents` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `readIssueHandoffEventsSync` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `updateHandoffOutcome` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/handoff-logger.ts` | `updateHandoffOutcomeSync` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/task-readiness.ts` | `getUnblockedItems` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/task-readiness.ts` | `getUnblockedItemsSync` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/task-readiness.ts` | `isTaskReady` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/task-readiness.ts` | `isTaskReadySync` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/test-agent.ts` | `detectTestCommand` | none (no production caller for either variant) |
| C1 | `src/lib/cloister/test-agent.ts` | `detectTestCommandSync` | none (no production caller for either variant) |
| C1 | `src/lib/projects.ts` | `saveProjectsConfig` | none (no production caller for either variant) |
| C1 | `src/lib/router-config.ts` | `writeRouterConfig` | none (no production caller for either variant) |
| C1 | `src/lib/runtimes/pi.ts` | `createPiRuntime` | none (no production caller for either variant) |
| C1 | `src/lib/runtimes/pi.ts` | `createPiRuntimeSync` | none (no production caller for either variant) |
| C1 | `src/lib/xbrief/acceptance-criteria.ts` | `checkAllCriteriaCompleted` | none (no production caller for either variant) |
| C1 | `src/lib/xbrief/acceptance-criteria.ts` | `checkAllCriteriaCompletedSync` | none (no production caller for either variant) |
| C2 | `src/lib/agents/agent-state.ts` | `recordAgentFailureSync` | `recordAgentFailure` |
| C2 | `src/lib/projects.ts` | `setProjectAutoMergeDefaultSync` | `setProjectAutoMergeDefault` |
| C2 | `src/lib/projects.ts` | `setProjectMergeTrainSync` | `setProjectMergeTrain` |
| C2 | `src/lib/projects.ts` | `setProjectSwarmPolicySync` | `setProjectSwarmPolicy` |
| C2 | `src/lib/pty-token.ts` | `readPtyTokenSync` | `readPtyToken` |
| C2 | `src/lib/pty-token.ts` | `writePtyTokenSync` | `writePtyToken` |
| C2 | `src/lib/tmux.ts` | `createSessionSync` | `createSession` |
| C2 | `src/lib/tmux.ts` | `sendKeysSync` | `sendKeys` |
| C2 | `src/lib/xbrief/io.ts` | `isPlanningCompleteSync` | `isPlanningComplete` |
| C3 | `src/lib/agents/supervisor-liveness.ts` | `supervisorProcessAlive` | `supervisorProcessAliveSync` |
| C3 | `src/lib/backup.ts` | `restoreBackup` | `restoreBackupSync` |
| C3 | `src/lib/cloister/handoff-logger.ts` | `logHandoffEvent` | `logHandoffEventSync` |
| C3 | `src/lib/costs/wal.ts` | `appendToWal` | `appendToWalSync` |
| C3 | `src/lib/manifest.ts` | `collectSourceFiles` | `collectSourceFilesSync` |
| C3 | `src/lib/manifest.ts` | `hashFile` | `hashFileSync` |
| C3 | `src/lib/manifest.ts` | `readManifest` | `readManifestSync` |
| C3 | `src/lib/manifest.ts` | `writeManifest` | `writeManifestSync` |
| C3 | `src/lib/persistent-logger.ts` | `logAgentLifecycle` | `logAgentLifecycleSync` |
| C3 | `src/lib/persistent-logger.ts` | `logDeaconEvent` | `logDeaconEventSync` |
| C3 | `src/lib/projects.ts` | `findProjectByPath` | `findProjectByPathSync` |
| C3 | `src/lib/projects.ts` | `findProjectByTeam` | `findProjectByTeamSync` |
| C3 | `src/lib/projects.ts` | `hasProjects` | `hasProjectsSync` |
| C3 | `src/lib/providers.ts` | `clearCredentialFileAuth` | `clearCredentialFileAuthSync` |
| C3 | `src/lib/providers.ts` | `setupCredentialFileAuth` | `setupCredentialFileAuthSync` |
| C3 | `src/lib/runtime/claude.ts` | `createClaudeAdapter` | `createClaudeAdapterSync` |
| C3 | `src/lib/runtime/metrics.ts` | `loadMetrics` | `loadMetricsSync` |
| C3 | `src/lib/runtimes/claude-code.ts` | `createClaudeCodeRuntime` | `createClaudeCodeRuntimeSync` |
| C3 | `src/lib/runtimes/codex.ts` | `createCodexRuntime` | `createCodexRuntimeSync` |
| C3 | `src/lib/xbrief/lifecycle.ts` | `ensureXBriefDirs` | `ensureXBriefDirsSync` |

Special cases in C1:
- `saveProjectsConfig`, `writeRouterConfig`, `recordCost` and `resetCostTracking` lost only their Effect variant. Their `…Sync` twins stay because tests use them as setup for surviving subjects. `writeRouterConfigSync` is also asserted by the PAN-3859 no-loss audit (`tests/unit/lib/overdeck/pan-3859-no-loss-audit.test.ts`). All four are test-only now and belong to CH-8.
- `src/lib/cloister/task-readiness.ts` and `src/lib/cloister/test-agent.ts` had nothing left, so both modules are deleted with their only test files.

### Shape B (the one kept in CH-1a)

| Module | Deleted | Survivor |
| --- | --- | --- |
| `src/lib/traefik.ts` | `generateOverdeckTraefikConfig` | `generateOverdeckTraefikConfigSync`; `sync-sources/skills/pan-dev/SKILL.md` now calls it (the old snippet built an Effect and never ran it) |

### Also deleted because only deleted code used them

Types `ValidationContext`, `SummaryForkOptions`, `SummaryForkResult`, `WorkspaceCommitInfo`,
`GitHubPullRequestHeadState`, `ConvertOptions`, `ConvertResult`; error classes `SessionConvertError`,
`XBriefDagError`; `getSupportedRuntimes` (`runtime/index.ts`); and the private helpers, imports and
empty "Effect variants" headers left behind.

### Kept although dead, with the reason

| Name | Why | Owner |
| --- | --- | --- |
| `findClosedIssueAgentDirs`, `getSpecialistHandoffStats`, `listOpenIssuesWithLabels`, `getCiCheckRunsState`, `getShadowModeSummary`, `updateTrackerStatusCache`, `markAsSynced`, `getDisplayStatus` | The façade is dead but its body is live and tested through it. D4: port those tests when W6 exports the body under the bare name | CH-2 … CH-5 |
| `stopSmeeClient` | Teardown in `tests/unit/lib/smee.test.ts` for the live `startSmeeClient` | CH-4 (K3a) |
| `relayUatFailureFeedback` (+ `relayUatFailureFeedbackPromise`) | Its last caller (`deliverUatFailureToWorkAgentHostSide` in the review-status family) was removed by PAN-3917 (`c3ec36c29a9`) with no entry in `docs/THE-CUT.md` and no replacement: UAT-failure feedback may no longer reach work agents. Operator decision | operator |
| `OhmypiRuntime`, `createOhmypiRuntime`, and `AgentRuntime` / `AgentRuntimeError` in `runtimes/types.ts` | Oh My Pi code is off limits; `OhmypiRuntime` still implements the interface | #4003 |
| `querySession` (`tmux.ts`) | Row 44 is a "+ S" row; W8 converts its server callers to this async variant | CH-6 |

### Tests deleted with their subject

Deleted as whole files:
- `src/lib/cloister/__tests__/task-readiness.test.ts` and `tests/lib/cloister/test-agent.test.ts` (modules deleted);
- `tests/unit/lib/git-utils.test.ts` (only `getWorkspaceGitInfo`).

Blocks deleted:
- `describe`: `convertConversationTranscript`, `checkAllCriteriaCompleted`, `readPlanFile`, `moveXBrief`, `runMergeValidation` (unit, plus five integration scenarios), `hasStaleLocks`, `getShadowModeStatus`, `getUnsyncedHistory`, `gitForcePush`, `gitMerge`, and the prd-draft `read/write/list/delete/getPRDDraftInfo` blocks.
- `it`: two createSummaryFork route tests; seven summary-fork-handoff tests that drove `createSummaryFork` (the live orchestration is `conversation-forks.ts`); two stash tests of `createNamedStash`; the `supervisorProcessAlive` async probe; the pty-token sync API.
- `src/lib/runtimes/__tests__/pi.test.ts`: every `PiRuntime*` describe; the `PiSpawnTimeout` test stays.

Ported, not deleted:
- `syncWalFromDir` block → six tests on the live `syncWalFromAllProjects` (WAL parsing, required fields, duplicates, `.jsonl` filter, source_file);
- the three summary-fork fallback tests (source ended, handshake timeout, validation failure) → `handoffPreconditionFallbackReason` and `handoffFailureReason`, which `runForkPipeline` uses;
- stash "re-resolves a stable stash sha" → kept, minus the `applyStash`/`popStash` lines (`dropStash` and `createRecoveryBranchFromStash` are live);
- `isPlanningCompleteSync` → `isPlanningComplete` (io.test.ts);
- `writePtyTokenSync` → `await writePtyToken` (agents-lifecycle.test.ts);
- prd-draft `hasPRDDraft` setup → `writeIssueDraft`;
- settings-api: the `setRoleConfig` halves are gone, and the `getRoleConfig` and `saveSettingsApi` halves stay.

The whole diff removes more `it()` calls than it adds, so the PR asks for `pan verify waive-test-removal 4007`.

## CH-2: Promise-native cluster K1, `src/lib/cloister` (#4008)

Every live Shape A façade in `src/lib/cloister` is gone. The name survives as an exported `async`
function whose body is the former private implementation, so no operation was lost; only its
calling convention changed. Callers moved per PRD D2: `await Effect.runPromise(foo(…))` became
`await foo(…)`, and a `yield* foo(…)` inside `Effect.gen` became `yield* Effect.promise(() => foo(…))`.
Evidence: `node scripts/audit-effect-boundary.mjs --json --usage`, `tsc --noEmit` on the root,
dashboard and frontend projects, and the touched plus adjacent test files. Ratchet: A 187 → 161, with
B and C unchanged.

The issue title counts 24 used façades in 15 modules. The ratchet had 26 rows in 16 modules, and the
two extra rows are the CH-1b "kept although dead" façades in this cluster: `getSpecialistHandoffStats`
and `relayUatFailureFeedback`. Both are converted, not deleted, and their tests now call the body
directly (D4). The CH-1b operator row for `relayUatFailureFeedback` is resolved. PAN-4030 (#4033)
re-attached the relay in `pan admin specialists done` (`src/cli/commands/specialists/done.ts`),
where it now runs as a plain `async` function, so the relay has a production caller again.

### Shape A façades (26) → async functions

| Module | Name (now `async`) | Body formerly | Note |
| --- | --- | --- | --- |
| `ci-failure-feedback.ts` | `recordCiTestGatePass` | `recordCiTestGatePassPromise` | body renamed `recordCiTestGatePassInQueue` (private); the public function keeps the per-issue `withIssueQueue` serialisation |
| `ci-failure-feedback.ts` | `relayCiFailureFeedback` | `relayCiFailureFeedbackPromise` | body renamed `relayCiFailureFeedbackInQueue` (private); same queue |
| `feedback-writer.ts` | `clearFeedbackFiles` | `clearFeedbackFilesPromise` | `archiveFeedbackFiles` alias kept (CH-8) |
| `feedback-writer.ts` | `writeFeedbackFile` | `writeFeedbackFilePromise` | |
| `handoff-context.ts` | `captureHandoffContext` | `captureHandoffContextPromise` | |
| `handoff.ts` | `performHandoff` | `performHandoffPromise` | |
| `review-agent.ts` | `killAllReviewerSessions` | `killAllReviewerSessionsPromise` | |
| `review-agent.ts` | `killAllReviewSessions` | `killAllReviewSessionsPromise` | |
| `review-context.ts` | `buildReviewContext` | `buildReviewContextPromise` (was exported) | tests that imported `buildReviewContextPromise` now import `buildReviewContext` |
| `review-convoy.ts` | `buildConvoyPrompt` | `buildConvoyPromptPromise` | |
| `review-convoy.ts` | `spawnReviewSubRoleForIssue` | `spawnReviewSubRoleForIssuePromise` | still re-exported by `review-agent.ts` |
| `review-verdict-feedback.ts` | `deliverReviewVerdictFeedback` | `deliverReviewVerdictFeedbackPromise` | |
| `service-reactive.ts` | `onIssueStateChange` | `onIssueStateChangePromise` | still re-exported by `service.ts` |
| `service-reactive.ts` | `handleCloisterDomainEvent` | `handleCloisterDomainEventPromise` | still re-exported by `service.ts` |
| `session-rotation.ts` | `buildMergeAgentMemory` | `buildMergeAgentMemoryPromise` | |
| `session-rotation.ts` | `rotateSpecialistSession` | `rotateSpecialistSessionPromise` | |
| `session-rotation.ts` | `checkAndRotateIfNeeded` | `checkAndRotateIfNeededPromise` | |
| `specialist-context.ts` | `generateContextDigest` | `generateContextDigestPromise` | |
| `specialist-context.ts` | `regenerateContextDigest` | `regenerateContextDigestPromise` | |
| `specialist-handoff-logger.ts` | `getSpecialistHandoffStats` | `getSpecialistHandoffStatsPromise` | CH-1b kept row: test-only consumer, tests ported to the body |
| `specialist-handoff-logger.ts` | `updateSpecialistHandoffStatus` | `updateSpecialistHandoffStatusPromise` | |
| `triggers.ts` | `checkTaskCompletion` | `checkTaskCompletionPromise` | |
| `triggers.ts` | `checkAllTriggers` | `checkAllTriggersPromise` | |
| `uat-failure-feedback.ts` | `relayUatFailureFeedback` | `relayUatFailureFeedbackPromise` (was exported) | CH-1b operator row resolved: `specialists/done.ts` (#4033) calls it; its callers, tests and docs (`THE-CUT.md`, `PIPELINE-GATES.md`) use the plain name |
| `validation.ts` | `runQualityGates` | `runQualityGatesPromise` | |
| `verification-runner.ts` | `runVerificationForIssueInProcess` | `runVerificationForIssuePromise` | `runVerificationForIssue` (genuine Effect dispatcher, Q2) now bridges it with `Effect.promise` |

All paths are relative to `src/lib/cloister/`.

### Also deleted because only deleted code used them

| Name | Why |
| --- | --- |
| `FeedbackWriteError` (`feedback-writer.ts`) | the `catch:` mapping of the two feedback-writer façades; no other reference |
| `HandoffContextError` (`handoff-context.ts`) | the `catch:` mapping of the `captureHandoffContext` façade; no other reference |

`HandoffError` (`handoff.ts`) stays. `POST /api/agents/:id/handoff` is the one Effect caller that
bridged a former `Effect.tryPromise` façade, so it applies D2's safety-net row: it copies the old
`catch:` mapping into `Effect.tryPromise({ try, catch: → HandoffError })`. The failure stays a
typed failure, and the 500 body keeps the underlying message.

### Not converted, with the reason

`autoRevertMerge` (`validation.ts`), `spawnReviewRoleForIssue` (`review-agent.ts`) and
`runVerificationForIssue` (`verification-runner.ts`) are not Shape A rows. Each has a body of its own
(an `ok` check, the dispatch coalescer, the env dispatcher), so they stay Effect for Q2. Calls to
K2-cluster façades inside these modules (`getAgentState`, `saveAgentState`, `listSessionNames`,
`killSession`, `sessionExists`, `readFeedback`, `readPlan`, …) still use `Effect.runPromise`. CH-3
removes them.

### Tests

None are deleted. The diff adds and removes no `it()`/`test()` calls. Tests that ran a former façade
through `Effect.runPromise` now await the function. Mocks that returned `Effect.succeed(v)` /
`Effect.void` / `Effect.sync(…)` / `Effect.never` now return a Promise (`mockResolvedValue(v)`,
`async () => v`, `new Promise(() => {})`). `review-context.test.ts` "throws when workspace does not
exist" now asserts the message on the rejection itself, since there is no `FsError` wrapper; the
assertion is unchanged.
