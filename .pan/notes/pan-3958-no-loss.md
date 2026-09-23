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
