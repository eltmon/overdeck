/**
 * Cost Tracking Module - Event-Sourced Architecture
 *
 * Exports all public functions for cost tracking, aggregation, and migration.
 */

// Event log management
export {
  appendCostEvent,
  readEvents,
  tailEvents,
  readEventsFromLine,
  getLastEventMetadata,
  replaceEventsFile,
  deduplicateEvents,
  eventsFileExists,
  getEventsFilePath,
  // Effect variants (PAN-1249)
  appendCostEventEffect,
  readEventsEffect,
  tailEventsEffect,
  readEventsFromLineEffect,
  getLastEventMetadataEffect,
  replaceEventsFileEffect,
  deduplicateEventsEffect,
  type CostEvent,
  type EventMetadata,
  type ReadEventsOptions,
} from './events.js';

// Aggregation cache management
export {
  loadCache,
  saveCache,
  updateCacheFromEvents,
  rebuildCache,
  syncCache,
  getCostsByIssue,
  getCostsForIssue,
  setIssueBudget,
  getCacheStatus,
  // Effect variants (PAN-1249)
  loadCacheEffect,
  saveCacheEffect,
  updateCacheFromEventsEffect,
  rebuildCacheEffect,
  syncCacheEffect,
  getCostsByIssueEffect,
  getCostsForIssueEffect,
  setIssueBudgetEffect,
  type CostCache,
  type IssueStats,
  type ModelStats,
  type StageStats,
} from './aggregator.js';

// Historical data migration
export {
  migrateAllSessions,
  needsMigration,
  migrateIfNeeded,
  // Effect variants (PAN-1249)
  migrateAllSessionsEffect,
  needsMigrationEffect,
  migrateIfNeededEffect,
  type MigrationStats,
} from './migration.js';

// Cost reconciler — periodic catch-up sweep
export {
  reconcile,
  // Effect variants (PAN-1249)
  reconcileEffect,
  type ReconcileResult,
} from './reconciler.js';

// Event retention
export {
  pruneOldEvents,
  needsPruning,
  getRetentionStatus,
  // Effect variants (PAN-1249)
  pruneOldEventsEffect,
  needsPruningEffect,
  getRetentionStatusEffect,
  type RetentionStats,
} from './retention.js';

// WAL writers / sync (PAN-1249)
export {
  appendToWal,
  resolveWalDir,
  appendToWalEffect,
} from './wal.js';
export {
  syncWalFromAllProjects,
  syncWalFromDir,
  syncWalFromAllProjectsEffect,
  syncWalFromDirEffect,
  type SyncResult,
} from './sync-wal.js';
