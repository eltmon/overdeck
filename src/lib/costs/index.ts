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
  eventsFileExists,
  getEventsFilePath,
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
  type MigrationStats,
} from './migration.js';

// Event retention
export {
  pruneOldEvents,
  needsPruning,
  getRetentionStatus,
  type RetentionStats,
} from './retention.js';
