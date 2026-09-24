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

Ratchet: C 52 → 34 (33 pairs plus the Oh My Pi runtime row). A 1 and B 4 are Oh My Pi only (#4003). Effect diagnostics
unchanged at 250. `src/lib/tmux.ts` (1322) and `src/lib/projects.ts` (1253) gain audited file-size exceptions (PAN-4012)
for their sync-twin headers.

A C5 row whose remaining Effect-variant caller is server-reachable keeps the async variant: server callers use the async
twin. So `cloister/config.ts` `loadCloisterConfig`/`saveCloisterConfig` (caller: `lifecycle/workflows.ts` close-out)
and `projects.ts` `resolveProjectFromIssue` (caller: `services/read-workspace-file.ts`; its loader exists so dashboard
resolves avoid sync syscalls, PAN-3330) stay as C6 rows instead of the PRD's C5.

### Deleted twins

| Module | Deleted | Survivor | Rule | Callers moved |
| --- | --- | --- | --- | --- |
| `agents/agent-state.ts` | `setAgentPausedSync` | `setAgentPaused` (Effect) | C4 | `cli/commands/pause.ts`, `cli/commands/workspace-migrate.ts`, `cloister/memory-governor.ts`, `cloister/service-crash.ts` (all async) |
| `agents/agent-state.ts` | `clearAgentPausedSync` | `clearAgentPaused` (Effect) | C4 | `cli/commands/start.ts` (2), `cli/commands/unpause.ts`, `cloister/feedback-target.ts` |
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

Left for the operator (decision item on the PR): `cloister/concurrency.ts` `describeRunningAgents` (no production
caller), `countRunningSwarmSlotsForIssue` and `countWarmIdleAdvancingAgents` (default parameters),
`emergencyBrake`, and `cloister/service.ts` `emergencyStop` still call `listRunningAgentsSync` / `stopAgentSync`.

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
