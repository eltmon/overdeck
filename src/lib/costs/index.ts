/**
 * Cost Tracking Module - Event-Sourced Architecture
 *
 * Exports all public functions for cost tracking, aggregation, and migration.
 */

// Event log management
export {
  appendCostEventSync,
  readEventsSync,
  tailEventsSync,
  readEventsFromLineSync,
  getLastEventMetadataSync,
  replaceEventsFileSync,
  deduplicateEventsSync,
  eventsFileExists,
  getEventsFilePath,
  type CostEvent,
  type EventMetadata,
  type ReadEventsOptions,
} from './events.js';

// Aggregation cache management
export {
  loadCacheSync,
  saveCacheSync,
  updateCacheFromEventsSync,
  rebuildCacheSync,
  syncCacheSync,
  getCostsByIssueSync,
  getCostsForIssueSync,
  setIssueBudgetSync,
  getCacheStatus,
  type CostCache,
  type IssueStats,
  type ModelStats,
  type StageStats,
} from './aggregator.js';

// Historical data migration
export {
  migrateAllSessionsSync,
  needsMigrationSync,
  migrateIfNeededSync,
  // Effect variants (PAN-1249)
  needsMigration,
  type MigrationStats,
} from './migration.js';

// Cost reconciler — periodic catch-up sweep
export {
  reconcile,
  type ReconcileResult,
} from './reconciler.js';

// Event retention
export {
  pruneOldEventsSync,
  needsPruningSync,
  getRetentionStatusSync,
  // Effect variants (PAN-1249)
  needsPruning,
  type RetentionStats,
} from './retention.js';

// WAL writers / sync (PAN-1249)
export {
  appendToWalSync,
  resolveWalDir,
  appendToWal,
} from './wal.js';
export {
  syncWalFromAllProjects,
  syncWalFromDir,
  type SyncResult,
} from './sync-wal.js';
