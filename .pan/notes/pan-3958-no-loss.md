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

## CH-3: Promise-native cluster K2 (#4009)

Every Shape A façade in cluster K2 is gone, except the Oh My Pi row (`runtimes/ohmypi-fifo.ts`
`createOhmypiFifo`, left for #4003). Each name survives as an exported `async` function whose body
is the former private implementation, so no operation was lost. Callers moved per PRD D2:
`await Effect.runPromise(foo(…))` became `await foo(…)`. In an `Effect.gen`, a former `Effect.promise`
façade became `yield* Effect.promise(() => foo(…))` and a former `Effect.tryPromise` façade became
`yield* Effect.tryPromise(() => foo(…))`. The one call site that mapped a typed failure
(`checkWorkspaceRemovalGuard`) keeps its `ProcessSpawnError` mapping in a two-argument `tryPromise`, and
the stash routes map to a `VcsError` that keeps git's error text (see behaviour notes).
Evidence: `node scripts/audit-effect-boundary.mjs --json --usage`, `tsc --noEmit` on the root,
dashboard and frontend projects, and 333 touched and adjacent test files.

Ratchet: A 161 → 110, B 38 unchanged, C 39 → 42. The C rows rise by hand, as PRD W6 step 3 predicts.
Three former façades had a `…Sync` sibling. With the façade gone, the pair is an ordinary Shape C
pair for CH-6 (W8) to decide: `capturePane`/`capturePaneSync` and `listPaneValues`/`listPaneValuesSync`
in `tmux.ts` (C 6 → 8), and `getWorkAgentLifecycleState`/`getWorkAgentLifecycleStateSync` in
`work-agent-lifecycle.ts` (C 0 → 1).

### Shape A façades (51) → async functions

| Module | Name (now `async`) | Body formerly | Note |
| --- | --- | --- | --- |
| `agent-directory-cleanup.ts` | `cleanupAgentDirectories` | `cleanupAgentDirectoriesPromise` |  |
| `agent-directory-cleanup.ts` | `cleanupClosedIssueAgentDirectories` | `cleanupClosedIssueAgentDirectoriesPromise` |  |
| `agent-directory-cleanup.ts` | `findClosedIssueAgentDirs` | `findClosedIssueAgentDirsPromise` | CH-1b "kept although dead" row: still test-only, tests call the async function |
| `agent-directory-cleanup.ts` | `findOrphanedAgentDirs` | `findOrphanedAgentDirsPromise` |  |
| `agent-enrichment.ts` | `computeAgentEnrichment` | `computeAgentEnrichmentPromise` |  |
| `agent-enrichment.ts` | `countPendingAskUserQuestionsForAgent` | `countPendingAskUserQuestionsForAgentPromise` |  |
| `agent-enrichment.ts` | `countPendingAskUserQuestionsForCurrentAgentSession` | `countPendingAskUserQuestionsForCurrentAgentSessionPromise` |  |
| `agent-enrichment.ts` | `getAgentJsonlMtime` | `getAgentJsonlMtimePromise` |  |
| `agent-enrichment.ts` | `getAgentJsonlPath` | `getAgentJsonlPathPromise` |  |
| `agent-enrichment.ts` | `getAgentPendingQuestions` | `getAgentPendingQuestionsPromise` |  |
| `agent-enrichment.ts` | `getAgentWorkspace` | `getAgentWorkspacePromise` |  |
| `agent-enrichment.ts` | `getPendingQuestions` | `getPendingQuestionsPromise` |  |
| `agent-input-detection.ts` | `detectAwaitingInputForAgent` | `detectAwaitingInputForAgentPromise` | `pending-decision-gate.ts` keeps mapping its rejection to `TmuxError`, which that gate fails open on |
| `caveman/workspace.ts` | `injectCavemanSettings` | `injectCavemanSettingsPromise` |  |
| `caveman/workspace.ts` | `readCavemanVariant` | `readCavemanVariantPromise` |  |
| `checkpoint/checkpoint-manager.ts` | `deleteLegacyCheckpointRefs` | `deleteLegacyCheckpointRefsPromise` |  |
| `checkpoint/checkpoint-manager.ts` | `diffAgainstMain` | `diffAgainstMainPromise` |  |
| `checkpoint/checkpoint-manager.ts` | `diffAgainstMainFiles` | `diffAgainstMainFilesPromise` |  |
| `checkpoint/checkpoint-manager.ts` | `diffFilesAgainstHead` | `diffFilesAgainstHeadPromise` |  |
| `checkpoint/checkpoint-manager.ts` | `diffPatchFilesAgainstHead` | `diffPatchFilesAgainstHeadPromise` |  |
| `checkpoint/checkpoint-manager.ts` | `diffPatchSinceCommit` | `diffPatchSinceCommitPromise` |  |
| `checkpoint/checkpoint-manager.ts` | `findCommitAtTime` | `findCommitAtTimePromise` |  |
| `checkpoint/checkpoint-manager.ts` | `pruneCheckpointRefsForAgents` | `pruneCheckpointRefsForAgentsPromise` |  |
| `git-utils.ts` | `cleanupStaleLocks` | `cleanupStaleLocksPromise` | the façade's `options = {}` default moved onto the function |
| `git/operations.ts` | `gitFetch` | `gitFetchPromise` |  |
| `git/operations.ts` | `gitPush` | `gitPushPromise` | rejects with `MainDivergedError` itself; see behaviour notes |
| `git/operations.ts` | `gitRevParse` | `gitRevParsePromise` |  |
| `health.ts` | `isAgentAlive` | `isAgentAlivePromise` |  |
| `rebase-helper.ts` | `rebaseAndPushRepos` | `rebaseAndPushReposPromise` |  |
| `remote-workspace.ts` | `createRemoteWorkspace` | `createRemoteWorkspacePromise` |  |
| `reopen.ts` | `reopenWorkspaceState` | `reopenWorkspaceStatePromise` |  |
| `runtime/index.ts` | `isRuntimeInstalled` | `isRuntimeInstalledPromise` |  |
| `runtimes/pi-fifo.ts` | `createPiFifo` | `createPiFifoPromise` |  |
| `safety/dangerous-git-ops.ts` | `dryRunGitClean` | `dryRunGitCleanPromise` |  |
| `safety/dangerous-git-ops.ts` | `runGitClean` | `runGitCleanPromise` | rejects with `DangerousOpBlockedError` itself; see behaviour notes |
| `safety/dangerous-git-ops.ts` | `runGitResetHard` | `runGitResetHardPromise` |  |
| `stashes.ts` | `createRecoveryBranchFromStash` | `createRecoveryBranchFromStashPromise` |  |
| `stashes.ts` | `dropStash` | `dropStashPromise` |  |
| `stashes.ts` | `listStashes` | `listStashesPromise` |  |
| `test-runner.ts` | `runTests` | `runTestsPromise` |  |
| `tmux.ts` | `capturePane` | `capturePaneText` | the exported `capturePaneText` is renamed `capturePane` (its 7 production and 4 test users follow); the body never rejects |
| `tmux.ts` | `ensureManagedTmuxContextOnce` | `ensureManagedTmuxContextOncePromise` | its only caller (dashboard `main.ts`) awaited the unrun Effect, so it never ran; that dead call is removed, see below. It now has no production caller: a CH-8 dead-export candidate unless the operator restores the boot call |
| `tmux.ts` | `listPaneValues` | `listPaneValuesText` | private `listPaneValuesText` renamed and exported; never rejects |
| `work-agent-lifecycle.ts` | `getWorkAgentLifecycleState` | `getWorkAgentLifecycleStateSnapshot` | body formerly `getWorkAgentLifecycleStateSnapshot` |
| `work/done-preflight.ts` | `runPreflightChecks` | `runPreflightChecksPromise` |  |
| `workspace-manager.ts` | `addNewRepoToWorkspace` | `addNewRepoToWorkspacePromise` | body lives in `workspace-manager/`; `workspace-manager.ts` re-exports it. |
| `workspace-manager.ts` | `addReposToWorkspace` | `addReposToWorkspacePromise` | body lives in `workspace-manager/`; `workspace-manager.ts` re-exports it. |
| `workspace-manager.ts` | `createWorkspace` | `createWorkspacePromise` | body lives in `workspace-manager/`; `workspace-manager.ts` re-exports it. |
| `workspace-manager.ts` | `getContainersReferencingWorkspacePath` | `getContainersReferencingWorkspacePathPromise` | body lives in `workspace-manager/`; `workspace-manager.ts` re-exports it. |
| `workspace-manager.ts` | `removeWorkspace` | `removeWorkspacePromise` | body lives in `workspace-manager/`; `workspace-manager.ts` re-exports it. |
| `workspace-manager.ts` | `stopWorkspaceDocker` | `stopWorkspaceDockerPromise` | body lives in `workspace-manager/`; `workspace-manager.ts` re-exports it. |

All paths are relative to `src/lib/`.

### Also deleted because only deleted code used them

| Name | Why |
| --- | --- |
| `DangerousGitOpError` (`safety/dangerous-git-ops.ts`) | the `catch:` mapping of the deleted façades; no other reference |
| `RebaseError` (`rebase-helper.ts`) | the `catch:` mapping of the deleted façades; no other reference |
| `RemoteWorkspaceError` (`remote-workspace.ts`) | the `catch:` mapping of the deleted façades; no other reference |
| `ReopenError` (`reopen.ts`) | the `catch:` mapping of the deleted façades; no other reference |
| `PiFifoError` (`runtimes/pi-fifo.ts`) | the `catch:` mapping of the deleted façades; no other reference |
| private `toWmProcessError` (`workspace-manager.ts`), `toGitError` (`stashes.ts`), `processError` (`work/done-preflight.ts`) | the same façades' `catch:` helpers |
| the `*Shared` aliases in `dashboard/server/routes/agents/shared.ts` | alias shims (issue #4009): a plain import now, and the trailing `export { … }` block keeps the five names |

### Behaviour notes for reviewers

- **`gitPush` divergence handling now fires.** `pushApproveMain` in `routes/workspaces/merge-ops.ts`
  checks `err instanceof MainDivergedError`. Through the façade, `Effect.runPromise` rejected with the
  `VcsError` wrapper, so that branch never matched, and a diverged push took the generic-failure path
  (HTTP 400, "push failed"). It now returns the intended HTTP 409 with recovery steps.
  `salvageStrandedMerge` (`cloister/merge-agent.ts`) has the same check but no caller. It is a CH-8
  dead-code candidate.
- **`pan workspace deep-clean`** checks `err instanceof DangerousOpBlockedError`. That check can now
  match, but the branch is unreachable today, because the command's only `runGitClean` call passes
  `userInvoked: true`.
- **Dashboard boot never prepared the managed tmux context.** `main.ts` did
  `await ensureManagedTmuxContextOnce()`. Since PAN-1379 that awaited an unrun Effect (not thenable),
  so the preparation never ran, and tmux is prepared lazily by the first `tmuxExecAsync`. This PR
  removes the dead call instead of starting to run it. Running it would start a persistent
  (`exit-empty off`) managed tmux server at boot on Herdr hosts, through `ensureOverdeckTmuxServerSync`
  (`execFileSync`). Restoring it is an operator decision.
- **Rejections are the underlying errors, not the tagged wrappers.** Log lines that print `err.message`
  show the underlying message. The six stash-route bridges (`routes/workspaces/stash-clean.ts`,
  `workspace-data.ts`) use the two-argument `Effect.tryPromise` with a `VcsError` that carries git's
  error text, so httpHandler's 500 body shows git's message. Before, it showed an empty string,
  because `GitError` declares no `message`. No converted route's error body falls back to Effect's
  generic "An error occurred in Effect.tryPromise".

### Tests

None are deleted, and the diff adds and removes no `it()`/`test()` calls. Tests that ran a former façade
through `Effect.runPromise` now await it. Mocks that returned `Effect.succeed` / `fail` / `void` /
`sync` / `promise` / `never` now return Promises (`mockResolvedValue`, `mockRejectedValue`,
`async () => v`, `mockImplementation(() => promise)` for lazy ones). Assertions on the removed wrapper's
fields now check the underlying error, with the same intent:
`toMatchObject({ cause: expect.any(MainDivergedError) })` → `toBeInstanceOf(MainDivergedError)`,
`{ stderr: X }` → `toThrow(X)` / `toBe(err)`, and `DangerousGitOpError` → `DangerousOpBlockedError`
(`git-operations`, `git/operations`, `divergence-e2e`, `dangerous-git-ops`, `stashes` tests).

### Correction to the CH-2 section

CH-2 said the `Effect.runPromise(getAgentState / saveAgentState / listSessionNames / killSession /
sessionExists / readFeedback / readPlan …)` calls left in cloister "belong to CH-3". None of those is a
K2 Shape A row. `getAgentState` is a live Shape B wrapper (W7). `saveAgentState`, `listSessionNames`,
`sessionExists`, `killSession` and `readPlan` are Shape C twins (§10 / W8). `readFeedback` is a genuine
Effect export. All of them belong to CH-6, or stay for good under Q2.

## CH-4: Promise-native cluster K3a (#4010)

Every Shape A façade in cluster K3a is gone. The issue counts 65 façades; the ratchet had 68 rows in 16 modules, and the
three extra are this cluster's CH-1b "kept although dead" rows (`listOpenIssuesWithLabels`, `getCiCheckRunsState`,
`stopSmeeClient`). Each name survives as an exported `async` function. Callers moved per PRD D2, and every call site
that recovered from, or reported, a typed failure keeps that mapping (details below). Evidence:
`node scripts/audit-effect-boundary.mjs --json --usage`, `tsc --noEmit` on the root, dashboard and frontend projects, and
the touched and adjacent test files.

Ratchet: A 110 → 42, B 38 unchanged, C 42 → 48. The C rows rise by hand as PRD W6 step 3 predicts: once the façade is
gone, each former façade with a `…Sync` sibling becomes an ordinary Shape C pair for CH-6. That is five in `cliproxy.ts`
(`bridgeCodexAuthToCliproxy`, `installCliproxy`, `isCliproxyRunning`, `startCliproxy`, `stopCliproxy`) and one in
`openai-auth.ts` (`getOpenAIAuthStatus`). Across A, B and C the total drops from 190 to 128. Dashboard type errors: 18 → 14 (the
`Promise | Effect` unions in `routes/tts.ts` are gone).

### Shape A façades (68) → async functions

| Module | Name (now `async`) | Body formerly | Note |
| --- | --- | --- | --- |
| `cliproxy.ts` | `bridgeCodexAuthToCliproxy` | `bridgeCodexAuthToCliproxyTask` | with `bridgeCodexAuthToCliproxySync`, now a Shape C pair (CH-6) |
| `cliproxy.ts` | `bridgeGeminiAuthToCliproxy` | `bridgeGeminiAuthToCliproxyTask` |  |
| `cliproxy.ts` | `installCliproxy` | `installCliproxyTask` | with `installCliproxySync`, now a Shape C pair (CH-6) |
| `cliproxy.ts` | `isCliproxyRunning` | `isCliproxyRunningTask` | with `isCliproxyRunningSync`, now a Shape C pair (CH-6) |
| `cliproxy.ts` | `restartCliproxy` | `restartCliproxyTask` |  |
| `cliproxy.ts` | `startCliproxy` | `startCliproxyTask` | with `startCliproxySync`, now a Shape C pair (CH-6) |
| `cliproxy.ts` | `stopCliproxy` | `stopCliproxyTask` | with `stopCliproxySync`, now a Shape C pair (CH-6) |
| `codex-auth.ts` | `checkCodexAuthStatus` | `checkCodexAuthStatusPromise` |  |
| `github-app.ts` | `getCiCheckRunsState` | `getCiCheckRunsStatePromise` | CH-1b row resolved: the body was already exported and used by `merge-ops.ts`, which now calls this name |
| `github-app.ts` | `getIssueState` | `getIssueStatePromise` | the exported body name is retired; its test imports follow |
| `github-app.ts` | `getPullRequestState` | `getPullRequestStatePromise` |  |
| `github-app.ts` | `listOpenIssuesWithLabels` | `listOpenIssuesWithLabelsPromise` | CH-1b row resolved: the body was already exported and used by `pipeline-membership-gather.ts`, which now calls this name |
| `github-app.ts` | `listPullRequestsForHead` | `listPullRequestsForHeadPromise` | the exported body name is retired; its test imports follow |
| `github-app.ts` | `mergePullRequestWithApp` | `mergePullRequestWithAppPromise` |  |
| `hume.ts` | `createHumeConfig` | `createHumeConfigPromise` |  |
| `hume.ts` | `deleteHumeConfig` | `deleteHumeConfigPromise` |  |
| `openai-auth.ts` | `getOpenAIAuthStatus` | `getOpenAIAuthStatusPromise` | with `getOpenAIAuthStatusSync`, now a Shape C pair (CH-6) |
| `openai-compatible-proxy.ts` | `ensureOpenAICompatibleProxyRunning` | `ensureOpenAICompatibleProxyRunningPromise` |  |
| `platform-lifecycle.ts` | `restartCliproxy` | `restartCliproxyPromise` | body renamed `restartCliproxyBody`; keeps the `StageError` wrapping (not the same function as `cliproxy.ts` `restartCliproxy`) |
| `platform-lifecycle.ts` | `restartDashboard` | `restartDashboardPromise` | body renamed `restartDashboardBody`; keeps the `StageError` wrapping |
| `platform-lifecycle.ts` | `restartTraefik` | `restartTraefikPromise` | body renamed `restartTraefikBody`; keeps the `StageError` wrapping |
| `platform-lifecycle.ts` | `startTraefik` | `startTraefikPromise` | body renamed `startTraefikBody`; keeps the `StageError` wrapping |
| `platform-lifecycle.ts` | `stopDashboard` | `stopDashboardPromise` | body renamed `stopDashboardBody`; the public function keeps the `StageError` wrapping |
| `platform-lifecycle.ts` | `stopTraefik` | `stopTraefikPromise` |  |
| `platform-lifecycle.ts` | `waitForDashboardHealth` | `waitForDashboardHealthPromise` | body renamed `waitForDashboardHealthBody`; keeps the `StageError` wrapping |
| `platform-lifecycle.ts` | `waitForTraefikHealth` | `waitForTraefikHealthPromise` |  |
| `provider-health.ts` | `probeProvider` | `probeProviderPromise` |  |
| `provider-health.ts` | `validateProviderHealth` | `validateProviderHealthPromise` | body renamed `validateProviderHealthBody`; the public function keeps the re-wrap to `ProviderHealthError` (fail closed) |
| `restart-lock.ts` | `acquireRestartLock` | `acquireRestartLockPromise` |  |
| `restart-lock.ts` | `readRestartLockHolder` | `readRestartLockHolderPromise` |  |
| `restart-status.ts` | `readRestartEvents` | `readRestartEventsPromise` |  |
| `restart-status.ts` | `readRestartStatus` | `readRestartStatusPromise` |  |
| `restart-status.ts` | `writeRestartStatus` | `writeRestartStatusPromise` |  |
| `smee.ts` | `startSmeeClient` | `startSmeeClientPromise` |  |
| `smee.ts` | `stopSmeeClient` | `stopSmeeClientPromise` | CH-1b row: still only test teardown uses it (CH-8 candidate) |
| `tts-daemon.ts` | `getTtsDaemonAuthHeaders` | `getTtsDaemonAuthHeadersPromise` |  |
| `tts-daemon.ts` | `getTtsDaemonAuthToken` | `getTtsDaemonAuthTokenPromise` |  |
| `tts-daemon.ts` | `getTtsDaemonPython` | `getTtsDaemonPythonPromise` |  |
| `tts-daemon.ts` | `getTtsDaemonStatus` | `getTtsDaemonStatusPromise` |  |
| `tts-daemon.ts` | `getTtsDaemonVenvDir` | `getTtsDaemonVenvDirPromise` |  |
| `tts-daemon.ts` | `hasTtsDaemonState` | `hasTtsDaemonStatePromise` |  |
| `tts-daemon.ts` | `installTtsDaemonDependencies` | `installTtsDaemonDependenciesPromise` |  |
| `tts-daemon.ts` | `installTtsSystemdUnit` | `installTtsSystemdUnitPromise` |  |
| `tts-daemon.ts` | `isTtsDaemonManuallyStopped` | `isTtsDaemonManuallyStoppedPromise` |  |
| `tts-daemon.ts` | `resolveQwenTtsPackageDir` | `resolveQwenTtsPackageDirPromise` | the exported body name is retired; its tests follow |
| `tts-daemon.ts` | `resolveTtsDaemonScript` | `resolveTtsDaemonScriptPromise` |  |
| `tts-daemon.ts` | `runTtsDaemonForeground` | `runTtsDaemonForegroundPromise` |  |
| `tts-daemon.ts` | `startTtsDaemon` | `startTtsDaemonPromise` |  |
| `tts-daemon.ts` | `stopTtsDaemon` | `stopTtsDaemonPromise` |  |
| `tts-daemon.ts` | `waitForTtsDaemonHealth` | `waitForTtsDaemonHealthPromise` |  |
| `tts-speak.ts` | `resolveAndSpeak` | `resolveAndSpeakPromise` |  |
| `tts-voices.ts` | `addVoice` | `addVoicePromise` |  |
| `tts-voices.ts` | `clearVoices` | `clearVoicesPromise` |  |
| `tts-voices.ts` | `deleteVoice` | `deleteVoicePromise` |  |
| `tts-voices.ts` | `findVoiceById` | `findVoiceByIdPromise` |  |
| `tts-voices.ts` | `findVoiceByName` | `findVoiceByNamePromise` |  |
| `tts-voices.ts` | `loadVoices` | `loadVoicesPromise` |  |
| `tts-voices.ts` | `saveVoices` | `saveVoicesPromise` |  |
| `tunnel.ts` | `addTunnelIngress` | `addTunnelIngressPromise` |  |
| `tunnel.ts` | `removeTunnelIngress` | `removeTunnelIngressPromise` |  |
| `webhook-handlers.ts` | `handleCheckRun` | `handleCheckRunPromise` |  |
| `webhook-handlers.ts` | `handleCheckSuite` | `handleCheckSuitePromise` |  |
| `webhook-handlers.ts` | `handleIssueComment` | `handleIssueCommentPromise` |  |
| `webhook-handlers.ts` | `handlePullRequest` | `handlePullRequestPromise` |  |
| `webhook-handlers.ts` | `handlePullRequestReview` | `handlePullRequestReviewPromise` |  |
| `webhook-handlers.ts` | `handlePullRequestReviewComment` | `handlePullRequestReviewCommentPromise` |  |
| `webhook-handlers.ts` | `handlePullRequestReviewThread` | `handlePullRequestReviewThreadPromise` |  |
| `webhook-handlers.ts` | `handleStatus` | `handleStatusPromise` |  |

All paths are relative to `src/lib/`.

### Kept typed mappings (no fail-open, no message regression)

- **`StageError` (`platform-lifecycle.ts`).** `pan restart` and `pan reload` branch on `err instanceof StageError` to print
  `[stage] reason` and the recovery hint. The six façades that wrapped any other throw into a `StageError` now do the same
  in their exported async functions (`asStage`), so both commands behave as before.
- **`ProviderHealthError` (`provider-health.ts`).** The spawn route blocks a spawn on any `validateProviderHealth` failure
  and reads `provider` / `probeResult`. The function still re-wraps any other throw as kind `'unknown'`, so the
  route fails closed exactly as before. The route bridges it with a two-argument `Effect.tryPromise`.
- **Route 500 bodies keep their text.** The cliproxy restart route, the codex-auth routes, the spawn route's Codex check, and
  `GET /api/settings/openai-auth` bridge with a two-argument `Effect.tryPromise` that maps to the same error the façade
  raised (`CliproxyError`, `CodexAuthCheckError`, `FsError`). The TTS voice routes keep their `FsError` (operation + store
  path) text through a small `voiceStore` wrapper. `getCodexAuthPath` (`openai-auth.ts`) and `CheckCodexAuthOptions`
  (`codex-auth.ts`) are now exported so the routes can build those errors.
- **Webhooks.** The eight handlers run after signature verification and repository authorization, inside a forked
  `Effect.promise` whose failures are only logged. That path is unchanged. Signature verification, secret loading and
  `generateInstallationToken` / `refreshWorkspaceToken` (genuine Effect functions) are not touched.

### Also deleted because only deleted code used them

| Name | Where |
| --- | --- |
| `HumeApiError` | `hume.ts` |
| `OpenAICompatibleProxyError` | `openai-compatible-proxy.ts` |
| `RestartLockError` | `restart-lock.ts` |
| `RestartStatusError` | `restart-status.ts` |
| private `cliproxyCatch`, `ttsProcessError`, `ttsFsError`, `toGhError` | `cliproxy.ts`, `tts-daemon.ts`, `webhook-handlers.ts` |

### Behaviour notes for reviewers

- Five façades mapped every rejection to a fixed text: `startSmeeClient failed`, `stopSmeeClient failed`,
  `resolveAndSpeak failed`, `addTunnelIngress failed` and `removeTunnelIngress failed`. Those rejections now carry the
  underlying error's message. A failed `POST /api/tts/speak` therefore returns the cause in its 500 body instead of
  "resolveAndSpeak failed". A workspace create or remove that throws in the tunnel step reports the cause as well.
- `pan status` reads the restart status and the restart event log with `Promise.all` instead of a sequential `Effect.all`.
  Both are independent file reads.
- `tts-speak.ts` and `cli/commands/tts.ts` keep their `runPromiseOrProgram` helper for injected test dependencies that
  still return an Effect; production values are now always Promises (CH-8 can simplify it).

### Tests

None are deleted, and the diff adds and removes no `it()`/`test()` calls. Tests await the functions, and mocks return
Promises. That includes `(fn as unknown as Mock).mockReturnValue(Effect.succeed(…))` casts and arrow-forwarded mock keys
(`getPullRequestState: (...a) => mocks.getPullRequestState(...a)`). Tests of the exported bodies now import the plain names.

## CH-5: Promise-native cluster K3b (#4011)

Every Shape A façade in cluster K3b is gone, leaving only the Oh My Pi row (`runtimes/ohmypi-fifo.ts`, #4003). The issue
counts 37 façades; the ratchet had 41 rows in 16 modules, and the four extra are this cluster's CH-1b "kept although dead"
rows (`getShadowModeSummary`, `updateTrackerStatusCache`, `markAsSynced`, `getDisplayStatus`). Each name survives as an
exported function returning a Promise. Callers moved per PRD D2, and every call site that recovered from or reported a
typed failure keeps that mapping. Evidence: `node scripts/audit-effect-boundary.mjs --json --usage`, `tsc --noEmit` on the
root, dashboard and frontend projects, and the touched and adjacent test files.

Ratchet: A 42 → 1 (only the Oh My Pi row remains), B 38 unchanged, C 48 → 52. The C rows rise by hand as PRD W6 step 3
predicts: `loadConfig` and `getConversationsConfig` in `config.ts` (C 0 → 2), `findDraftPrd` in `prd-locations.ts` (C 0 → 1)
and `renameProject` in `projects.ts` (C 4 → 5). Across A, B and C the total drops from 128 to 91. Effect diagnostics: 264 → 254.

### Shape A façades (41) → Promise functions

| Module | Name | Body formerly | Note |
| --- | --- | --- | --- |
| `config-yaml/load.ts` | `loadConfigNoMigration` | `loadConfigWithoutMigration` | the genuine Effect `getConversationsConfig` in the same module now bridges it with a two-argument `Effect.tryPromise` that keeps `ConfigError` |
| `config.ts` | `getConversationsConfig` | `readConversationsConfig` | no production caller: the six route callers and four ws-rpc callers use the genuine Effect `getConversationsConfig` in `config-yaml/load.ts` (the audit counted them by name). With `getConversationsConfigSync`, now a Shape C pair; a CH-8 dead-export candidate |
| `config.ts` | `loadConfig` | `loadConfigFromFile` | with `loadConfigSync`, now a Shape C pair (CH-6) |
| `conversations/enrichment/enrich-session.ts` | `enrichSession` | `enrichSessionPromise` |  |
| `conversations/smart-compaction.ts` | `generateSmartSummary` | `generateSmartSummaryPromise` |  |
| `conversations/smart-compaction.ts` | `runModelSummary` | `runModelSummaryPromise` | in-module callers still go through `self.runModelSummary` (the `import * as self` seam tests spy on) |
| `conversations/summary-fork.ts` | `copySessionFromCompactBoundary` | `copySessionFromCompactBoundaryPromise` |  |
| `conversations/summary-fork.ts` | `generateFallbackSummary` | `generateFallbackSummaryPromise` |  |
| `conversations/summary-fork.ts` | `reserveSummaryForkSession` | `reserveSummaryForkSessionPromise` |  |
| `costs/reconciler.ts` | `reconcile` | `reconcilePromise` |  |
| `costs/sync-wal.ts` | `syncWalFromAllProjects` | `syncWalFromAllProjectsPromise` |  |
| `memory/checkpoint-client.ts` | `claimTranscriptRange` | `postWorkerRequest` | body is the shared `postWorkerRequest`; a private `request()` keeps the façade's `toError` mapping |
| `memory/checkpoint-client.ts` | `commitTranscriptRange` | `postWorkerRequest` | same `request()` path |
| `memory/checkpoint-client.ts` | `getTranscriptCheckpoint` | `postWorkerRequest` | same `request()` path |
| `memory/checkpoint-client.ts` | `listTranscriptCheckpoints` | `postWorkerRequest` | same `request()` path |
| `memory/checkpoint-client.ts` | `releaseTranscriptRange` | `postWorkerRequest` | same `request()` path |
| `prd-draft.ts` | `hasPRDDraft` | `hasPRDDraftPromise` | the body was a non-async function returning a Promise |
| `prd-locations.ts` | `findDraftPrd` | `findDraftPrdAsync` | the exported body `findDraftPrdAsync` is retired; with `findDraftPrdSync`, now a Shape C pair (CH-6) |
| `projects.ts` | `renameProject` | `updateProjectsConfigAsync` | body is the shared `updateProjectsConfigAsync` (atomic `projects.yaml` write, unchanged); the function keeps the façade's error mapping (rejects only with `ProjectRenameError`, `ConfigParseError` or `FsError`). With `renameProjectSync`, now a Shape C pair (CH-6) |
| `review-artifacts.ts` | `buildRichReviewArtifactBody` | `buildRichReviewArtifactBodyPromise` |  |
| `review-artifacts.ts` | `createReviewArtifactsForIssue` | `createReviewArtifactsForIssuePromise` |  |
| `settings-api.ts` | `saveDesignLanguage` | `saveDesignLanguagePromise` | the body still runs through `runSettingsWriteSerialized` |
| `settings-api.ts` | `saveOpenRouterFavorites` | `saveOpenRouterFavoritesPromise` |  |
| `settings-api.ts` | `saveSettingsApi` | `saveSettingsApiPromise` | the body still runs through `runSettingsWriteSerialized` (write queue unchanged) |
| `settings-api.ts` | `updateProviderApiKey` | `updateProviderApiKeyPromise` |  |
| `settings-api.ts` | `updateSettingsApi` | `updateSettingsApiPromise` |  |
| `shadow-mode.ts` | `getShadowModeSummary` | `getShadowModeSummaryPromise` | CH-1b row: still test-only (CH-8 candidate) |
| `shadow-mode.ts` | `isShadowModeEnabled` | `isShadowModeEnabledPromise` |  |
| `shadow-mode.ts` | `resolveShadowMode` | `resolveShadowModePromise` |  |
| `shadow-mode.ts` | `shouldSkipTrackerUpdate` | `shouldSkipTrackerUpdatePromise` |  |
| `shadow-state.ts` | `createShadowState` | `createShadowStatePromise` |  |
| `shadow-state.ts` | `getDisplayStatus` | `getDisplayStatusPromise` | CH-1b row: still test-only (CH-8 candidate) |
| `shadow-state.ts` | `getPendingSyncCount` | `getPendingSyncCountPromise` |  |
| `shadow-state.ts` | `getShadowState` | `getShadowStatePromise` |  |
| `shadow-state.ts` | `isShadowed` | `isShadowedPromise` |  |
| `shadow-state.ts` | `listShadowedIssues` | `listShadowedIssuesPromise` |  |
| `shadow-state.ts` | `markAsSynced` | `markAsSyncedPromise` | CH-1b row: still test-only (CH-8 candidate) |
| `shadow-state.ts` | `needsSync` | `needsSyncPromise` |  |
| `shadow-state.ts` | `updateShadowState` | `updateShadowStatePromise` |  |
| `shadow-state.ts` | `updateTrackerStatusCache` | `updateTrackerStatusCachePromise` | CH-1b row: still test-only (CH-8 candidate) |
| `xbrief/lifecycle-io.ts` | `transitionXBriefOnMain` | `transitionXBriefOnMainPromise` |  |

All paths are relative to `src/lib/`.

### Laziness, writes, queues

- **No eager work at module load.** No converted function is called at the top level of any module (the audit's `top`
  column is 0 for every row). Every call site that is not immediately awaited is either a lazy arrow
  (`() => reconcileClaudeTranscripts()`, the memory pipeline's `?? ((…) => claimTranscriptRange(…))` defaults) or a
  genuine Effect with the same name in `config-yaml/load.ts`.
- **Writes.** `renameProject` still writes `projects.yaml` through `updateProjectsConfigAsync`. `saveSettingsApi` and
  `saveDesignLanguage` still go through `runSettingsWriteSerialized`. No function body changed, so atomicity and ordering are
  unchanged.
- **Typed recoveries kept.** `POST /api/projects/:projectKey/rename` still maps `ProjectRenameError` to 404/400/409 (the route bridges with
  a two-argument `Effect.tryPromise`). The drag-drop shadow update in `issue-transitions.ts` keeps its `ShadowStateError`.
  `issue-closed` keeps its `null` fallback. The orphan-dashboard reaper keeps its `3011` fallback. The start route keeps its
  non-fatal xBRIEF transition logging.

### Also deleted because only deleted code used them

| Name | Where |
| --- | --- |
| `ReviewArtifactError` | `review-artifacts.ts` |
| `SettingsApiError` | `settings-api.ts` |
| `ShadowModeError` | `shadow-mode.ts` |
| private `wrapConfigErr` | `prd-draft.ts` |

### Behaviour notes for reviewers

- Rejections carry the underlying error instead of the façade's wrapper (`FsError`, `ConfigError`, `ShadowStateError`, …).
  No caller inspected those wrappers except the sites listed above, which keep their mapping.
- One log line changed: the start route's "xBRIEF running transition failed (non-fatal)" warning now prints the underlying
  message instead of `FsError`'s "transitionXBriefOnMain failed for <root>: …" text.
- Several façades mapped rejections to an `FsError` whose message is "<operation> failed for <path>: <cause>"
  (`generateFallbackSummary`, `reserveSummaryForkSession`, `copySessionFromCompactBoundary`, `generateSmartSummary`,
  `reconcile`, `loadConfig`). On the rare filesystem failure that reaches a 500 body (conversation compaction, the handoff
  and fork routes, the cost reconcile route), the body now shows the underlying cause without that prefix. Status codes are
  unchanged, and no body falls back to Effect's generic "An error occurred in Effect.tryPromise".

### Tests

None are deleted, and the diff adds and removes no `it()`/`test()` calls. Tests await the functions, and mocks return
Promises, including `vi.spyOn(smartCompaction, 'runModelSummary')` chains and the TTS watchdog's config mock. Mocks of
same-named genuine Effects (`config-yaml` `loadConfig` / `getConversationsConfig`, `CostWriter.reconcile`) are left alone.

Review follow-up, a sweep of every test file for mocks of a CH-2..CH-5 converted name that still return an Effect (`await`
on an Effect yields the Effect object, so such a test passes by accident or tests nothing; typecheck skips test files):

- `conversations-fork-pipeline.test.ts`: the three `generateFallbackSummary` mocks now resolve or reject. The
  "heuristic fallback also fails" test now asserts the rejection is logged and `prependFallbackFocus` gets the `''` seed
  (it fails if the mock returns `Effect.fail` again).
- `reopen-reset.test.ts`: the `reopenWorkspaceState` mock (CH-3) resolves instead of returning `Effect.succeed`.
- `agents-auth-routing.test.ts`: dropped a stale `bridgeGeminiAuthToCliproxyProgram` mock entry; no such export exists.

No other hit: the remaining `Effect.*` mocks in test files target functions that are still Effects.

### CH-4 follow-up

The `cliproxy.ts` docs for `installCliproxy`, `stopCliproxy` and `restartCliproxy` get back the detail the deleted façade docs
carried (download + unpack from GitHub releases; best-effort SIGTERM via the pidfile; stop, wait 500ms, start).

## CH-6a: Live Shape B wrappers (#4012, part 1 of 2)

PRD W7. Every Shape B wrapper outside Oh My Pi (#4003) is deleted and its callers call the `Sync` function directly
(D3). The audit counted 34 of them as live, but its usage walk matches names, not imports: 31 had no production caller
at all. Their "callers" were same-named functions elsewhere (the eight private `isGitHubIssue` / `normalizeIssueId`
copies, the frontend `formatCost` / `saveSettings` / `parseContainerServiceName`, the `CostWriter` budget operations,
the context route's own `syncContextLayers`, `overdeck/health-events.ts`, `xbrief-index.ts`'s own `findXBriefByIssue`,
and so on). `tsc` on the root and dashboard projects after deleting all 34 reported only the sites below.

Ratchet: B 38 → 4 (the four left are Oh My Pi: `cost-parsers/ohmypi-parser.ts` 2, `runtimes/ohmypi-fifo.ts` 2). A and C are
unchanged (1 and 52); C is CH-6b's. Effect diagnostics: 254 → 250.

### Shape B wrappers (34) → the `Sync` function

| Module | Wrapper (deleted) | Survivor | Note |
| --- | --- | --- | --- |
| `activity-logger.ts` | `emitActivityEntry` | `emitActivityEntrySync` | no production caller |
| `agents/agent-state.ts` | `getAgentState` | `getAgentStateSync` | the one wrapper with real callers: 81 references in 38 files, rewritten per D3 (see below) |
| `backup.ts` | `createBackup` | `createBackupSync` | no production caller |
| `child-env.ts` | `buildChildEnv` | `buildChildEnvSync` | no production caller |
| `cloister/database.ts` | `getHealthHistory` | `getHealthHistorySync` | no production caller |
| `cloister/database.ts` | `writeHealthEvent` | `writeHealthEventSync` | no production caller |
| `config-migration.ts` | `hasLegacySettings` | `hasLegacySettingsSync` | no production caller |
| `config-migration.ts` | `needsMigration` | `needsMigrationSync` | no production caller |
| `config-yaml/load.ts` | `loadConfig` | `loadConfigSync` | no production caller |
| `config.ts` | `getDashboardApiUrl` | `getDashboardApiUrlSync` | no production caller |
| `context.ts` | `estimateTokens` | `estimateTokensSync` | no production caller |
| `cost.ts` | `checkBudget` | `checkBudgetSync` | no production caller |
| `cost.ts` | `createBudget` | `createBudgetSync` | no production caller |
| `cost.ts` | `deleteBudget` | `deleteBudgetSync` | no production caller |
| `cost.ts` | `formatCost` | `formatCostSync` | no production caller |
| `cost.ts` | `generateReport` | `generateReportSync` | no production caller |
| `costs/migration.ts` | `needsMigration` | `needsMigrationSync` | the `costs/` one was re-exported from `costs/index.ts` with no importer; the re-export is dropped |
| `costs/retention.ts` | `needsPruning` | `needsPruningSync` | re-exported from `costs/index.ts` with no importer; the re-export is dropped |
| `cv.ts` | `startWork` | `startWorkSync` | no production caller |
| `issue-id.ts` | `normalizeIssueId` | `normalizeIssueIdSync` | no production caller |
| `merge-set.ts` | `getMergeSet` | `getMergeSetSync` | no production caller |
| `model-fallback.ts` | `detectEnabledProviders` | `detectEnabledProvidersSync` | no production caller |
| `resource-utils.ts` | `parseContainerServiceName` | `parseContainerServiceNameSync` | no production caller |
| `resource-utils.ts` | `parseIssueIdFromText` | `parseIssueIdFromTextSync` | no production caller |
| `runtime/metrics.ts` | `getIssueTasks` | `getIssueTasksSync` | no production caller |
| `settings.ts` | `saveSettings` | `saveSettingsSync` | no production caller |
| `sync.ts` | `syncContextLayers` | `syncContextLayersSync` | no production caller |
| `tracker-utils.ts` | `isGitHubIssue` | `isGitHubIssueSync` | no production caller |
| `tracker-utils.ts` | `resolveGitHubIssue` | `resolveGitHubIssueSync` | no production caller |
| `tts-speak.ts` | `buildTtsSpeakPayload` | `buildTtsSpeakPayloadSync` | no production caller |
| `work-agent-lifecycle.ts` | `assertCanStartFresh` | `assertCanStartFreshSync` | no production caller |
| `workspace-manager.ts` | `preTrustDirectory` | `preTrustDirectorySync` | dead call removed, behaviour unchanged: three dynamic-import sites (`agents/spawn.ts` `spawnRun` and `spawnAgent`, `overdeck/conversation-runtime.ts` conversation spawn) cast it to `(dir) => void` and called it, which built an Effect and never ran it (dead since PAN-1379, 2026-05-22). The calls are deleted; workspace creation and project registration still pre-trust through `preTrustDirectorySync` |
| `workspace/ensure-devcontainer.ts` | `ensureDevcontainer` | `ensureDevcontainerSync` | no production caller |
| `xbrief/lifecycle-io.ts` | `findXBriefByIssue` | `findXBriefByIssueSync` | no production caller |

All paths are relative to `src/lib/`.

### `getAgentState` callers

- `await Effect.runPromise(getAgentState(id))` in an `async` function → `getAgentStateSync(id)`. A throw is still a
  rejection of that function.
- Promise-returning readers that were plain functions (`permissions.ts` `readAgentState` default, `pending-feedback.ts`
  `getAgentState` default, `memory/reconciliation.ts` `getAgentStateFromStore`) → `async` functions around the sync read,
  so a throw stays a rejection (D3).
- `yield* getAgentState(id)` in a route handler → `getAgentStateSync(id)` (D3).
- Kept typed: where a failure is recovered or the Effect declares `FsError`, the call is
  `yield* Effect.try({ try: () => getAgentStateSync(id), catch: (cause) => new FsError({ operation: 'read', path: `agents-db:${id}`, cause }) })`,
  the old wrapper's mapping: `routes/agents/spawn.ts` `resolveStartAgentGateForRoute` (its generator is piped into
  `Effect.catch`, which logs and falls back to the gate), the `agent-state.ts` Effect functions (`saveAgentState`'s
  old-state read, `setAgentPaused`, `clearAgentPaused`, `clearAgentTroubled`, `recordAgentFailure`), and
  `termination.ts` `stopAgent`. `routes/agents/permissions.ts` plan-action swallowed a failure to null with
  `.pipe(Effect.catch(() => null))`; it is now a plain `try`/`catch` around the sync read.
- Effect 4's `Effect.try` takes only the `{ try, catch }` options form: `Effect.try(() => x)` throws "options.catch is
  not a function" even on success. D3's single-argument form is therefore never used; every bridge is two-argument.

### Also deleted because only deleted code used them

| Name | Where |
| --- | --- |
| `CloisterDatabaseError` | `cloister/database.ts` |
| `MetricsParseError` | `runtime/metrics.ts` |
| `WorkAgentLifecycleViolation` | `work-agent-lifecycle.ts` |
| private `toSyncFsError` | `sync.ts` |
| private `toWmFsError` | `workspace-manager.ts` |
| `needsMigration`, `needsPruning` re-exports | `costs/index.ts` |

Empty `// ─── Effect variants (PAN-1249)` section headers are removed with their sections. Where a deleted wrapper's
doc said more than the survivor's, the detail moved to the `Sync` function (`createBackupSync`, `getMergeSetSync`,
`parseIssueIdFromTextSync`, `parseContainerServiceNameSync`, `buildTtsSpeakPayloadSync`, `assertCanStartFreshSync`,
`findXBriefByIssueSync`, `getAgentStateSync`).

### Behaviour notes for reviewers

- `preTrustDirectory`: the three dead calls are deleted rather than revived (operator decision on #4044).
  `preTrustDirectorySync` writes `~/.claude.json`, which every Claude Code session on the machine shares, without an
  atomic rename, so concurrent spawns could race on it. The calls have done nothing since PAN-1379, and workspace
  creation and project registration already pre-trust. Behaviour is unchanged.
- `getAgentState`: a route handler whose agent-state read throws (an existing `state.json` that cannot be read) now
  answers 500 with the underlying error message instead of "read failed for agents-db:<id>: <cause>". Parse
  errors and missing files never threw (they return null), so this is only an unreadable file.

### Tests

None are deleted, and the diff adds and removes no `it()`/`test()` calls. Mocks of `getAgentState` (Effect) became
mocks of `getAgentStateSync` returning plain values (`Effect.succeed(v)` → `v`, `Effect.fail(e)` → a throwing
implementation); where a factory mocked both names, the stale `getAgentState` entry is removed and the test's inputs
moved to the `Sync` entry (`postmerge-cleanup-async`, `cloister/__tests__/review-agent`). Where a `workspace-manager.js`
mock provided only `preTrustDirectory` for a deleted call (`agent-state-role`, `conversations-switch-model`,
`conversations-supervisor`), the factory is now empty so the module stays mocked out; where it also provided
`preTrustDirectorySync` (registration and creation tests), the stale key is dropped. Factory entries for the 31 wrappers that had no production caller are removed as
stale (26 files). `agents-barrel-exports.test.ts` drops `getAgentState` from the frozen list.

## CH-6b: Shape C twins and no blocking sync in server code (#4012, part 2 of 2)

PRD W8 and W11 part 3. Every Shape C pair outside Oh My Pi was re-decided with import-resolved call sites (the audit's
`--usage` walk matches names, so it counted, e.g., config.ts and config-yaml's `getConversationsConfigSync` together).
"Blocks on a child process" is transitive: a twin blocks when it calls `execSync`, `execFileSync`, `spawnSync` or
`tmuxExecSync`, or another twin that does (`listRunningAgentsSync` → `listSessionsSync`, `stopAgentSync` →
`capturePaneSync`/`killSessionSync`, `sessionExistsSync` → `querySessionSync`).

Ratchet: C 52 → 35 (34 pairs plus the Oh My Pi runtime row). A 1 and B 4 are Oh My Pi only (#4003). Effect diagnostics
unchanged at 250. `src/lib/tmux.ts` (1324) and `src/lib/projects.ts` (1253) gain audited file-size exceptions (PAN-4012)
for their sync-twin headers.

`agents/agent-state.ts` `clearAgentPausedSync` stays (C6 with a stated reason) after the merge of #4045: its
`onlyIf` compare-and-clear, used by `cloister/feedback-target.ts`, must read and write state.json with no await in
between, which the Effect variant (async mkdir and write) cannot promise. Its other callers (`pan start` ×2,
`pan unpause`) moved to the `clearAgentPaused` Effect in this PR, as the C4 rule has it; the compare-and-clear caller
keeps the sync twin.

A C5 row whose remaining Effect-variant caller is server-reachable keeps the async variant: server callers use the async
twin. So `cloister/config.ts` `loadCloisterConfig`/`saveCloisterConfig` (caller: `lifecycle/workflows.ts` close-out)
and `projects.ts` `resolveProjectFromIssue` (caller: `services/read-workspace-file.ts`; its loader exists so dashboard
resolves avoid sync syscalls, PAN-3330) stay as C6 rows instead of the PRD's C5.

### Deleted twins

| Module | Deleted | Survivor | Rule | Callers moved |
| --- | --- | --- | --- | --- |
| `agents/agent-state.ts` | `setAgentPausedSync` | `setAgentPaused` (Effect) | C4 | `cli/commands/pause.ts`, `cli/commands/workspace-migrate.ts`, `cloister/memory-governor.ts`, `cloister/service-crash.ts` (all async) |
| `agents/agent-state.ts` | `clearAgentTroubledSync` | `clearAgentTroubled` (Effect) | C4 | `cloister/feedback-target.ts` |
| `agents/activity.ts` | `getLatestSessionId` (Effect.sync) | `getLatestSessionIdSync` | C5 | `routes/agents/lifecycle-restart.ts` (generator), `work-agent-lifecycle.ts` |
| `cliproxy.ts` | `startCliproxySync` | `startCliproxy` | C4 | `cli/commands/dev.ts`, `cli/up-sidecars.ts`, `cli/commands/restart.ts` (injected) |
| `cliproxy.ts` | `stopCliproxySync` | `stopCliproxy` | C4 | `cli/commands/dev.ts`, `cli/index.ts`, `cli/commands/restart.ts` (injected) |
| `cliproxy.ts` | `isCliproxyRunningSync` | `isCliproxyRunning` | C4 | `cli/commands/system-health.ts`, `cli/index.ts`, `cli/commands/restart.ts` (injected) |
| `cliproxy.ts` | `installCliproxySync` | `installCliproxy` | C4 | `cli/commands/restart.ts` (injected); its other caller was `startCliproxySync` |
| `cliproxy.ts` | `bridgeCodexAuthToCliproxySync` | `bridgeCodexAuthToCliproxy` | C4 | `startCliproxy`, `openai-auth.ts` `getOpenAIAuthStatus` (both async) |
| `cliproxy.ts` | private `isCliproxyUpToDateSync` | private `isCliproxyUpToDateTask` | — | only the deleted sync twins used it |
| `openai-auth.ts` | `getOpenAIAuthStatusSync` (+ private `readCodexAuthSync`) | `getOpenAIAuthStatus` | C2 | no production caller |
| `cloister/handoff-logger.ts` | `readHandoffEvents` (Effect) + private `ensureLogDirAsync` | `readHandoffEventsSync` | C3 | no caller |
| `config.ts` | `getConversationsConfigSync`, `getConversationsConfig` | config-yaml's `getConversationsConfig` | C1 | neither had a production caller (every "caller" imported config-yaml's) |
| `config-yaml/load.ts` | `getConversationsConfigSync` | `getConversationsConfig` (Effect) | C4 | `cli/commands/conversations/{embed,scan}.ts`, `conversations/{embeddings,enrichment}/index.ts`, `conversations/search.ts` (all async) |
| `overdeck/control-settings.ts` | `isDeaconGloballyPausedSync` | `isDeaconGloballyPaused` | C5 alias | `routes/misc/deacon.ts`, `cloister/deacon-lite.ts`, `cloister/deacon-swarm.ts` |
| `overdeck/control-settings.ts` | `setDeaconGloballyPausedSync` | `setDeaconGloballyPaused` | C5 alias | `routes/misc/deacon.ts` |
| `overdeck/control-settings.ts` | `getFlywheelActiveRunId` | `getFlywheelActiveRunIdSync` | C5 alias | `cloister/uat-promote-notify.ts` |
| `projects.ts` | `renameProjectSync` | `renameProject` | C4 | `cli/commands/project.ts` |
| `xbrief/acceptance-criteria.ts` | `extractAcceptanceCriteriaSync` | `extractAcceptanceCriteria` (Effect) | C2 | no production caller; its tests now run the Effect variant (a CH-8 dead-export candidate) |

`agents.ts` and `xbrief/index.ts` drop the re-exports of the deleted names; `agents-barrel-exports.test.ts` drops them
from the frozen list.

### Kept twins (C6) and their header notes

Every module that still has a Shape C pair gets a `Sync twins (PAN-3958)` header naming each twin's synchronous callers
by `file:line` (by file when a twin has more than six sites; `node scripts/audit-effect-boundary.mjs --json --usage` has
the lines), and, for twins that block on a child process, a note that server code must not call them. Non-blocking
sync twins (file reads such as `loadConfigSync`, `getProjectSync`) keep their server callers: FR-8 covers only twins
that block on a child process. Modules:
`agents/agent-state.ts`, `agents/liveness.ts` (`isAliveSync`: header only, owned by PAN-3845, semantics unchanged),
`agents/queries.ts`, `agents/runtime-pid-probe.ts` (its only sync caller is `isAliveSync`, so it stays C6 rather
than the PRD's C4), `agents/runtime-state.ts`, `agents/termination.ts`, `cloister/config.ts`, `config.ts`, `prd-locations.ts`,
`projects-config-lock.ts`, `projects-config-write.ts`, `projects.ts`, `runtimes/muse-session.ts`, `tmux.ts`,
`ui-theme.ts`, `work-agent-lifecycle.ts`, `xbrief/io.ts`. `tmux.ts` `getAgentSessionsSync` stays C6: its Effect twin's
caller is a sync `overdeck/infra.ts` service slot and the sync twin blocks, so C5 does not apply.

### FR-8: no blocking `*Sync` in `src/dashboard/**` or `src/lib/cloister/**`

Converted to the async twin:

| Site | Was | Now |
| --- | --- | --- |
| `services/backend-inventory.ts` `probeTmuxPanes` | `listSessionsSync`, `listPaneValuesSync` | `listSessions` (Effect), `listPaneValues` |
| `services/cloister-control-surface.ts` `readDurableCloisterStatus` (now `async`) | `listRunningAgentsSync` | `listRunningAgents`; callers `routes/cloister.ts`, `routes/metrics.ts` (2), `overdeck/process-services.ts` await it |
| `cloister/service-status.ts` `getStatus`, `getAllAgentHealth` (now `async`, and so `CloisterService.getStatus()` / `getAllAgentHealth()`) | `listRunningAgentsSync` | `listRunningAgents`; `routes/cloister.ts` agents-health awaits it |
| `cloister/agent-death.ts` `describeAgentDeath` (now `async`; no production caller) | `sessionExistsSync`, `listPaneValuesSync` | `sessionExists`, `listPaneValues` |
| `cloister/confirmed-session-query.ts` `queryConfirmedSession` (now `async`; no production caller) | `querySessionSync` | `querySession` (Effect) — the held `querySession` row |
| `cloister/handoff.ts` | `stopAgentSync`, `sessionExistsSync` | `stopAgent`, `sessionExists` |
| `cloister/memory-governor.ts` `shed` | `listRunningAgentsSync`, `stopAgentSync` | `listRunningAgents`, `stopAgent` |
| `cloister/preemption.ts`, `cloister/service-health.ts` | `listRunningAgentsSync` | `listRunningAgents` |
| `cloister/strike-workspace-reaper.ts` | `sessionExistsSync` | `sessionExists` |
| `cloister/swarm-foreman.ts` | dependency `listSessionNamesSync` | dependency `listSessionNames` (Promise) |
| `cloister/stall-sweeper.ts` `runStallSweeperPatrol` | default `isAgentLive` = `sessionExistsSync` | default awaits `sessionExists`; the dependency may return a Promise |
| `cloister/concurrency.ts` `countRunningAgents` | `listRunningAgentsSync` | `listRunningAgents` |

Operator decision (#4048): the six remaining sync calls stay as they are. `cloister/concurrency.ts`
`describeRunningAgents`, `countRunningSwarmSlotsForIssue` and `countWarmIdleAdvancingAgents` (default parameters) and
`emergencyBrake` (`listRunningAgentsSync`, `stopAgentSync`), and `cloister/service.ts` `emergencyStop`
(`listRunningAgentsSync`). The emergency brake and stop stay synchronous on purpose; CH-8 handles the dead ones.

### Behaviour notes for reviewers

- `stopAgent` replaces `stopAgentSync` in `handoff.ts` and `memory-governor.ts`: it closes the agent through the
  selected terminal backend (Herdr or tmux) instead of only killing a tmux session, as `stopAgentSync`'s own doc asks
  of every caller that can await.
- Pause/unpause from `pan pause`, `pan unpause`, `pan start`, `workspace-migrate`, the memory governor, the crash
  escalation and feedback resurrection now save through `saveAgentState` (Effect), which also records the feature
  registry lifecycle row, as every other state write already does.
- The five conversations-config callers now read config without the deprecated-model migration (the Effect variant
  reads with `loadConfigNoMigration`); a failed read rejects with `ConfigError` carrying the same message.
- `pan project rename` goes through `renameProject`: an I/O failure's message gains the `FsError` prefix
  ("renameProject failed for <path>: …"); `ProjectRenameError` messages are unchanged.
- The CLI cliproxy start/stop/status paths use the async lifecycle: `stopCliproxy` waits 500 ms after SIGTERM before
  clearing the port, `startCliproxy` waits for the child's `spawn` event, and the Codex bridge resolves `false`
  instead of throwing when the credential write fails (its callers already treated it as best-effort).
- `routes/agents/lifecycle-restart.ts` restart-with-current-config (from CH-6a's `getAgentStateSync` rewrite): the
  read is inside the loop's JS `try`/`catch`, so an unreadable agent state now yields an `error` result for that
  agent instead of failing the whole batch with a 500.

### PRD D3 correction

In effect 4.0.0-beta.73 `Effect.try` accepts only `{ try, catch }`; `Effect.try(() => x)` throws "options.catch is not
a function" even on success. D3's `yield* Effect.try(() => fooSync(x)).pipe(…)` must read
`yield* Effect.try({ try: () => fooSync(x), catch: (cause) => cause }).pipe(…)`. Recorded here and in the PR body;
the PRD branch is not edited from this worktree.

### Tests

None are deleted, and the diff adds and removes no `it()`/`test()` calls. Tests of the deleted twins run the survivor
(`projects-rename` → `renameProject`, `acceptance-criteria` → `extractAcceptanceCriteria`, `activity-recovery` →
`getLatestSessionIdSync`). Mocks follow the new shapes: sync-to-Effect mocks return `Effect.succeed`, sync-to-Promise
mocks resolve, and factories that mocked both a deleted twin and its survivor keep only the survivor. Where a module
still calls both twins (`concurrency.ts`), tests mock both.

### #4048 review follow-ups

- `tmux.ts` `sessionQueryFailure` (now exported for its test) reads the exit code from `status` (execFileSync) or a
  numeric `code` (promisified `execFile`). The async `querySession` used to see `code: 1` with `status` unset and
  classified every missing session as a tmux error, so `queryConfirmedSession` reported "skipped — tmux query failed".
  `src/lib/__tests__/tmux-session-query-failure.test.ts` builds the errors from real child processes.
- `stopAgentSync`'s async callers now await `stopAgent`, which closes a Herdr pane as well as a tmux session:
  `cli/commands/start-fresh-session.ts` (`pan start --fresh`), `cli/commands/workspace-migrate.ts` (migrate to
  remote) and `health.ts` `handleStuckAgentPromise`. The first two were gated on the tmux-only `sessionExistsSync`,
  so on Herdr they skipped the stop and left the local pane and harness running (the #3966 symptom); they now gate on
  `terminal-backends/launch.ts` `agentPaneExists` plus a legacy tmux session. `pan start --fresh`'s "still alive"
  error no longer names tmux. `termination.ts`'s header now lists only `stopAgentSync`'s real sync callers
  (`cli/commands/swarm.ts` dependency slots and `concurrency.ts` `emergencyBrake`).
- `runtime.json`: `stopAgentSync`'s `saveAgentRuntimeState(id, { state: 'stopped' })` writes no file any more; it only
  emits the `activity: stopped` heartbeat, which `stopAgent` already emits (detached). The two paths match; no change.


## CH-7: one owner per harness for transcript/session/home paths (#4013)

PRD W9, D11, FR-9, W11 part 4. Every function that knows where a harness keeps its transcripts moves, body unchanged,
into `src/lib/runtimes/storage/<harness>.ts`, and every place that rebuilt one of those paths from a literal now asks
that module. The modules import only `node:*` and `src/lib/paths.ts`; there are no re-export shims, and
`scripts/lint-circular-deps.sh` reports no new cycle (64 baselined). `npm run lint:harness-storage` now fails on a
storage literal anywhere else in `src/`.

Behaviour is unchanged. `tests/unit/lib/agents/transcript-resolution-golden.test.ts` was committed first, against the
unmoved code, and passes unchanged at the end: for claude-code, codex, kimi-code, pi, acp (OpenCode) and muse it pins
(a) a `sessions.json` entry with a recorded absolute `path` resolving to that path, (b) a pre-PAN-3959 entry resolving
through the harness formula, the watch roots, and the conversation-side `resolveSessionFile`. The resolver's
`if (entry.path)` branch is untouched.

Ratchets: façades A 1, B 4, C 35 (unchanged; the muse C row follows the rename
`runtimes/muse-session.ts` → `runtimes/storage/muse.ts`). File-size caps lowered for `runtimes/codex.ts` (865 → 762),
`ws-rpc.ts` (both rows → 1214) and `launcher-generator.ts` (1032 → 1021).

### Moved exports (bodies and doc comments unchanged)

| Old home | Export | New home |
| --- | --- | --- |
| `paths.ts` | `encodeClaudeProjectDir`, `claudeProjectDir`, `sessionFilePath`, `claudeSessionTranscriptExists`, `sessionIdFromFile` | `runtimes/storage/claude-code.ts` |
| `runtimes/codex.ts` | `codexHome`, `extractThreadIdFromRollout`, `findLatestRollout` (+ private `readRolloutMetaLine`, `isSubagentRollout`) | `runtimes/storage/codex.ts` |
| `runtimes/codex.ts` | `findRolloutPath` (was a re-export) | `runtimes/storage/codex.ts` |
| `runtimes/codex-rollout-path.ts` (deleted) | `findRolloutPath`, `walkForThread`, the rollout path and miss caches | `runtimes/storage/codex.ts` |
| `agents/external-paths.ts` | `codexHomeDir` | `runtimes/storage/codex.ts` |
| `runtimes/kimi-code.ts` | `findKimiWirePath`, `findLatestKimiSession`, `kimiHomeDefault` (was private) | `runtimes/storage/kimi-code.ts` |
| `runtimes/kimi-context-envelope.ts` | `kimiWorkDirKey`, `kimiSessionsRoot`, `findKimiWirePathAsync`, `findLatestKimiSessionAsync` | `runtimes/storage/kimi-code.ts` |
| `runtimes/kimi-code.ts` | re-export of the four above | dropped (importers point at storage) |
| `runtimes/pi.ts` | `piSessionsRoot`, `findPiTranscriptPath` (+ private `NON_TRANSCRIPT_JSONL`) | `runtimes/storage/pi.ts` |
| `acp/transcript.ts` | `acpTranscriptPath` | `runtimes/storage/acp.ts` |
| `runtimes/acp.ts` | re-export of `acpTranscriptPath` | dropped |
| `runtimes/muse-session.ts` (renamed) | whole module | `runtimes/storage/muse.ts` |

All paths are relative to `src/lib/`. The "Async twin" doc comment sat on `kimiHomeDefault` in `runtimes/kimi-code.ts`,
left behind when the async pair moved to `kimi-context-envelope.ts`; it now sits on `findKimiWirePathAsync`, and
`kimiHomeDefault` gets a one-line doc of its own.

### New accessors (named forms of literals that were repeated)

| Module | Accessor | Replaces |
| --- | --- | --- |
| `storage/claude-code.ts` | `claudeProjectsRoot(home = homedir())` | `join(<home>, '.claude', 'projects')`; callers that read `process.env.HOME` first pass it, so the resolved home is unchanged |
| `storage/codex.ts` | `codexDefaultHome()` | `join(homedir(), '.codex')` where `$CODEX_HOME` was deliberately ignored (conversation discovery, and `initCodexHome`'s global home for the auth and rules symlinks) |
| `storage/codex.ts` | `codexSessionsRoot(home)` | `join(<codex home>, 'sessions')` |
| `storage/kimi-code.ts` | `kimiHomeDefault()` (now exported) | `join(homedir(), '.kimi-code')` |
| `storage/kimi-code.ts` | `kimiWirePath(home, workDir, sessionId)` | `join(kimiSessionsRoot(...), id, 'agents', 'main', 'wire.jsonl')` |
| `storage/kimi-code.ts` | `isKimiWirePath(path)` | `endsWith('/agents/main/wire.jsonl')` |
| `storage/pi.ts` | `piUserAgentDir()` | `join(homedir(), '.pi', 'agent')` (with `piSessionsRoot` for `…/sessions`) |
| `storage/codex.ts` | `codexAgentHome(agentDir)` | `join(<agentDir>, 'codex-home')` (#4049 review) |
| `storage/codex.ts` | `codexAgentSessionsDir(agentDir)` | `join(<agentDir>, 'codex-home', 'sessions')` (#4049 review) |
| `storage/acp.ts` | `ACP_TRANSCRIPT_FILE` | the `'acp-session.jsonl'` literal |
| `storage/muse.ts` | `isMuseSessionPath(path)` | the `/muse-data/muse/sessions/…/session.jsonl` test in `overdeck/conversation-reads.ts` |

`codexHome()` (`$CODEX_HOME ?? ~/.codex`) and `codexHomeDir()` (`$CODEX_HOME?.trim() || ~/.codex`) differ on an empty or
whitespace `CODEX_HOME`; both are kept as they were.

### Literal sites rewritten

Claude: `agent-enrichment.ts`, `agents/activity.ts` (private `claudeProjectDir` copy removed), `runtimes/claude-code.ts`,
`agents/external-paths.ts`, `agents/transcript-resolver.ts`, `conversations/transcript-path.ts`,
`conversations/harness-discovery.ts`, `overdeck/conversation-forks.ts`, `overdeck/claude-session-file-search.ts`,
`conversation-search/indexer.ts`, `dashboard/server/services/conversation-search-watcher.ts`,
`dashboard/server/services/conversation-lifecycle.ts`, `dashboard/server/services/conversation/session-files.ts`,
`dashboard/server/routes/agents/control.ts`, `costs/migration.ts`, `costs/reconciler.ts`,
`conversations/session-fork.ts`, `cost-parsers/jsonl-parser.ts`. Kimi: `runtimes/kimi-code.ts`, `agents/recovery.ts`,
`agents/transcript-resolver.ts`, `overdeck/conversation-runtime.ts`, `overdeck/conversation-reads.ts`. Codex:
`cli/commands/cost.ts`, `conversations/harness-discovery.ts`, `runtimes/codex.ts` (sessions dirs and the global home),
`agents/runtime-command.ts`,
`overdeck/conversation-runtime.ts`, `dashboard/server/services/codex-plugin-importer.ts`. Pi: `cli/commands/cost.ts`,
`conversations/harness-discovery.ts`, `overdeck/conversation-runtime.ts`, `memory/transcript-source.ts`. ACP:
`acp/host.ts`, `conversations/harness-discovery.ts`, `overdeck/conversation-reads.ts`. Muse:
`overdeck/conversation-reads.ts`.

### Left in place, with the reason

| Site | Why |
| --- | --- |
| `claude-settings-overlay.ts` `'Bash(rm …` rules | permission deny rules that protect transcripts from `rm`; allowlisted in the lint |
| `remote/remote-completion.ts` `fly.ssh(… 'ls /.claude/projects/…')` | a shell glob run on a remote Fly VM, not a local path; allowlisted |
| `harness-binary.ts` `join(home, '.kimi-code', 'bin')` | Kimi's binary install dir, not transcript storage; allowlisted |
| `cli/commands/conversations/index.ts` `.description`/`.option` text | CLI help text; allowlisted |
| `~/.codex/auth.json` (`codex-auth.ts`, `cliproxy.ts`, `openai-auth.ts`, `autopreso/agent.ts`), `~/.pi/agent/auth.json`, `~/.pi/agent/settings.json`, context-layer `AGENTS.md`, `paths.ts` `LEGACY_RUNTIME_DIRS`, `config-migration.ts` legacy dirs | auth and config, not transcript storage; out of scope |
| `runtimes/ohmypi.ts`, `ohmypi-models.ts`, the `.omp` discovery root | Oh My Pi is #4003 |
| `overdeck/conversation-reads.ts` `isCodexSessionFile`, `memory/reconciliation.ts`, `runtimes/codex-subagents.ts`, `runtimes/codex.ts` rollout recognizers | classify a path already in hand by its `codex-home/sessions` or `rollout-*.jsonl` shape; no storage literal the lint names |
| `palette.ts` project encoding | a different encoding scheme, not Claude's project dir |

OpenCode has no `opencode.db` code in this repo: it runs over ACP and its transcript is Overdeck's
`acp-session.jsonl`, owned by `storage/acp.ts`. There is no `storage/ohmypi.ts` (#4003).

### Tests

None are deleted. The golden test and `tests/unit/scripts/lint-harness-storage.test.ts` are new. Imports, `vi.mock`
factories, namespace spies (`vi.spyOn(claudeStorage, 'claudeSessionTranscriptExists')`) and dynamic imports in tests
follow the moved exports to their storage module; `registry-dispatch.test.ts` drops an `encodeClaudeProjectDir` entry
from its `paths.js` mock, which no longer exports it.

### #4049 review follow-ups

- **Allowlist rows are keyed on `file|anchor`, not `file:line`.** This deviates from the PRD's W9 checkpoint, which
  specified `file:line`. Line-number rows broke the lint for any edit above an allowlisted line (a one-line insertion
  in `claude-settings-overlay.ts` failed four rows). A row now allows any flagged line in its file whose text contains
  the anchor, a fixed substring. The stale-row check stays: a row whose anchor matches no flagged line in its file
  fails. `tests/unit/scripts/lint-harness-storage.test.ts` covers an edit above an allowlisted line, and a second
  literal in the same file that the anchor does not allow.
- **The per-agent Codex home has an owner.** `storage/codex.ts` gains `codexAgentHome(agentDir)` (`<agentDir>/codex-home`)
  and `codexAgentSessionsDir(agentDir)` (`<agentDir>/codex-home/sessions`). They replace the hand-built joins in
  `conversations/harness-discovery.ts`, `costs/codex-collector.ts`, `runtimes/codex.ts` (`initCodexHome`'s
  `codex-home-v2/sessions` symlink target and `CodexRuntimeSync.getSessionPath`), `agents/activity.ts`,
  `memory/transcript-source.ts`, and `context-layers/detach.ts` (its historical `codex-home/AGENTS.md` scan). The
  lint now flags a hand-built `, 'codex-home'` join argument. The recognizers that test a directory name with
  `startsWith('codex-home')` (`agents/state-dir-removal.ts`, `agents/transcript-resolver.ts`,
  `cloister/transcript-retention.ts`) and the `codex-home-v2` config-home joins are left as they are.
  `tests/unit/lib/agents/codex-agent-home-golden.test.ts` pins all six call paths; it was committed and passing
  before the helpers replaced the joins, and passes unchanged after.
- `docs/MUSE-HARNESS.md` names `src/lib/runtimes/storage/muse.ts`.

## CH-8a: dead exports, dead files, alias shims (#4014, part 1)

PRD W10 steps 1, 2, 5 and 6, and W11 part 5. `python3 .pan/notes/pan-3958-dead-exports.py v` on main at 08a1c998083
listed 161 `DEAD` exports (exported from `src/lib`, named in no other tracked file and never used in their own). All
161 are deleted (none is Oh My Pi code; the one Oh My Pi row the scan prints is `TESTONLY`). Deleting them left
private helpers unused, which are deleted too. The scan then finds 29 more `DEAD` exports that only the deleted code
used; they go the same way, repeated until the scan reports 0 `DEAD` rows. In total: 190 exports and 37 private
helpers in 89 modules. `tsc` on the root and dashboard projects is clean after every round.

`DEAD` rows have no test reference by construction (the scan's name index includes test files), so no test imports
or mocks a deleted name and no test changes for them.

Q1 is answered "internal": `src/index.ts` gains the header "Internal entry; not a supported library API". These
deleted names were reachable through its `export *` and are listed for the v0.61.0 release notes:
`findDevrootForProjectSync` (`config.ts`); `HANDOFFS_DIR`, `CACHE_SKILLS_DIR`, `DOCS_INDEX_FILE`,
`DOCS_BUDGET_STATE_FILE`, `DOCS_DISABLE_STATE_FILE`, `DOCS_TELEMETRY_FILE`, `resolvePiExtensionPath` (`paths.ts`);
`getDirectProviders` (`providers.ts`); `isOverdeckSymlinkSync` (`sync.ts`).

Ratchets: Effect diagnostics 250 → 231. Façades unchanged (A 1, B 4, C 35): none of the deleted `*Sync` functions still
had a twin. File-size caps lowered for `tmux.ts`, `model-capabilities.ts`, `overdeck/conversations.ts`,
`cloister/merge-agent.ts`, `projects.ts`, `sync.ts`, `agents/runtime-command.ts`, `agents/spawn-prep.ts`,
`cloister/review-agent.ts` and `overdeck/merge.ts`. Circular dependencies unchanged (64 baselined).

### Dead files (W10 step 6)

Every export of these files was `DEAD` after the rounds above and nothing imports them:

| File | Last caller removed by | THE-CUT.md |
| --- | --- | --- |
| `cloister/planning-wedge.ts` (PAN-3677 background-task wedge detector) | PAN-3917 W4, `deacon.ts` cut to deacon-lite | the "One of ~40 individual patrol routines inside `runPatrol`" rows: dropped, deacon-lite runs four fixed routines. Its two redacted fixtures, `tests/fixtures/pan-3677/`, had no test left and go with it |
| `flywheel-state-retention.ts` (compacting the stored Flywheel state log) | PAN-3917 W9, flywheel is a conversation | `flywheel-state` row: dropped (FR-13), no stored Flywheel run record |
| `state-migration-manifest.ts` | PAN-3917 W3, record plane deleted | state-layer rows: dropped |
| `cloister/uat-assemble-deps.ts` | PAN-1737 (long before the Cut) | not a Cut surface |
| `cost-parsers/session-map.ts` (`~/.overdeck/session-map.json` issue ↔ session map) | CH-1a deleted its last Shape B callers; the `*Sync` survivors had no caller | not a Cut surface |

None is named by THE-CUT.md as a feature's new home.

### Alias shims (W10 step 5)

- `routes/misc/shared.ts`, `routes/issues.ts`, `routes/workspaces.ts`, `routes/workspaces/merge-ops.ts`: import
  `resolveGitHubIssueSync` under its own name instead of `as resolveGitHubIssueShared`.
- `routes/misc/trackers.ts`: `getLinearApiKey`, `getGitHubConfig`, `getRallyConfig` under their own names (no local
  name collided). `routes/misc/meta.ts` imported `getGitHubConfig as getGitHubConfigShared` and never used it; the import
  is dropped.
- `cloister/feedback-writer.ts` `archiveFeedbackFiles` (a `@deprecated` alias of `clearFeedbackFiles`) is deleted;
  `review-agent.ts` calls `clearFeedbackFiles`. Its three test files mock and assert `clearFeedbackFiles` instead; one
  duplicate `not.toHaveBeenCalled()` line for the alias goes, no `it()` changes.
- Left alone: `dashboard/frontend/src/lib/store.ts` imports `syncSnapshot`/`applyEvent`/`applyEvents` as `…Shared`
  because it defines store actions with those names.

### Docs

`features/swarm.mdx` said `requiresSynthesis` is "auto-derived during planning by `deriveSynthesisMetadata()`", a
function with no caller. The row now says what the code does: `deacon-swarm.ts` treats an item with more than one
blocking parent as a synthesis item whether or not the field is set. Mentions of deleted names in `docs/prds/**` and
`docs/overdeck-remodel/**` are historical plans and are left as written.

### Deleted, by module

All paths are relative to `src/lib/`.

| Module | Dead exports deleted | Private helpers left unused, deleted with them |
| --- | --- | --- |
| `agent-runtime.ts` | `emitWaitingStart`, `emitWaitingClear`, `emitModelSet`, `emitMessageReceived`, `emitChannelReply`, `emitResolution`, `emitContextSaturationChanged` | — |
| `agents/agent-state-source.ts` | `readActiveReviewArtifactContext` | — |
| `agents/pinned-launch.ts` | `readPinnedAgentLaunchSync` | — |
| `agents/runtime-command.ts` | `getPiLauncherFields` | — |
| `agents/spawn-prep.ts` | `selectHardestPlanItem` | — |
| `agents/tier-escalation.ts` | `decideVerificationFailureEscalation` | — |
| `agents/tier-supervisor.ts` | `shouldHaltDispatch` | `dependencyClosure` |
| `artifacts/thumbnails.ts` | `readPlaceholderThumbnail`, `readThumbnailFile` | — |
| `boot-no-resume.ts` | `isExplicitNoResumeRequest` | — |
| `checkpoint/checkpoint-manager.ts` | `hasCheckpoint`, `diffCheckpointToHead`, `deleteAllCheckpoints`, `runCheckpointGit` | `checkpointSpawnerLayer`, `deleteAllCheckpointsPromise`, `diffCheckpointToHeadPromise`, `hasCheckpointPromise` |
| `claude-settings-overlay.ts` | `injectProviderEnvOverlay`, `removeProviderEnvOverlay` | `backupIfNeeded`, `findNewestBackup`, `BACKUP_PREFIX` |
| `cloister/config.ts` | `getCloisterConfigPath` | — |
| `cloister/confirmed-session-query.ts` | `consumeConfirmedSessionDetail` | — |
| `cloister/database.ts` | `writeHealthEventSync`, `getHealthHistorySync`, `getRecentHealthHistorySync`, `getAllHealthHistorySync`, `getLatestHealthEventSync`, `getAgentsWithHistorySync`, `deleteAgentHistorySync` | — |
| `cloister/deacon-swarm-record.ts` | `readSwarmSupersededAttempts` | — |
| `cloister/handoff-logger.ts` | `getHandoffStats` | — |
| `cloister/handoff.ts` | `shouldHandoff` | — |
| `cloister/idle-stack-reaper.ts` | `resetIdleStackGraceClock` | — |
| `cloister/label-reconciler.ts` | `reconcilePipelineLabelsPatrol`, `collectLabelReconcileCandidates` | `execAsync` |
| `cloister/memory-verdict-cache.ts` | `setCachedMemoryVerdictForTests` | — |
| `cloister/merge-agent.ts` | `logMergeHistory`, `captureTmuxOutput`, `isMergeAgentRunning`, `sendMessageToAgent` | `MERGE_HISTORY_FILE`, `MERGE_HISTORY_DIR`, `SPECIALISTS_DIR` |
| `cloister/planning-wedge.ts (file deleted)` | `readAgentBackgroundTaskWedgeEvidence`, `readBackgroundTaskWedgeEvidence`, `parseBackgroundTaskWedge` | `TERMINAL_TASK_STATUSES`, `isPromptBoundary`, `parseTaskNotification` |
| `cloister/reap-terminal-sessions.ts` | `isAdvancingLifecycleReclaimable` | — |
| `cloister/review-agent.ts` | `isReviewStaleSync` | — |
| `cloister/review-verdict-report.ts` | `findVerdictReportAsync` | — |
| `cloister/specialist-completion.ts` | `waitForSpecialistCompletion`, `cancelAllPendingCompletions` | — |
| `cloister/stall-sweeper-state.ts` | `clearSweeperRowState` | — |
| `cloister/stall-sweeper.ts` | `forgetResolvedSweeperRows` | — |
| `cloister/test-verdict.ts` | `resetUnsignaledTestEscalationsForTests`, `recordUnsignaledTestEscalation`, `resolveSlotFeedbackAgentId` | `escalatedTestGenerations` |
| `cloister/uat-assemble-deps.ts (file deleted)` | `buildUatAssembleSession` | `execAsync` |
| `cloister/verification-types.ts` | `INTERRUPTED_VERIFICATION_NOTE` | — |
| `config-migration.ts` | `getMigrationStatusSync` | — |
| `config.ts` | `findDevrootForProjectSync` | — |
| `context.ts` | `checkContextBudgetSync`, `createContextBudgetSync` | — |
| `conversations/hash-resolver.ts` | `resolveJsonl` | — |
| `cost-parsers/jsonl-parser.ts` | `getRecentSessionsSync`, `importSessionToCostLog`, `parseAllSessionsSync` | — |
| `cost-parsers/session-map.ts (file deleted)` | `linkSessionToIssueSync`, `completeSessionSync`, `getIssueSessionsSync`, `getIssueCostSummarySync`, `getAllIssuesWithCostsSync`, `findSessionByIdSync`, `updateSessionFromJSONLSync`, `loadSessionMapSync`, `saveSessionMapSync` | `recalculateIssueTotals`, `DEFAULT_DATA`, `SESSION_MAP_FILE` |
| `cost.ts` | `logUsageSync`, `updateBudgetSpentSync`, `logCostSync` | — |
| `db-provisioners/flyway-postgres.ts` | `getFlywayPostgresSnapshotHelp` | `getSnapshotHelp` |
| `dns.ts` | `restartDnsmasq` | — |
| `docker-stats.ts` | `getDockerNetworks`, `getDockerVolumes` | — |
| `env-loader.ts` | `hasEnvFile`, `getEnvFilePath` | — |
| `flywheel-state-retention.ts (file deleted)` | `compactFlywheelStateFile`, `compactFlywheelState`, `FLYWHEEL_STATE_VERBATIM_RUNS`, `shouldCompactFlywheelState`, `FLYWHEEL_STATE_MAX_BYTES`, `FLYWHEEL_STATE_MAX_LINES` | `buildCompactedLog`, `parseBlocks`, `readExistingSummaries`, `summarizeRun`, `normalizeOneLine`, `tickNumber`, `truncate` |
| `flywheel/substrate-stats.ts` | `clearSubstrateIssueCache` | — |
| `harness-policy.ts` | `ACP_KIMI_ONLY_BLOCK_REASON`, `KIMI_CODE_KIMI_ONLY_BLOCK_REASON`, `KIMI_NATIVE_ID_FOREIGN_HARNESS_BLOCK_REASON` | — |
| `health.ts` | `sendHealthNudge`, `getAgentOutput` | — |
| `hooks.ts` | `collectMailSync` | — |
| `lifecycle/auto-close-out-canonical-state.ts` | `sweepAutoCloseOutCache` | — |
| `linear-mcp-auth.ts` | `appendLinearMcpAuthRequiredEvent` | — |
| `memory/poller.ts` | `getTranscriptPoller`, `unregisterTranscriptForPolling` | — |
| `memory/query-expansion.ts` | `getCachedMemoryQueryExpansion` | — |
| `memory/worker-pool.ts` | `getMemoryExtractionWorkerPool`, `getMemoryPipelineWorkerPool`, `enqueueMemoryExtractionJob`, `enqueueReconciledMemoryExtractionJobs` | `defaultMemoryExtractionWorkerPool` |
| `merge-set.ts` | `getAllMergeSetsSync` | — |
| `model-capabilities.ts` | `getModelsBySkillSync`, `getModelsForProviderSync`, `getCheapestModelsSync`, `getValueScoreSync`, `getAllSkillDimensionsSync` | — |
| `overdeck/claude-session-file-search.ts` | `findSubagentTranscriptById` | — |
| `overdeck/control-settings.ts` | `SettingsApi`, `setBootReconciliationDecision`, `setBootReconciliationGrace`, `setFlywheelActiveRunId`, `ConfigApi`, `FLYWHEEL_ACTIVE_RUN_ID_KEY` | — |
| `overdeck/conversations.ts` | `listArchivedConversationNames`, `markAllEndedOnStartup`, `clearStuckForks`, `setImportedConversationLinks` | — |
| `overdeck/cost-sync.ts` | `getCostBreakdownByStageAndModelSync` | — |
| `overdeck/issues.ts` | `IssueWriterLive`, `IssuesApi` | — |
| `overdeck/merge.ts` | `QueueEntryStatus` | — |
| `overdeck/observability.ts` | `ObservabilityRpcLive` | — |
| `overdeck/process-services.ts` | `EmptyProcessServicesLive`, `ProcessServicesLive`, `emptyConversationRuntimeLive`, `DeliveryServiceLive`, `makeConversationRuntimeLive`, `CloisterRuntimeLive` | `defaultPokeMessage` |
| `overdeck/release-sync.ts` | `getAllReleaseSetsFromDb` | — |
| `pan-dir/context.ts` | `workspaceContextTmpPath` | — |
| `paths.ts` | `HANDOFFS_DIR`, `CACHE_SKILLS_DIR`, `DOCS_INDEX_FILE`, `DOCS_BUDGET_STATE_FILE`, `DOCS_DISABLE_STATE_FILE`, `DOCS_TELEMETRY_FILE`, `resolvePiExtensionPath` | — |
| `platform-lifecycle.ts` | `describeStageFailure` | — |
| `prereqs/registry.ts` | `getMissingToolsForFeature` | — |
| `projects.ts` | `createDefaultProjectsConfig`, `getSpecialistPromptOverride` | — |
| `providers.ts` | `getDirectProviders` | — |
| `release-set.ts` | `getAllReleaseSetsSync` | — |
| `remote/index.ts` | `getRemoteProvider` | — |
| `runtime-census.ts` | `resetRuntimeCensusForTests` | — |
| `runtime/index.ts` | `createRuntimeRegistry`, `isRuntimeInstalled`, `registryGetAvailable`, `registrySyncToAll`, `getRuntimeAdapter` | — |
| `runtime/interface.ts` | `DEFAULT_FEATURES` | — |
| `runtime/metrics.ts` | `recordTaskSync`, `getRuntimeMetricsSync`, `getAllRuntimeMetricsSync`, `getAggregatedMetricsSync`, `getIssueTasksSync`, `getRecentTasksSync`, `clearMetricsSync`, `loadMetricsSync`, `saveMetricsSync` | `rebuildRuntimeMetrics`, `DEFAULT_METRICS`, `METRICS_FILE` |
| `runtimes/storage/claude-code.ts` | `sessionIdFromFile` | — |
| `shadow-utils.ts` | `formatState` | — |
| `smart-model-selector.ts` | `getSimpleModelMappingSync` | — |
| `state-migration-manifest.ts (file deleted)` | `verifyStateMigrationManifest`, `manifestEntry` | — |
| `sync.ts` | `isOverdeckSymlinkSync` | — |
| `systemd.ts` | `uninstallSupervisorUnit` | — |
| `terminal-backends/herdr-api.ts` | `setHerdrApiClient` | — |
| `tldr-daemon.ts` | `removeTldrDaemonServiceSync` | — |
| `tmux.ts` | `confirmDelivery`, `getReviewSessions` | — |
| `workspace-config.ts` | `getServiceFromTemplateSync`, `SERVICE_TEMPLATES` | — |
| `xbrief/dag.ts` | `blockingParentTotal`, `deriveSynthesisMetadata`, `isTaskCommand`, `applyTaskOperation`, `activePlanWriters`, `verifyActiveSlicePromptReduction`, `isTaskOperationType`, `activeSlicePromptSize` | `TASK_COMMANDS`, `cloneDoc`, `statusForOperation`, `TASK_OPERATION_TYPES` |
| `xbrief/io.ts` | `readTierRetries`, `recordTierRetry` | — |
| `xbrief/lifecycle-io.ts` | `writeContinueStateForIssue` | — |
| `xbrief/lifecycle.ts` | `resolveXBriefRoot` | — |

## CH-8a part 2: test-only exports, the collected candidates, and #4050 follow-ups (#4014)

PRD W10 step 3 (`TESTONLY` rows), step 6 (dead files), and the candidates collected across the epic.
`python3 .pan/notes/pan-3958-dead-exports.py v` on main at ba8dd403767 listed 214 `TESTONLY` exports (named only by
tests outside their own file). Each was decided one of four ways.

- **Deleted with their tests** (subject is dead in production): the export goes, and every `it`/`test` that exercised
  it goes with it. A `describe` left empty goes too, and a test file left with no tests is deleted.
- **Moved into the test that uses it**: 22 thin wrappers whose callees are live. The wrapper leaves `src` and
  becomes a local function in its test file, doc comment and body unchanged, so the tests keep exercising the live
  code underneath. They are listed as "moved to its test" below. `deterministicDocsTestEmbedding` moved to
  `tests/helpers/docs-test-embedding.ts` because four test files share it.
- **Ported**: tests of live code that used a deleted export only for setup or observation now go through the live
  code. `prompts.test.ts` exercises frontmatter parsing through `renderPrompt` instead of the test-only
  `loadPromptFrontmatter`. `agent-gc.test.ts` calls `resolveLiveAgentTerminalityEvidence` instead of
  `confirmLiveAgentTerminality`. `flywheel-merge-order.test.ts` checks the advisory-only property on
  `orderMergeCandidates` and builds declared footprints inline. `message-agent-interventions.test.ts` drops the
  `isMonitorLive` setup, which `messageAgent` no longer consults. `pan-3859-no-loss-audit.test.ts` keeps its defaults
  assertion and drops the one on `validateSettingsSync`. `settings-api.test.ts` sets the `readFile` mock that the
  deleted `getRoleConfig` test used to leave behind. `memory/paths.test.ts` asserts that no caller of the deleted
  `resolveIssueMemoryRoot` is left.
- **Kept as test seams**: PRD W10 step 3 keeps names matching `ForTest(s|ing)?$`, names starting with `_`, and
  documented `reset…`/`set…` hooks. This PR also keeps test-only helpers that tests of live code need to set up or
  observe module-private state, where moving them would mean exporting that state. Each carries the doc line "Test
  seam: no production caller; tests use it to set up or observe module state (PAN-3958 CH-8)".
  - Documented `reset`/`set`/`clear` hooks: `resetDeliveryBackendSelection`, `resetSystemCapabilitiesCache`,
    `clearMemorySettingsCache`, `resetDiscoveredSessionsSchemaBootstrap`, `resetTitleRefinementState`,
    `setCloisterService`, `setGlobalRegistry`, `resetPromptGuard`, `resetHostTerminalBackendName`,
    `clearParentBranchCache`, `resetCostTrackingSync`.
  - Given the seam doc line in this PR: `closeOverdeckDatabaseSync`, `resetXBriefIndex`,
    `clearAutonomousWorkDispatchCaches`, `setStatusRollupEnqueuer`, `setStatusRollupProcessor`,
    `resetPatrolDispatchBudget`, `invalidateProbeCacheSync`, `isHygieneSchedulerRunning`, `getInFlightForkPipelineCount`,
    `createRunLogSync`, `appendToRunLogSync`, `logSpecialistHandoff`, `createSpecialistHandoff`, `recordCostSync`,
    `getAgentCost`, `getIssueCost`, `getDailyTotal`, `readSessionBriefingMarker`, `getWorkspaceByName`, `createPiFifo`,
    `destroyPiFifoSync`, and `ensureOrderIssueStore`. That last one is the only way the orders tests load the mocked
    issue-service module into the resolver's cache, which the resolver's `require()` path cannot reach.

After each deletion round the scan runs again, and anything left dead or test-only only because deleted code used
it goes the same way. That repeats until the scan reports 0 `DEAD` rows and no non-seam `TESTONLY` rows.

Two exports looked live to the scan only because a production comment named them: `tryReserveAdvancingSlot` (named
in `memory-verdict-cache.ts`'s header) and `checkPostReviewCommits` (named in `concurrency.ts`'s reservation
comment). Both had no production caller since the PAN-3917 cut and are deleted, with the comments updated.

### Collected candidates

| Candidate | Verdict on main | What this PR does |
| --- | --- | --- |
| `salvageStrandedMerge` | no caller (only a PRD plan names it) | deleted |
| `stopSmeeClient` | test teardown only | deleted with the whole in-process smee mode (`startSmeeClient`, `isSmeeRunningSync`, the restart loop): the dashboard runs smee as a detached process (`startSmeeProcessSync`), and the in-process mode had no production caller. `tests/unit/lib/smee.test.ts` tested only that mode and goes with it |
| `describeAgentDeath` | test-only | deleted; `cloister/agent-death.ts` is left empty and deleted |
| `queryConfirmedSession` | test-only | deleted; `cloister/confirmed-session-query.ts` deleted |
| `describeRunningAgents` | test-only | deleted |
| `getShadowModeSummary`, `updateTrackerStatusCache`, `markAsSynced`, `getDisplayStatus` | test-only | deleted |
| `ensureManagedTmuxContextOnce` | only named in comments (`main.ts`, `tmux.ts`) | deleted; both comments updated |
| `extractAcceptanceCriteria` (`xbrief/acceptance-criteria.ts`) | test-only (`tier-supervisor.ts` has a separate, live function of the same name) | moved into `acceptance-criteria.test.ts` |
| `getConversationsConfig` (`config.ts`) | already gone | nothing to do |
| `CloisterService.getStatus()` | no production caller: every other `getStatus()` call site is the TLDR daemon service, and `/api/cloister/status` reads `readDurableCloisterStatus()` | deleted, with `service-status.ts` `getStatus` and the 3-second status cache it fed. Its three tests go, and so do three tests in the already-skipped (PAN-48) `reloadConfig`/`updateConfig` blocks that read config through it |
| stall-sweeper default `isAgentLive` | `runStallSweeperPatrol` has no production caller (PAN-3917 W5 removed it); every test passes `isAgentLive` | default removed; the dependency is required. Its tmux-only default was wrong on Herdr hosts anyway |
| `runPromiseOrProgram` (`tts-speak.ts`, `cli/commands/tts.ts`) | every value is a Promise since CH-4 | removed; defaults return the call, call sites await it; tests unchanged (their injected deps already resolved Promises) |
| `acp.test.ts` / `kimi-code.test.ts` `sessionExists` mocks | the mocked function is `tmux-cli.ts`'s `tmuxSessionExists`, which returns a Promise, so `mockResolvedValue` was right | mock keys renamed to `tmuxCreateSession`/`tmuxKillSession`/`tmuxSessionExists` so the shape is plain; 35 tests pass before and after |
| the 37 `…Sync` functions CH-1a orphaned | deleted by #4050 and this PR where dead or test-only | the survivors with no async twin are listed below for #4002 |
| `codex-home-v2` helper (optional) | — | not done; see "Left undone" |

### #4050 review follow-ups

- `src/index.ts` header names its one in-repo consumer: `scripts/build-docs-index.mjs` (via `build-post-cli.mjs`)
  loads `dist/index.js` for `buildDocsIndex`, `DEFAULT_DOCS_INDEX_PATH`, `DEFAULT_DOCS_INDEX_MAX_BYTES` and
  `getDocsIndexPath`; those four stay exported.
- `reference/architecture.mdx` drops `session-map.json` and `runtime-metrics.json` from the state-directory listing
  and describes the Metrics page as it is (today's cost and top spenders from `/api/metrics/summary` and
  `/api/metrics/costs`). The `runtime-metrics.json` reader in `routes/misc/meta.ts` serves `GET /api/metrics/runtimes`
  and `GET /api/metrics/tasks`; nothing writes the file and no mounted UI calls the routes (the `RuntimeComparison`
  component that did is not rendered). PRD NFR-2 forbids HTTP route changes in this epic, so the reader stays.
- Orphans #4050 left: unused imports and the empty section/`CheckpointGitResult` in `checkpoint/checkpoint-manager.ts`,
  the `Effect` import and empty trailer in `conversations/hash-resolver.ts`, the empty "HTTP API groups" header in
  `overdeck/control-settings.ts`, `OverlayResult` in `claude-settings-overlay.ts` and `MergeHistoryEntry` in
  `cloister/merge-agent.ts`. `src/lib/runtime/` (`index.ts`, `claude.ts`, `interface.ts`, `metrics.ts`) had no importer
  once #4050 emptied `index.ts`, so the directory is deleted, with its `eslint-any-allowlist.json` row.

### Removed from the `@overdeck/core` main entry (v0.61.0 release notes)

`loadDocsCorpus` (`docs/corpus.ts`), `deterministicDocsTestEmbedding` (`docs/index-builder.ts`; now
`tests/helpers/docs-test-embedding.ts`), `LEGACY_RUNTIME_DIRS`, `piExtensionCandidates`, `getDocsDir` (`paths.ts`),
`saveSettingsSync`, `validateSettingsSync` (`settings.ts`).

### Tests

The diff removes 443 `it`/`test` calls (1,308 → 865 in the touched files) and adds one (the ported
`resolveIssueMemoryRoot` check). Every removed test exercised a deleted subject. The ports above keep the tests of
live code. Whole test files deleted with a deleted module are exempt from the test-skip gate; the rest need
`pan verify waive-test-removal 4014 --reason "PAN-3958 deleted subject, see no-loss ledger"` at the pushed HEAD.

Test files deleted:

- `src/lib/__tests__/pinned-launch.test.ts`
- `src/lib/agents/__tests__/fast-track.test.ts`
- `src/lib/agents/__tests__/supervisor-liveness.test.ts`
- `src/lib/cloister/__tests__/agent-death.test.ts`
- `src/lib/cloister/__tests__/confirmed-session-query.test.ts`
- `src/lib/cloister/__tests__/database.test.ts`
- `src/lib/cloister/__tests__/pan-2341-idle-terminal-reaper.test.ts`
- `src/lib/cloister/__tests__/pan-2341-merged-advancing-reaper.test.ts`
- `src/lib/cloister/__tests__/parked-residue.test.ts`
- `src/lib/cloister/__tests__/post-review-commits.test.ts`
- `src/lib/cloister/__tests__/reap-terminal-sessions.test.ts`
- `src/lib/cloister/__tests__/recover-orphaned-agents-grace.test.ts`
- `src/lib/cloister/__tests__/review-convoy-liveness.test.ts`
- `src/lib/cloister/__tests__/uat-promote-notify.test.ts`
- `src/lib/conversations/__tests__/switch-strategy.test.ts`
- `src/lib/overdeck/__tests__/affected-criteria.test.ts`
- `tests/lib/compliance/triggers.test.ts`
- `tests/lib/hooks.test.ts`
- `tests/lib/remote/remote-completion.test.ts`
- `tests/lib/router-config.test.ts`
- `tests/lib/tmux-detect-terminal-api-error.test.ts`
- `tests/unit/lib/cloister/label-reconciler.test.ts`
- `tests/unit/lib/cloister/merge-agent-quality-gates.test.ts`
- `tests/unit/lib/cloister/resource-pressure-patrol.test.ts`
- `tests/unit/lib/cloister/scan-git-patterns.test.ts`
- `tests/unit/lib/cloister/stale-check-classifier.test.ts`
- `tests/unit/lib/cloister/stale-check-github.test.ts`
- `tests/unit/lib/cloister/uat-assemble.test.ts`
- `tests/unit/lib/github-graphql-cooldown.test.ts`
- `tests/unit/lib/overdeck/merge-queue.test.ts`
- `tests/unit/lib/overdeck/process-services.test.ts`
- `tests/unit/lib/smee.test.ts`
- `tests/unit/lib/state-migration-lock.test.ts`

### Findings for follow-up (no code change here)

- `cloister/stall-sweeper.ts`: `runStallSweeperPatrol` lost its production caller in PAN-3917 W5. Only its tests and
  the `patrolBudgets.exempt` name list in `cloister/config.ts` mention it.
- Writers with no production caller, whose live readers now read nothing: Cloister's `cost-data.json`
  (`cloister/cost-monitor.ts` `recordCostSync` feeds `getCostSummary`, which `/api/metrics/*` serves; the
  `cost_events` table is a different store and has live writers), specialist run logs (`createRunLogSync`), and
  specialist handoffs (`logSpecialistHandoff`). They are kept as test seams because tests of the live readers use
  them; the coordinator is filing the gaps separately.
- `GET /api/metrics/runtimes` and `/api/metrics/tasks` read a file nothing writes (see above).

### Left undone

- The optional `codex-home-v2` helper: `spawn.ts`, `runtime-command.ts`, `conversation-runtime.ts`, `runtimes/codex.ts`
  and `companion-terminal/codex-adapter.ts` still build `<agentDir>/codex-home-v2` by hand. It was optional and this PR
  is already large.

### Deleted, by module

All paths are relative to `src/lib/`.

| Module | Test-only or dead exports deleted | Private code left unused, deleted with them |
| --- | --- | --- |
| `acp/host.ts` | `readPersistedAcpSessionId` (moved to its test) | — |
| `acp/runtime-model.ts` | `parsePermissionRequest` | — |
| `agent-directory-cleanup.ts` | `getPlanningIssueId` | — |
| `agents/dispatch-tier.ts` | `chooseTierAssignment` (moved to its test) | — |
| `agents/fast-track.ts (file deleted)` | `escalateFastTrackItem`, `groupFastTrack`, `autoMergeFastTrackBatch`, `DEFAULT_FAST_TRACK_MAX_SCOPE_FILES`, `FAST_TRACK_GATE_COMMANDS`, `isFastTrackAutoMergeAllowed` | `batchKey`, `isFastTrackEligible`, `FAST_TRACK_DIFFICULTIES` |
| `agents/monitor-transport.ts` | `isMonitorLive`, `MONITOR_PRESENCE_FRESHNESS_MS` | `isPidAlive` |
| `agents/pinned-launch.ts (file deleted)` | `parsePinnedAgentLaunch` | `parseFlagValue` |
| `agents/runtime-command.ts` | `hasAgentRuntimeInSubtree` (moved to its test) | — |
| `agents/spawn-prep.ts` | `applyTierAssignment` | — |
| `agents/supervisor-liveness.ts (file deleted)` | `supervisorProcessAliveSync` | `defaultPgrep`, `Pgrep` |
| `agents/tier-metrics.ts` | `readTierFeedDeliveries` (moved to its test), `computeWarmHitFractions`, `WARM_HIT_GAP_SECONDS` | — |
| `artifacts/index-store.ts` | `createArtifactIndexRepository` (moved to its test) | — |
| `backlog/backlog-auto-trigger.ts` | `startPeriodicReviewPass`, `stopPeriodicReviewPass` | `_reviewTimer` |
| `backlog/pickup.ts` | `selectUnblockTargets`, `isUnblockEligible` | — |
| `boot-no-resume.ts` | `getNoResumeMode` | `noResumeModeSince` |
| `cliproxy.ts` | `netstatShowsListener` | — |
| `cloister/agent-death.ts (file deleted)` | `describeAgentDeath`, `readAgentExitStatus` | `agentDir` |
| `cloister/agent-gc.ts` | `confirmLiveAgentTerminality` | — |
| `cloister/agent-grace.ts (file deleted)` | `isStartingWithinGrace`, `WORK_LAUNCHER_GRACE_MS` | — |
| `cloister/complexity.ts` | `detectComplexity` | `detectComplexityFromEstimate`, `detectComplexityFromFileCount`, `detectComplexityFromKeywords`, `detectComplexityFromLabels`, `getHigherComplexity`, `COMPLEXITY_KEYWORDS`, `COMPLEXITY_LABELS`, `FILE_COUNT_THRESHOLDS` |
| `cloister/concurrency.ts` | `describeRunningAgents`, `releaseAdvancingSlot`, `tryReserveAdvancingSlot` | `advancingReservedThisPatrol` |
| `cloister/confirmed-session-query.ts (file deleted)` | `queryConfirmedSession`, `clearConfirmedSessionMiss` | `consecutiveMisses` |
| `cloister/database.ts` | `writeHealthEventsSync`, `getDatabaseStatsSync`, `closeHealthDatabase` | — |
| `cloister/deacon-post-review-commits.ts (file deleted)` | `checkPostReviewCommits`, `evaluateReviewFreshness` | — |
| `cloister/deacon-swarm-record.ts` | `persistAndVerifySwarmSlotCompletion` | — |
| `cloister/flywheel.ts` | `FLYWHEEL_ORCHESTRATOR_AGENT_ID` | — |
| `cloister/handoff-logger.ts` | `readHandoffEventsSync` | — |
| `cloister/health.ts` | `getMultipleAgentHealth`, `getAgentsToPoke`, `getAgentsToKill`, `getHealthEmoji`, `getHealthLabel`, `shouldPoke`, `shouldKill` | — |
| `cloister/label-reconciler.ts` | `reconcilePipelineLabels`, `planLabelReconciliation` | — |
| `cloister/memory-governor.ts` | `canAdmit` (moved to its test) | — |
| `cloister/merge-agent.ts` | `scanGitPatterns`, `scanForConflictMarkers`, `runProjectQualityGates`, `salvageStrandedMerge`, `GIT_PATTERNS` | — |
| `cloister/merge-completeness.ts` | `reconcileStrandedRepos` | — |
| `cloister/modal-detector.ts` | `paneShowsModelSwitch`, `handleKnownAgentModal`, `KNOWN_AGENT_MODALS` | `MODEL_SHAPED_TOKEN`, `defaultDeps` |
| `cloister/parked-residue.ts (file deleted)` | `reconcileTerminalIssueResidue`, `isIssueTerminal` | `defaultDeps`, `resolveClearGates`, `defaultListTerminalIssues` |
| `cloister/pr-facts.ts` | `isAwaitingReview`, `getLatestPrReview` | `defaultRunGh` |
| `cloister/preemption.ts` | `tryYieldForAdvancingDispatch`, `resumeYieldedVictim`, `yieldWorkAgentFor` | `buildCandidates`, `countYielded`, `reviewBlockedFor` |
| `cloister/prompts.ts` | `loadPromptFrontmatter` | — |
| `cloister/reap-terminal-sessions.ts` | `selectMergedWorkSessions`, `selectMergedAdvancingSessions`, `selectNonMergedTerminalAdvancingSessions`, `isIdlePastThreshold`, `selectAwaitingTestWorkSessions`, `classifyAdvancingSessionLifecycle`, `selectTerminalAdvancingSessions`, `isAwaitingTestReapable`, `sessionsToReapForRole`, `isWorkReapable` | — |
| `cloister/resource-pressure-patrol.ts (file deleted)` | `patrolResourcePressure` | `ResourcePressurePatrolDeps` |
| `cloister/review-convoy-liveness.ts (file deleted)` | `evaluateReviewConvoyLiveness`, `REVIEW_AGENT_IDLE_THRESHOLD_MS`, `REVIEWING_WATCHDOG_THRESHOLD_MS`, `reviewTimestampMs` | `ReviewAgentRow` |
| `cloister/review-verdict-report.ts` | `parseVerdictReport` | — |
| `cloister/specialist-context.ts` | `hasContextDigest`, `deleteContextDigest` | — |
| `cloister/specialist-handoff-logger.ts` | `readIssueSpecialistHandoffs` (moved to its test), `getTodaySpecialistHandoffs` (moved to its test) | — |
| `cloister/specialist-logs.ts` | `checkLogSizeLimit`, `getRunLogSize`, `MAX_LOG_SIZE` | — |
| `cloister/stale-check-classifier.ts (file deleted)` | `selectRerunCandidates`, `computeRedWindows` | `isCompleted`, `isFailing` |
| `cloister/stale-check-github.ts (file deleted)` | `listRecentMainRuns`, `listPrHeadFailingRuns`, `getPrHead`, `rerunFailedRun`, `probePrHeadFailingRuns`, `probeRecentMainRuns` | `RUN_FIELDS`, `execGh` |
| `cloister/swarm-failed-slot.ts` | `SWARM_SUPERSEDED_RETENTION`, `nextSwarmSlotIndex` | — |
| `cloister/swarm-slot-reconcile.ts` | `listSlotOwnership` | — |
| `cloister/test-verdict.ts` | `decideUnsignaledTestAction` | — |
| `cloister/uat-assemble.ts (file deleted)` | `assembleUatCandidate` | — |
| `cloister/uat-promote-notify.ts (file deleted)` | `notifyFlywheelOfUatPromote` | `buildPromoteNudge` |
| `codex-auth.ts` | `paneShowsCodexAuthBurn`, `isCodexAuthRouted`, `applyCodexAuthBurnFlag` (moved to its test) | `CODEX_AUTH_BURN_MARKERS` |
| `compliance/triggers.ts` | `matchMemoryFirstTriggerPhrases`, `matchMemoryFirstTriggers`, `MEMORY_FIRST_TRIGGERS` | — |
| `config-yaml/domain-mergers.ts` | `mergeRtkConfigs`, `mergeDocsConfigs` (moved to its test), `getDefaultRtkConfig` | — |
| `conversation-search/chunker.ts` | `chunkConversationJsonlFile` (moved to its test) | — |
| `conversations/switch-strategy.ts (file deleted)` | `getEffectiveTargetWindow`, `decideSwitchStrategy`, `SWITCH_MODEL_SAFETY_FACTOR` | `EXTENDED_CONTEXT_WINDOW_FLOOR` |
| `docs/corpus.ts` | `loadDocsCorpus` | — |
| `docs/index-builder.ts` | `deterministicDocsTestEmbedding` | — |
| `flywheel-merge-order.ts` | `planMergeTrain`, `declaredIssueFootprint` (moved to its test), `planUatCandidate` | — |
| `github-graphql-cooldown.ts (file deleted)` | `noteGraphQLRateLimit`, `isInGraphQLCooldown` | `GRAPHQL_COOLDOWN_MS`, `cooldownStartedAt`, `isGraphQLRateLimitError`, `messageFromError` |
| `harness-skill-sync.ts` | `SKILL_SYNC_HARNESSES` (moved to its test) | — |
| `herdr-setup/config.ts` | `setResumeAgentsOnRestore` (moved to its test) | — |
| `hooks.ts` | `reorderHookItemsSync` | — |
| `issue-id.ts` | `extractStandardPrefixSync`, `extractStandardNumberSync` | — |
| `lifecycle/archive-planning.ts` | `inferBranchFromWorkspace` | — |
| `memory/paths.ts` | `resolveIssueMemoryRoot`, `resolveCheckpointFile` | — |
| `memory/worker-pool.ts` | `MemoryExtractionWorkerPool` | `QueuedMemoryExtractionJob` |
| `merge-set.ts` | `deleteMergeSetSync`, `patchMergeSetRepoSync`, `patchMergeSetReposSync` | — |
| `model-capabilities.ts` | `modelSupportsEffortSync` (moved to its test) | — |
| `model-fallback.ts` | `requiresExternalKeySync` (moved to its test), `detectEnabledProvidersSync`, `filterAvailableModelsSync` (moved to its test) | — |
| `orders/resolver.ts` | `ensureOrderIssueStore` | `loadIssueServiceModule` |
| `overdeck/affected-criteria.ts (file deleted)` | `parseAffectedCriteria` | `addCriterion`, `MAX_CRITERION`, `MIN_CRITERION` |
| `overdeck/control-settings.ts` | `SettingsResolverLive`, `SettingsWriterLive`, `getLastCleanShutdownAt` (moved to its test), `stampBootReconciliation` (moved to its test) | `appSettings` |
| `overdeck/conversations.ts` | `ConversationsResolverLive`, `TranscriptsResolverLive`, `TranscriptsWriterLive`, `ConversationWriterLive`, `importLegacyConversation` | `favoritesTable`, `rowToConversation`, `rowToTranscript`, `decodeConversation`, `decodeTranscript`, `rowToBackingFile`, `decodeBackingFile`, `ConvRow`, `FileRow`, `TransRow`, `conversationFilesTable`, `conversationsTable`, `transcriptsTable` |
| `overdeck/cost-sync.ts` | `queryCostEventsSync` | — |
| `overdeck/event-reads.ts` | `listAgentRuntimeEventEvidenceSync` | `eventTimestamp`, `AgentRuntimeEventRow` |
| `overdeck/issues.ts` | `makeIssueWriterLive` | `isLegalMove`, `outcomeForMove`, `LEGAL` |
| `overdeck/merge-sync.ts` | `patchMergeSetRepo`, `patchMergeSetRepos` | `MERGE_SET_REPO_CAS_FAILED` |
| `overdeck/merge.ts` | `MergeResolverLive`, `MergeWriterLive`, `getQueueForProject` | `buildAutoMerge`, `buildMergeSet`, `buildUatGeneration`, `reduceQueues`, `MergeQueueRow`, `MergeSetRepoRow`, `MergeSetRow`, `PendingAutoMergeRow`, `UatGenerationRow`, `UatMemberRow`, `UatResolutionRow`, `mergeQueue`, `mergeSetRepos`, `mergeSets`, `pendingAutoMerges`, `uatGenerationMembers`, `uatGenerationResolutions`, `uatGenerations` |
| `overdeck/observability.ts` | `ObservabilityLive`, `makeObservabilityLive` | `toDomainEvent` |
| `overdeck/planning-promotion.ts` | `completePlanningFilesToStage` | — |
| `overdeck/process-services.ts (file deleted)` | `AgentPermissionsLive` | `failPersistence`, `permissionState`, `causeMessage`, `decodePermissionDecision`, `decodePermissionRequest`, `isRecord` |
| `overdeck/release-sync.ts` | `deleteReleaseSet` | — |
| `paths.ts` | `LEGACY_RUNTIME_DIRS`, `piExtensionCandidates`, `getDocsDir` (moved to its test) | — |
| `planning/spawn-planning-session.ts` | `buildPlanningAgentState` | — |
| `projects/create-errors.ts` | `timedOutFailure`, `unknownOutcomeFailure` | `TIMEOUT_MESSAGE` |
| `release-set.ts` | `deleteReleaseSetSync` | — |
| `remote/remote-completion.ts` | `refreshClaudeCredentialsForActiveRemoteAgents`, `resetRemoteClaudeCredentialRefreshForTests` | `REMOTE_CLAUDE_CREDENTIAL_REFRESH_INTERVAL_MS`, `getHostClaudeCredentialFingerprint`, `RemoteClaudeCredentialRefreshDeps`, `perVmCredentialRefreshState`, `PerVmCredentialRefreshState` |
| `resource-utils.ts` | `parseContainerServiceNameSync` | — |
| `router-config.ts (file deleted)` | `generateRouterConfigFromWorkTypes`, `writeRouterConfigSync`, `getRouterConfigPath` | `ROUTER_CONFIG_FILE`, `ROUTER_CONFIG_DIR` |
| `runtime/claude.ts (file deleted)` | — | — |
| `runtime/index.ts (file deleted)` | — | — |
| `runtime/interface.ts (file deleted)` | — | — |
| `runtime/metrics.ts (file deleted)` | — | — |
| `settings-api.ts` | `getRoleConfig` | — |
| `settings.ts` | `saveSettingsSync`, `validateSettingsSync` | — |
| `shadow-mode.ts` | `hasProjectShadowConfig`, `getShadowModeSummary` | — |
| `shadow-state.ts` | `updateTrackerStatusCache`, `markAsSynced`, `getDisplayStatus` | — |
| `skills-merge.ts` | `cleanupWorkspaceGitignoreSync`, `cleanupGitignoreSync` | — |
| `smee.ts` | `startSmeeClient`, `stopSmeeClient`, `isSmeeRunningSync` | `scheduleRestart`, `computeRestartDelay`, `activeClient`, `restartTimeout`, `restartAttempt`, `isShuttingDown`, `MAX_RESTART_ATTEMPTS`, `BASE_RESTART_DELAY_MS`, `MAX_RESTART_DELAY_MS` |
| `stashes.ts` | `getNextReviewTempSequence`, `isOlderThanDays` | — |
| `state-migration-lock.ts (file deleted)` | `acquireStateMigrationLock` | — |
| `terminal-backends/registry.ts` | `registeredTerminalBackends` | — |
| `tmux.ts` | `buildTmuxCommandString`, `detectTerminalApiErrorSync`, `ensureManagedTmuxContextOnce` | `shellQuote` |
| `transcript-landing.ts` | `hasNewTranscriptUserRecord` | — |
| `xbrief/io.ts` | `recordTierPromotion`, `isPlanningProposed` | `checkPlanStatus` |
| `xbrief/lifecycle-io.ts` | `promoteXBriefToProposed` | — |
| `xbrief/quality-lint.ts` | `qualityLintErrors` (moved to its test) | — |
| `xbrief/swarm-readiness.ts` | `resolveIssueFootprint`, `computeIssueFootprint` | — |

### Surviving `…Sync` functions with no async twin (scope for #4002)

Every exported `…Sync` function in `src/lib` (tests excluded) that `scripts/audit-effect-boundary.mjs --json` does not
pair with a twin, and whose module exports no `foo`/`fooAsync`/`fooPromise` of the same base name, after this PR. The
number is how many times the name appears in production files under `src`, the declaration included. 372 functions;
one is Oh My Pi (#4003).

| Module | `…Sync` functions (production references) |
| --- | --- |
| `activity-logger.ts` | `emitActivityDetailedSync` (4), `emitActivityEntrySync` (159), `emitActivityTtsSync` (32), `emitDashboardLifecycleSync` (5) |
| `agent-input-detection.ts` | `detectAwaitingInputFromPaneSync` (5) |
| `agents/activity.ts` | `getLatestSessionIdSync` (27), `resolveClaudeSessionRecoverySync` (2), `resolveLatestSessionIdSync` (10) |
| `agents/agent-state-read.ts` | `getAgentStateSync` (276) |
| `agents/agent-state.ts` | `clearAgentOperatorGatesForIssueSync` (3), `clearAgentOperatorGatesForIssuesSync` (3), `clearYieldForResumeSync` (6), `recordAgentActivitySync` (3), `setAgentYieldedSync` (2), `writeAgentStateJsonSync` (4) |
| `agents/identity.ts` | `resolveAgentTargetSync` (16) |
| `agents/monitor-transport.ts` | `listInboxMessagesSync` (3) |
| `agents/runtime-command.ts` | `parseRoleMcpServersSync` (4), `roleSystemPromptInjectionSync` (8) |
| `agents/staffing.ts` | `providerDefaultHarnessSync` (2) |
| `agents/tier-fitness-context.ts` | `buildTierFitnessContextSync` (5) |
| `backup.ts` | `backupFileSync` (3), `cleanOldBackupsSync` (3), `createBackupSync` (3), `listBackupsSync` (6), `restoreBackupSync` (3) |
| `bridge-token.ts` | `readBridgeTokenSync` (7), `writeBridgeTokenSync` (6) |
| `child-env.ts` | `buildChildEnvSync` (9), `buildChildEnvWithoutTmuxSync` (13) |
| `claude-mcp.ts` | `ensureExcalidrawMcpSync` (3), `ensurePlaywrightIsolationSync` (4), `getIsolatedPlaywrightMcpConfigSync` (3) |
| `claude-permissions.ts` | `buildClaudeUserSettingsSync` (6), `bypassPrefixForAgentFlagSync` (1), `ensureClaudePermissionFlagSync` (3), `getClaudePermissionFlagsStringSync` (17), `getClaudePermissionFlagsSync` (6), `resolvePermissionModeSync` (5) |
| `claude-settings-file.ts` | `atomicWriteJsonSync` (6), `backupSettingsSync` (6), `findNewestBackupSync` (3), `pruneBackupsSync` (6) |
| `cloister/cost-monitor.ts` | `recordCostSync` (1), `resetCostTrackingSync` (1) |
| `cloister/database.ts` | `cleanupOldEventsSync` (2) |
| `cloister/handoff-logger.ts` | `logHandoffEventSync` (3) |
| `cloister/merge-agent.ts` | `autoCommitWorkspaceChangesBeforeSync` (2) |
| `cloister/specialist-logs.ts` | `appendToRunLogSync` (1), `cleanupAllLogsSync` (5), `cleanupOldLogsSync` (8), `createRunLogSync` (1), `finalizeRunLogSync` (5), `getRunLogSync` (6), `listRunLogsSync` (7) |
| `cloister/test-skip-waiver.ts` | `resolveActiveTestSkipWaiverSync` (3) |
| `cloister/verification-tests-mode.ts` | `detectGitHubActionsTestJobSync` (2) |
| `codex-auth.ts` | `hasActiveBurnedCodexAgentsSync` (2), `listCodexAuthBurnedAgentsSync` (3), `probeNativeCodexAuthSync` (2) |
| `config-migration.ts` | `cleanupLegacyRuntimeSymlinksSync` (3), `convertToYamlConfigSync` (2), `hasLegacySettingsSync` (3), `migrateConfigSync` (5), `migrateSyncTargetsSync` (3), `needsMigrationSync` (7) |
| `config-yaml/load.ts` | `getConversationSearchConfigSync` (18), `isTldrEnabledSync` (7), `loadConfigSync` (219) |
| `config.ts` | `getDashboardApiUrlSync` (40), `getDashboardLoopbackApiUrlSync` (5), `getDefaultConfigSync` (5), `getDevrootPathSync` (3), `saveConfigSync` (12) |
| `context-layers/detach.ts` | `detachManagedContextSync` (4) |
| `context.ts` | `appendSummarySync` (3), `estimateTokensSync` (3), `getRecentHistorySync` (3), `listMaterializedSync` (3), `logHistorySync` (4), `materializeOutputSync` (2), `readMaterializedSync` (3), `searchHistorySync` (3) |
| `conversations/correlator.ts` | `buildCorrelationMapSync` (3), `buildLocatorCorrelationMapSync` (3) |
| `cost-parsers/codex-parser.ts` | `parseCodexSessionCostEventsSync` (3), `parseCodexSessionSync` (6) |
| `cost-parsers/jsonl-parser.ts` | `getActiveSessionModelSync` (4), `getAllSessionFilesSync` (3), `getProjectDirsSync` (5), `getSessionFilesSync` (7), `parseClaudeSessionSync` (7) |
| `cost-parsers/kimi-parser.ts` | `parseKimiSessionSync` (7) |
| `cost-parsers/muse-parser.ts` | `parseMuseSessionSync` (4) |
| `cost-parsers/ohmypi-parser.ts` | `parseOhmypiSessionCostResultSync` (3) (Oh My Pi, #4003) |
| `cost-parsers/pi-parser.ts` | `parsePiSessionSync` (2) |
| `cost.ts` | `calculateCostSync` (20), `checkBudgetSync` (6), `createBudgetSync` (5), `deleteBudgetSync` (5), `formatCostSync` (26), `generateReportSync` (3), `getAllBudgetsSync` (5), `getBudgetSync` (2), `getDailySummarySync` (3), `getMonthlySummarySync` (3), `getPricingSync` (33), `getWeeklySummarySync` (3), `readCostsSync` (7), `readIssueCostsSync` (3), `readTodayCostsSync` (3), `summarizeCostsSync` (7) |
| `costs/aggregator.ts` | `getCostsByIssueSync` (5), `getCostsForIssueSync` (7), `loadCacheSync` (6), `rebuildCacheSync` (8), `saveCacheSync` (5), `setIssueBudgetSync` (2), `syncCacheSync` (6), `updateCacheFromEventsSync` (3) |
| `costs/attribution.ts` | `reclassifyUnknownCostEventsSync` (3) |
| `costs/events.ts` | `appendCostEventSync` (8), `deduplicateEventsSync` (4), `forEachCostEventSync` (3), `getEventsFileSizeSync` (4), `getLastEventMetadataSync` (5), `readEventsFromByteOffsetSync` (3), `readEventsFromLineSync` (2), `readEventsSync` (11), `replaceEventsFileSync` (6), `tailEventsSync` (4) |
| `costs/migration.ts` | `migrateAllSessionsSync` (5), `migrateIfNeededSync` (2), `needsMigrationSync` (7) |
| `costs/retention.ts` | `getRetentionStatusSync` (2), `needsPruningSync` (2), `pruneOldEventsSync` (2) |
| `costs/wal.ts` | `appendToWalSync` (4) |
| `cv.ts` | `completeWorkSync` (3), `formatCVSync` (3), `getAgentCVSync` (6), `getAgentRankingsSync` (3), `readAgentCVSync` (4), `saveAgentCVSync` (4), `startWorkSync` (5) |
| `deploy/active-dashboard-bundle.ts` | `readActiveDashboardBundleSync` (10) |
| `env-loader.ts` | `loadOverdeckEnvSync` (3) |
| `harness-policy.ts` | `canUseHarnessSync` (29), `canUseModelWithAuthSync` (4) |
| `harness-skill-sync.ts` | `executeAgentSkillsSync` (3), `planAgentSkillsSync` (3) |
| `hooks.ts` | `checkHookSync` (8), `clearHookSync` (5), `generateFixedPointPromptSync` (7), `getHookSync` (5), `initHookSync` (6), `popFromHookSync` (3), `pushToHookSync` (3), `sendMailSync` (3) |
| `internal-token.ts` | `ensureInternalTokenSync` (21), `getInternalTokenSync` (27) |
| `issue-id.ts` | `extractNumberSync` (21), `extractPrefixSync` (77), `normalizeIssueIdSync` (3), `parseIssueIdSync` (108), `resolveBareNumericIdSync` (15), `resolveIssueIdSync` (27) |
| `kimi-claude-routing.ts` | `getClaudeCodeLaunchModelSync` (6) |
| `launcher-generator.ts` | `generateLauncherScriptSync` (29) |
| `manifest.ts` | `collectSourceFilesSync` (18), `hashFileSync` (23), `pruneStaleManifestEntriesSync` (8), `readManifestSync` (12), `writeManifestSync` (10) |
| `memory/fts-operations.ts` | `getMemoryFtsDatabaseSync` (7), `runMemoryFtsStatementSync` (5), `runMemoryFtsTransactionSync` (5) |
| `merge-set.ts` | `buildMergeSetForIssueSync` (4), `ensureMergeSetForIssueSync` (11), `getMergeSetSync` (17), `upsertMergeSetSync` (27), `withRepoArtifactUrlSync` (7), `withRepoStateSync` (24) |
| `model-capabilities.ts` | `getModelCapabilitySync` (10), `getModelEffortLevelsSync` (8), `hasModelCapabilitySync` (6), `modelSupportsImagesSync` (4), `resolveModelIdSync` (28) |
| `model-context-windows.ts` | `apiLaunchModelIdSync` (5), `isGpt56LongContextVariantSync` (2) |
| `model-fallback.ts` | `applyFallbackSync` (4), `applyTierAwareFallbackSync` (2), `getAvailableModelsSync` (2), `getFallbackModelSync` (2), `getModelProviderSync` (3), `getModelsByProviderSync` (2), `isOpenRouterModelSync` (2) |
| `model-validation.ts` | `normalizeModelOverrideSync` (17), `requireModelOverrideSync` (25), `shellQuoteModelIdSync` (18) |
| `multi-tool-sync.ts` | `resolveAlsoSyncToolsSync` (4), `runMultiToolSyncSync` (3), `syncSkillsToToolsSync` (3) |
| `overdeck/agents.ts` | `getIssueStageSync` (3), `listAgentIdsByPrefixSync` (6) |
| `overdeck/control-settings.ts` | `getFlywheelActiveRunIdSync` (3), `isCloisterSpawnsPausedSync` (6), `setCloisterSpawnsPausedSync` (8) |
| `overdeck/conversation-cost-session.ts` | `findConversationForCostSessionSync` (6) |
| `overdeck/cost-agent-stats.ts` | `getAgentCostStatsSync` (4) |
| `overdeck/cost-sync.ts` | `getAgentDailyCostSync` (3), `getBackgroundCostBySourceSync` (3), `getCavemanExperimentDataSync` (3), `getCostForIssueAggregateSync` (7), `getCostForIssueSync` (2), `getCostSinceSync` (2), `getCostsByIssueSync` (5), `getDailyTrendsSync` (4), `getModelRollupSync` (3), `getTodayCostSync` (3), `insertCostEventSync` (5), `queryMemoryExtractionCostUsdSync` (3) |
| `overdeck/event-reads.ts` | `readLatestAgentClaudeSessionIdEventSync` (4) |
| `overdeck/git-activity.ts` | `appendGitOperationSync` (10), `listGitOperationsSync` (7) |
| `overdeck/infra.ts` | `closeOverdeckDatabaseSync` (1), `dropDeadIssuesForeignKeysSync` (4), `dropPipelineStateMirrorTablesSync` (4), `getOverdeckDatabaseSync` (140), `readPipelineMirrorMarkerSync` (2) |
| `overdeck/issue-reads.ts` | `resolveIssueProjectPathSync` (16) |
| `overdeck/merge-sync-uat.ts` | `getUatGenerationSync` (13), `hasUncleanedTerminalUatGenerationSync` (3), `insertUatGenerationSync` (4), `listUatGenerationNamesSync` (4), `listUatGenerationsSync` (10), `listUatGenerationsWithStacksSync` (4), `markUatGenerationRepoPromotedSync` (3), `setUatGenerationStackStartedAtSync` (4), `updateUatGenerationStatusSync` (2), `updateUatGenerationSync` (4) |
| `pan-dir/drafts.ts` | `checkPrdGateSync` (7) |
| `persistent-logger.ts` | `logAgentLifecycleSync` (69), `logDeaconEventSync` (16) |
| `pipeline-notifier.ts` | `notifyPipelineSync` (23), `setPipelineHandlerSync` (3) |
| `platform-lifecycle.ts` | `readPlatformConfigSync` (13) |
| `prd-draft.ts` | `getPRDDraftPathSync` (3) |
| `prd-locations.ts` | `canonicalPrdSubdirSync` (4), `findPrdAnywhereSync` (8), `findPrdAtStatusSync` (6) |
| `project-repos.ts` | `computeWorkspaceRepoRootsSync` (7), `forgeFromRemoteUrlSync` (3), `inferProjectForgeSync` (10), `normalizeForgeSync` (3), `resolveConfiguredReposSync` (6), `resolvePrimaryWorkspaceRepoDirSync` (7), `resolveProjectReposForIssueSync` (19), `resolveProjectReposFromResolvedIssueSync` (6), `resolveSlotWorkspaceWorktreesSync` (5), `resolveWorkspaceRepoRootsSync` (34) |
| `projects-writer.ts` | `setProjectVersionSync` (4) |
| `projects.ts` | `findProjectByPathSync` (63), `findProjectByTeamSync` (51), `hasProjectsSync` (4), `initializeProjectsConfigSync` (3), `registerProjectSync` (14), `saveProjectsConfigSync` (1), `unregisterProjectSync` (4) |
| `projects/project-key.ts` | `findProjectKeyByPathSync` (3) |
| `provider-health.ts` | `invalidateProbeCacheSync` (1) |
| `providers.ts` | `clearCredentialFileAuthSync` (9), `getProviderEnvSync` (13), `getProviderForModelSync` (53), `setupCredentialFileAuthSync` (9) |
| `release-set.ts` | `getReleaseSetSync` (5), `upsertReleaseSetSync` (6), `withComponentStateSync` (4) |
| `remote/fly-api.ts` | `createFlyApiClientSync` (3) |
| `remote/workspace-metadata.ts` | `deleteWorkspaceMetadataSync` (7), `findRemoteWorkspaceMetadataSync` (7), `listWorkspaceMetadataSync` (4), `loadWorkspaceMetadataSync` (23), `saveWorkspaceMetadataSync` (7) |
| `resource-utils.ts` | `parseIssueIdFromTextSync` (10) |
| `runtimes/acp.ts` | `createAcpRuntimeSync` (5) |
| `runtimes/claude-code.ts` | `createClaudeCodeRuntimeSync` (4) |
| `runtimes/codex.ts` | `createCodexRuntimeSync` (4) |
| `runtimes/kimi-code.ts` | `createKimiCodeRuntimeSync` (4) |
| `runtimes/muse.ts` | `createMuseRuntimeSync` (4) |
| `runtimes/pi-fifo.ts` | `destroyPiFifoSync` (1), `writePiCommandSync` (4) |
| `session-history.ts` | `readLatestIndexedSessionIdSync` (11), `readSessionIndexSync` (2), `readSessionIndexWithLegacySync` (4) |
| `settings.ts` | `getAgentCommandSync` (6), `getAvailableModelsSync` (2), `getClaudeModelFlagSync` (2), `getDefaultSettingsSync` (3), `isAnthropicModelSync` (2), `loadSettingsSync` (3) |
| `shadow-state.ts` | `needsSync` (3) |
| `shell.ts` | `addAliasSync` (3), `detectShellSync` (3), `getAliasInstructionsSync` (3), `getShellRcFileSync` (4), `hasAliasSync` (2) |
| `skills-merge.ts` | `applyProjectTemplateOverlaySync` (3), `mergePanSkillsIntoWorkspaceSync` (3), `mergeSkillsIntoWorkspaceSync` (9) |
| `smart-model-selector.ts` | `selectAllModelsSync` (6), `selectModelSync` (4) |
| `smee.ts` | `isSmeeConfiguredSync` (5), `isSmeeProcessRunningSync` (8), `startSmeeProcessSync` (8), `stopSmeeProcessSync` (6) |
| `supervisor.ts` | `getSupervisorPortSync` (9), `getSupervisorUrlSync` (3), `isSupervisorRunningSync` (4), `startSupervisorProcessSync` (10), `stopSupervisorProcessSync` (9) |
| `sync-hooks.ts` | `planHooksSyncSync` (8), `syncHooksSync` (6) |
| `sync-startup-gate.ts` | `isStartupSyncNeededSync` (6), `writeSyncManifestSync` (4) |
| `sync.ts` | `executeSyncSync` (4), `migrateStalePersonalContentSync` (3), `mirrorProjectSkillsSync` (4), `planSyncSync` (4), `refreshCacheSync` (5), `removeLegacySkills070Sync` (3), `syncContextLayersSync` (5), `syncPiSettingsSync` (3), `syncStatuslineSync` (5) |
| `tldr-daemon.ts` | `captureTldrMetricsSync` (1), `getTldrDaemonServiceSync` (47), `getTldrMetricsSync` (4), `listTldrDaemonServicesSync` (2) |
| `tmux.ts` | `findManagedServerPidSync` (6), `sanitizeManagedServerGlobalEnvSync` (2) |
| `tracker-utils.ts` | `isGitHubIssueSync` (4), `parseGitHubReposSync` (2), `resolveGitHubIssueSync` (70), `resolveTrackerTypeSync` (18) |
| `traefik.ts` | `cleanupStaleTlsSectionsSync` (5), `cleanupTemplateFilesSync` (3), `ensureProjectCertsSync` (7), `generateOverdeckTraefikConfigSync` (8), `generateTlsConfigSync` (8) |
| `tts-speak.ts` | `buildTtsSpeakPayloadSync` (2) |
| `webhook-handlers.ts` | `isTrackedRepositorySync` (11) |
| `work-agent-lifecycle.ts` | `assertCanResumeSessionSync` (3), `assertCanStartFreshSync` (8) |
| `workspace-config.ts` | `getDefaultWorkspaceConfigSync` (7), `replacePlaceholdersSync` (24) |
| `workspace-manager/create.ts` | `ensurePolyrepoWorkspaceGitignoreSync` (2) |
| `workspace-manager/migration.ts` | `copyOverdeckSettingsToWorkspaceSync` (9), `ensurePanGitignoreSync` (4), `migrateOverdeckToPanSync` (4) |
| `workspace-manager/worktree-ops.ts` | `mergeDirectoryWithoutOverwriteSync` (3), `preTrustDirectorySync` (8), `restorePreWorktreeMetadataSync` (4), `stagePreWorktreeMetadataSync` (3) |
| `workspace/devcontainer-renderer.ts` | `createWorkspacePlaceholdersSync` (4), `processTemplatesSync` (6), `renderDevcontainerSync` (10), `sanitizeComposeFileSync` (4) |
| `workspace/ensure-devcontainer.ts` | `ensureDevcontainerSync` (11) |
| `xbrief/acceptance-criteria.ts` | `getXBriefACStatusSync` (4) |
| `xbrief/io.ts` | `findSpecByIssueSync` (9) |
| `xbrief/lifecycle-io.ts` | `findXBriefByIssueSync` (7) |
| `xbrief/lifecycle.ts` | `ensureXBriefDirsSync` (3) |

### #4051 review follow-ups

- `tests/unit/lib/overdeck/merge-queue.test.ts` is restored. It was the only real-DB coverage of the live
  `markMergeProcessing(key, id, false)` (called on the deferred-verification path, `merge-ops.ts`), which moves a
  `processing` row back to `queued` and clears `started_at`. It now observes the row with a direct `odb.raw()` read
  instead of the deleted `getQueueForProject`. A second test pins the `WHERE status = ?` source-state guard: un-marking
  a queued row and re-marking a processing row both match nothing.
- `tests/lib/overdeck/cost-sync.test.ts` gets back the `getAgentCostStatsSync` assertion (`burnUsdPerHour: 1.91,
  hypotheticalUsdPerHour: 0.25, totalUsd: 1.96`) with its fixtures on the 30-minute boundary and its
  subscription-covered rows; that function feeds `dashboard-db-worker.ts`. Only the comparison against the deleted
  `queryCostEventsSync` is dropped; the zero-hypothetical-rate check now runs on the snapshot built from the aggregates.
- `canDispatchAdvancing` (`cloister/concurrency.ts`) lost its only caller, `tryReserveAdvancingSlot`, in this PR. The
  scan missed it because `memory-verdict-cache.ts`'s header named it. It is deleted with its tests
  (`tests/unit/lib/cloister/concurrency.test.ts` and one test in `tests/lib/cloister/concurrency.test.ts`), and the header
  now names `memoryDrivenWorkSlots`, the real consumer.
- **The scan counts comment mentions as uses.** A variant that ignores comments in code files finds 9 more exports
  live only through a comment: `DEAD` `decideEscalation` (`agents/tier-escalation.ts`), `parseAgentOutput`
  (`cloister/merge-agent.ts`), `buildPiCommand` (`launcher-generator.ts`), `createSymlinks`
  (`workspace-manager/worktree-ops.ts`); `TESTONLY` `assignDispatchTier` (`agents/dispatch-tier.ts`),
  `swarmJanitorPass` (`cloister/deacon-swarm.ts`), `parsePiSessionSync` (`cost-parsers/pi-parser.ts`),
  `listEligibleCandidatesByProject` and `pickFromSequence` (`flywheel-merge-order.ts`). They are not deleted here:
  several of their tests exercise live code through them (the merge-train route tests mock
  `listEligibleCandidatesByProject`; the swarm-foreman liveness tests drive through `swarmJanitorPass`), so each needs
  the same port-or-delete review as the rows above. CH-8b handles them.
