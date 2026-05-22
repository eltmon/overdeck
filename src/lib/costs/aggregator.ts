/**
 * Aggregation Cache Management for Cost Tracking
 *
 * Manages the by-issue.json cache that stores pre-computed cost aggregations.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { CostEvent, readEventsSync, readEventsFromLineSync, getLastEventMetadataSync } from './events.js';
import { FsError } from '../errors.js';

// ============== Types ==============

export interface ModelStats {
  cost: number;
  calls: number;
  tokens: number;
}

export interface StageStats {
  cost: number;
  tokens: number;
  calls: number;
}

export interface IssueStats {
  totalCost: number;
  budget?: number;
  budgetWarning: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  models: Record<string, ModelStats>;
  providers: Record<string, number>;
  stages: Record<string, StageStats>;
  lastUpdated: string;
}

export interface CostCache {
  version: number;
  status: 'live' | 'migrating' | 'stale';
  lastEventTs: string | null;
  lastEventLine: number;
  retentionDays: number;
  issues: Record<string, IssueStats>;
}

// ============== Constants ==============

const CACHE_VERSION = 3;
const DEFAULT_RETENTION_DAYS = 90;

// Use functions for paths to allow test mocking via process.env.HOME
function getCostsDir(): string {
  return join(process.env.HOME || homedir(), '.panopticon', 'costs');
}

function getCacheFile(): string {
  return join(getCostsDir(), 'by-issue.json');
}

// ============== Cache Loading ==============

/**
 * Load the cache from disk
 */
export function loadCacheSync(): CostCache {
  const cacheFile = getCacheFile();
  if (!existsSync(cacheFile)) {
    return createEmptyCache();
  }

  try {
    const content = readFileSync(cacheFile, 'utf-8');
    const cache = JSON.parse(content) as CostCache;

    // Validate version
    if (cache.version !== CACHE_VERSION) {
      console.warn(`Cache version mismatch: expected ${CACHE_VERSION}, got ${cache.version}. Rebuilding cache.`);
      return createEmptyCache();
    }

    return cache;
  } catch (err) {
    console.error('Error loading cache:', err);
    return createEmptyCache();
  }
}

/**
 * Create an empty cache structure
 */
function createEmptyCache(): CostCache {
  return {
    version: CACHE_VERSION,
    status: 'live',
    lastEventTs: null,
    lastEventLine: 0,
    retentionDays: DEFAULT_RETENTION_DAYS,
    issues: {},
  };
}

// ============== Cache Saving ==============

/**
 * Save the cache to disk atomically
 */
export function saveCacheSync(cache: CostCache): void {
  const costsDir = getCostsDir();
  const cacheFile = getCacheFile();
  mkdirSync(costsDir, { recursive: true });

  // Write to temp file first
  const tempFile = cacheFile + '.tmp';
  const content = JSON.stringify(cache, null, 2);
  writeFileSync(tempFile, content, 'utf-8');

  // Atomic rename
  renameSync(tempFile, cacheFile);
}

// ============== Cache Updates ==============

/**
 * Update cache incrementally from new events
 * @param events Array of events to add
 * @param newLineNumber Optional new line number (for correct tracking with malformed lines)
 */
export function updateCacheFromEventsSync(events: CostEvent[], newLineNumber?: number): CostCache {
  const cache = loadCacheSync();

  for (const event of events) {
    addEventToCache(cache, event);
  }

  // Update metadata
  if (events.length > 0) {
    const lastEvent = events[events.length - 1];
    cache.lastEventTs = lastEvent.ts;

    // Use provided line number if available (handles malformed lines correctly)
    // Otherwise fall back to incrementing by event count (for backward compatibility)
    if (newLineNumber !== undefined) {
      cache.lastEventLine = newLineNumber;
    } else {
      cache.lastEventLine += events.length;
    }
  }

  cache.status = 'live';

  saveCacheSync(cache);
  return cache;
}

/**
 * Add a single event to the cache
 */
function addEventToCache(cache: CostCache, event: CostEvent): void {
  const issueKey = event.issueId.toUpperCase();

  // Initialize issue stats if needed
  if (!cache.issues[issueKey]) {
    cache.issues[issueKey] = {
      totalCost: 0,
      budgetWarning: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      models: {},
      providers: {},
      stages: {},
      lastUpdated: event.ts,
    };
  }

  const issue = cache.issues[issueKey];

  // Update totals
  issue.totalCost += event.cost;
  issue.inputTokens += event.input;
  issue.outputTokens += event.output;
  issue.cacheReadTokens += event.cacheRead;
  issue.cacheWriteTokens += event.cacheWrite;
  issue.lastUpdated = event.ts;

  // Update model stats
  if (!issue.models[event.model]) {
    issue.models[event.model] = {
      cost: 0,
      calls: 0,
      tokens: 0,
    };
  }

  const modelStats = issue.models[event.model];
  modelStats.cost += event.cost;
  modelStats.calls += 1;
  modelStats.tokens += event.input + event.output + event.cacheRead + event.cacheWrite;

  // Update provider stats
  if (!issue.providers[event.provider]) {
    issue.providers[event.provider] = 0;
  }
  issue.providers[event.provider] += event.cost;

  // Update stage stats (using sessionType as stage)
  const stage = event.sessionType || 'unknown';
  if (!issue.stages[stage]) {
    issue.stages[stage] = {
      cost: 0,
      tokens: 0,
      calls: 0,
    };
  }
  const stageStats = issue.stages[stage];
  stageStats.cost += event.cost;
  stageStats.calls += 1;
  stageStats.tokens += event.input + event.output + event.cacheRead + event.cacheWrite;

  // Check budget warning
  if (issue.budget) {
    issue.budgetWarning = issue.totalCost >= issue.budget * 0.8;
  }

  // Round costs to avoid floating point errors
  issue.totalCost = Math.round(issue.totalCost * 1000000) / 1000000;
  modelStats.cost = Math.round(modelStats.cost * 1000000) / 1000000;
  issue.providers[event.provider] = Math.round(issue.providers[event.provider] * 1000000) / 1000000;
  stageStats.cost = Math.round(stageStats.cost * 1000000) / 1000000;
}

/**
 * Rebuild the entire cache from all events
 */
export function rebuildCacheSync(): CostCache {
  console.log('Rebuilding cost cache from events...');

  const cache = createEmptyCache();
  cache.status = 'migrating';

  // Read all events
  const events = readEventsSync();
  console.log(`Processing ${events.length} events...`);

  for (const event of events) {
    addEventToCache(cache, event);
  }

  // Update metadata
  const metadata = getLastEventMetadataSync();
  cache.lastEventTs = metadata.lastEventTs;
  cache.lastEventLine = metadata.lastEventLine;
  cache.status = 'live';

  console.log(`Cache rebuilt: ${Object.keys(cache.issues).length} issues, ${events.length} events`);

  saveCacheSync(cache);
  return cache;
}

/**
 * Sync cache with latest events
 * Reads events since the last processed event and updates cache
 */
export function syncCacheSync(): CostCache {
  const cache = loadCacheSync();

  // Check if there are new events
  const metadata = getLastEventMetadataSync();

  if (metadata.lastEventLine === cache.lastEventLine) {
    // Already up to date
    return cache;
  }

  if (metadata.lastEventLine < cache.lastEventLine) {
    // Events file was truncated (retention cleanup) - rebuild
    console.log('Events file was truncated, rebuilding cache...');
    return rebuildCacheSync();
  }

  // Read new events (returns both events and new line position)
  const { events: newEvents, newLine } = readEventsFromLineSync(cache.lastEventLine);

  if (newEvents.length > 0) {
    console.log(`Syncing cache with ${newEvents.length} new events...`);
    return updateCacheFromEventsSync(newEvents, newLine);
  }

  // Even if no events, update line number in case file was appended with only malformed lines
  if (newLine !== cache.lastEventLine) {
    cache.lastEventLine = newLine;
    saveCacheSync(cache);
  }

  return cache;
}

// ============== Cache Queries ==============

/**
 * Get costs for all issues
 */
export function getCostsByIssueSync(): Record<string, IssueStats> {
  const cache = syncCacheSync();
  return cache.issues;
}

/**
 * Get costs for a specific issue
 */
export function getCostsForIssueSync(issueId: string): IssueStats | null {
  const cache = syncCacheSync();
  const issueKey = issueId.toUpperCase();
  return cache.issues[issueKey] || null;
}

/**
 * Set budget for an issue
 */
export function setIssueBudgetSync(issueId: string, budget: number): void {
  const cache = loadCacheSync();
  const issueKey = issueId.toUpperCase();

  if (!cache.issues[issueKey]) {
    cache.issues[issueKey] = {
      totalCost: 0,
      budgetWarning: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      models: {},
      providers: {},
      stages: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  cache.issues[issueKey].budget = budget;
  cache.issues[issueKey].budgetWarning = cache.issues[issueKey].totalCost >= budget * 0.8;

  saveCacheSync(cache);
}

/**
 * Get cache status
 */
export function getCacheStatus(): {
  status: 'live' | 'migrating' | 'stale';
  lastEventTs: string | null;
  eventCount: number;
  issueCount: number;
  needsSync: boolean;
} {
  const cache = loadCacheSync();
  const metadata = getLastEventMetadataSync();

  return {
    status: cache.status,
    lastEventTs: cache.lastEventTs,
    eventCount: cache.lastEventLine,
    issueCount: Object.keys(cache.issues).length,
    needsSync: metadata.lastEventLine !== cache.lastEventLine,
  };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of loadCache. Failures surface as FsError. */
export const loadCache = (): Effect.Effect<CostCache, FsError> =>
  Effect.try({
    try: () => loadCacheSync(),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'loadCache', cause }),
  });

/** Effect variant of saveCache. */
export const saveCache = (cache: CostCache): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => saveCacheSync(cache),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'saveCache', cause }),
  });

/** Effect variant of updateCacheFromEvents. */
export const updateCacheFromEvents = (
  events: CostEvent[],
  newLineNumber?: number,
): Effect.Effect<CostCache, FsError> =>
  Effect.try({
    try: () => updateCacheFromEventsSync(events, newLineNumber),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'updateCacheFromEvents', cause }),
  });

/** Effect variant of rebuildCache. */
export const rebuildCache = (): Effect.Effect<CostCache, FsError> =>
  Effect.try({
    try: () => rebuildCacheSync(),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'rebuildCache', cause }),
  });

/** Effect variant of syncCache. */
export const syncCache = (): Effect.Effect<CostCache, FsError> =>
  Effect.try({
    try: () => syncCacheSync(),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'syncCache', cause }),
  });

/** Effect variant of getCostsByIssue. */
export const getCostsByIssue = (): Effect.Effect<Record<string, IssueStats>, FsError> =>
  Effect.try({
    try: () => getCostsByIssueSync(),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'getCostsByIssue', cause }),
  });

/** Effect variant of getCostsForIssue. */
export const getCostsForIssue = (
  issueId: string,
): Effect.Effect<IssueStats | null, FsError> =>
  Effect.try({
    try: () => getCostsForIssueSync(issueId),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'getCostsForIssue', cause }),
  });

/** Effect variant of setIssueBudget. */
export const setIssueBudget = (
  issueId: string,
  budget: number,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => setIssueBudgetSync(issueId, budget),
    catch: (cause) => new FsError({ path: getCacheFile(), operation: 'setIssueBudget', cause }),
  });
