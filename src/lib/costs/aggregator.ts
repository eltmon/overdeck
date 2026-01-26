/**
 * Cost Aggregation Cache Management
 *
 * Maintains pre-computed cost summaries by issue, updated incrementally
 * from the event log.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { COSTS_DIR } from '../paths.js';
import { CostCache, CostEvent, IssueCostData } from './types.js';
import { readEvents, getLastEventLine } from './events.js';
import { calculateEventCost } from './pricing.js';

// Cache file path
const CACHE_FILE = join(COSTS_DIR, 'by-issue.json');

// Current cache version
const CACHE_VERSION = 2;

/**
 * Load the cost aggregation cache
 *
 * Returns an empty cache if the file doesn't exist.
 */
export function loadCache(): CostCache {
  if (!existsSync(CACHE_FILE)) {
    return createEmptyCache();
  }

  try {
    const content = readFileSync(CACHE_FILE, 'utf-8');
    const cache = JSON.parse(content) as CostCache;

    // Validate cache version
    if (cache.version !== CACHE_VERSION) {
      console.warn(`Cache version mismatch (expected ${CACHE_VERSION}, got ${cache.version}), rebuilding...`);
      return createEmptyCache();
    }

    return cache;
  } catch (error) {
    console.warn('Failed to load cost cache, creating new:', error);
    return createEmptyCache();
  }
}

/**
 * Save the cost aggregation cache
 */
export function saveCache(cache: CostCache): void {
  mkdirSync(COSTS_DIR, { recursive: true });

  const content = JSON.stringify(cache, null, 2);
  writeFileSync(CACHE_FILE, content, 'utf-8');
}

/**
 * Update the cache with a single cost event
 *
 * Extracts issue ID from agent name and updates aggregated totals.
 */
export function updateCacheFromEvent(cache: CostCache, event: CostEvent): void {
  // Extract issue ID from agent name
  // Format: "agent-pan-74" or "agent-pan-74-subagent-aa82e20"
  const issueId = extractIssueId(event.agent);

  if (!issueId) {
    // Skip events without an issue ID (manual sessions)
    return;
  }

  // Get or create issue cost data
  if (!cache.issues[issueId]) {
    cache.issues[issueId] = createEmptyIssueCostData();
  }

  const issueCost = cache.issues[issueId];

  // Calculate cost for this event
  const eventCost = calculateEventCost(
    event.input,
    event.output,
    event.cache_read,
    event.cache_write,
    event.model
  );

  // Update totals
  issueCost.totalCost += eventCost;
  issueCost.inputTokens += event.input;
  issueCost.outputTokens += event.output;
  issueCost.cacheReadTokens += event.cache_read;
  issueCost.cacheWriteTokens += event.cache_write;

  // Update model breakdown
  issueCost.models[event.model] = (issueCost.models[event.model] || 0) + eventCost;

  // Update timestamp
  issueCost.lastUpdated = event.ts;

  // Update cache metadata
  cache.lastEventTs = event.ts;
}

/**
 * Rebuild the entire cache from the event log
 *
 * Reads all events and recalculates aggregations from scratch.
 */
export function rebuildFromEvents(): CostCache {
  const cache = createEmptyCache();
  const events = readEvents(0, 0); // Read all events

  for (const event of events) {
    updateCacheFromEvent(cache, event);
  }

  // Update lastEventLine to current position
  cache.lastEventLine = getLastEventLine();

  // Save the rebuilt cache
  saveCache(cache);

  return cache;
}

/**
 * Update cache incrementally with new events
 *
 * Reads events since lastEventLine and updates the cache.
 * Returns the number of events processed.
 */
export function updateCacheIncremental(): number {
  const cache = loadCache();
  const lastLine = cache.lastEventLine;
  const currentLine = getLastEventLine();

  if (currentLine <= lastLine) {
    // No new events
    return 0;
  }

  // Read new events
  const events = readEvents(lastLine, 0);

  for (const event of events) {
    updateCacheFromEvent(cache, event);
  }

  // Update cache position
  cache.lastEventLine = currentLine;

  // Save updated cache
  saveCache(cache);

  return events.length;
}

/**
 * Get cost data for a specific issue
 */
export function getIssueCost(issueId: string): IssueCostData | null {
  const cache = loadCache();
  return cache.issues[issueId] || null;
}

/**
 * Get all issue costs
 */
export function getAllIssueCosts(): Record<string, IssueCostData> {
  const cache = loadCache();
  return cache.issues;
}

/**
 * Clear the cache (for testing or manual rebuild)
 */
export function clearCache(): void {
  if (existsSync(CACHE_FILE)) {
    writeFileSync(CACHE_FILE, '', 'utf-8');
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  exists: boolean;
  version: number;
  issueCount: number;
  totalCost: number;
  lastEventLine: number;
  lastEventTs: string;
} {
  if (!existsSync(CACHE_FILE)) {
    return {
      exists: false,
      version: 0,
      issueCount: 0,
      totalCost: 0,
      lastEventLine: 0,
      lastEventTs: '',
    };
  }

  const cache = loadCache();
  const totalCost = Object.values(cache.issues).reduce(
    (sum, issue) => sum + issue.totalCost,
    0
  );

  return {
    exists: true,
    version: cache.version,
    issueCount: Object.keys(cache.issues).length,
    totalCost,
    lastEventLine: cache.lastEventLine,
    lastEventTs: cache.lastEventTs,
  };
}

// ============== Helper Functions ==============

/**
 * Create an empty cost cache
 */
function createEmptyCache(): CostCache {
  return {
    version: CACHE_VERSION,
    lastEventTs: new Date().toISOString(),
    lastEventLine: 0,
    issues: {},
  };
}

/**
 * Create empty issue cost data
 */
function createEmptyIssueCostData(): IssueCostData {
  return {
    totalCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    models: {},
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Extract issue ID from agent name
 *
 * Examples:
 * - "agent-pan-74" -> "pan-74"
 * - "agent-pan-74-subagent-aa82e20" -> "pan-74"
 * - "agent-min-123" -> "min-123"
 * - "planning-pan-75" -> "pan-75"
 */
function extractIssueId(agentName: string): string | null {
  // Match patterns like "agent-pan-74" or "planning-pan-75"
  const match = agentName.match(/(?:agent|planning)-([a-z]+-\d+)/i);
  return match ? match[1] : null;
}
