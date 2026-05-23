/**
 * Runtime Metrics Tracking
 *
 * Track performance metrics per runtime for comparison and analysis.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Data, Effect } from 'effect';
import { PANOPTICON_HOME } from '../paths.js';
import { FsError } from '../errors.js';
import { RuntimeType } from './interface.js';

const METRICS_FILE = join(PANOPTICON_HOME, 'runtime-metrics.json');

// Task outcome
export type TaskOutcome = 'success' | 'failure' | 'partial' | 'timeout' | 'canceled';

// Task type/capability
export type TaskCapability = 'feature' | 'bugfix' | 'refactor' | 'review' | 'planning' | 'documentation' | 'testing' | 'other';

/**
 * Individual task record
 */
export interface TaskRecord {
  id: string;
  runtime: RuntimeType;
  issueId?: string;
  capability: TaskCapability;
  model?: string;
  outcome: TaskOutcome;
  startedAt: string;
  completedAt: string;
  durationMinutes: number;
  cost: number;
  tokenCount: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Per-capability statistics
 */
export interface CapabilityStats {
  tasks: number;
  successfulTasks: number;
  successRate: number;
  avgDurationMinutes: number;
  totalCost: number;
  avgCost: number;
}

/**
 * Daily statistics for time series
 */
export interface DailyStats {
  date: string;
  tasks: number;
  successfulTasks: number;
  cost: number;
  successRate: number;
  tokenCount: number;
}

/**
 * Runtime metrics aggregation
 */
export interface RuntimeMetrics {
  runtime: RuntimeType;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  partialTasks: number;
  successRate: number;
  avgDurationMinutes: number;
  avgCost: number;
  totalCost: number;
  totalTokens: number;
  byCapability: Partial<Record<TaskCapability, CapabilityStats>>;
  byModel: Record<string, {
    tasks: number;
    successRate: number;
    avgCost: number;
    totalCost: number;
  }>;
  dailyStats: DailyStats[];
  lastUpdated: string;
}

/**
 * All metrics data
 */
export interface MetricsData {
  version: number;
  tasks: TaskRecord[];
  runtimes: Partial<Record<RuntimeType, RuntimeMetrics>>;
  lastUpdated: string;
}

const DEFAULT_METRICS: MetricsData = {
  version: 1,
  tasks: [],
  runtimes: {},
  lastUpdated: new Date().toISOString(),
};

/**
 * Load metrics from file
 */
export function loadMetricsSync(): MetricsData {
  try {
    if (existsSync(METRICS_FILE)) {
      const content = readFileSync(METRICS_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn('Failed to load metrics file:', error);
  }
  return { ...DEFAULT_METRICS };
}

/**
 * Save metrics to file
 */
export function saveMetricsSync(data: MetricsData): void {
  mkdirSync(PANOPTICON_HOME, { recursive: true });
  data.lastUpdated = new Date().toISOString();
  writeFileSync(METRICS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Record a completed task
 */
export function recordTaskSync(task: Omit<TaskRecord, 'id'>): TaskRecord {
  const data = loadMetricsSync();

  const record: TaskRecord = {
    ...task,
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  data.tasks.push(record);

  // Rebuild aggregates
  rebuildRuntimeMetrics(data, task.runtime);

  saveMetricsSync(data);
  return record;
}

/**
 * Rebuild metrics for a specific runtime
 */
function rebuildRuntimeMetrics(data: MetricsData, runtime: RuntimeType): void {
  const runtimeTasks = data.tasks.filter(t => t.runtime === runtime);

  if (runtimeTasks.length === 0) {
    delete data.runtimes[runtime];
    return;
  }

  const successful = runtimeTasks.filter(t => t.outcome === 'success').length;
  const failed = runtimeTasks.filter(t => t.outcome === 'failure').length;
  const partial = runtimeTasks.filter(t => t.outcome === 'partial').length;

  const totalCost = runtimeTasks.reduce((sum, t) => sum + t.cost, 0);
  const totalTokens = runtimeTasks.reduce((sum, t) => sum + t.tokenCount, 0);
  const totalDuration = runtimeTasks.reduce((sum, t) => sum + t.durationMinutes, 0);

  // By capability
  const byCapability: Partial<Record<TaskCapability, CapabilityStats>> = {};
  const capabilities: TaskCapability[] = ['feature', 'bugfix', 'refactor', 'review', 'planning', 'documentation', 'testing', 'other'];

  for (const cap of capabilities) {
    const capTasks = runtimeTasks.filter(t => t.capability === cap);
    if (capTasks.length > 0) {
      const capSuccessful = capTasks.filter(t => t.outcome === 'success').length;
      const capTotalCost = capTasks.reduce((sum, t) => sum + t.cost, 0);
      const capTotalDuration = capTasks.reduce((sum, t) => sum + t.durationMinutes, 0);

      byCapability[cap] = {
        tasks: capTasks.length,
        successfulTasks: capSuccessful,
        successRate: capTasks.length > 0 ? capSuccessful / capTasks.length : 0,
        avgDurationMinutes: capTasks.length > 0 ? capTotalDuration / capTasks.length : 0,
        totalCost: capTotalCost,
        avgCost: capTasks.length > 0 ? capTotalCost / capTasks.length : 0,
      };
    }
  }

  // By model
  const byModel: Record<string, { tasks: number; successRate: number; avgCost: number; totalCost: number }> = {};
  const models = [...new Set(runtimeTasks.map(t => t.model || 'unknown'))];

  for (const model of models) {
    const modelTasks = runtimeTasks.filter(t => (t.model || 'unknown') === model);
    const modelSuccessful = modelTasks.filter(t => t.outcome === 'success').length;
    const modelTotalCost = modelTasks.reduce((sum, t) => sum + t.cost, 0);

    byModel[model] = {
      tasks: modelTasks.length,
      successRate: modelTasks.length > 0 ? modelSuccessful / modelTasks.length : 0,
      avgCost: modelTasks.length > 0 ? modelTotalCost / modelTasks.length : 0,
      totalCost: modelTotalCost,
    };
  }

  // Daily stats (last 30 days)
  const dailyStats: DailyStats[] = [];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  for (let d = new Date(thirtyDaysAgo); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayTasks = runtimeTasks.filter(t => t.completedAt.startsWith(dateStr));

    if (dayTasks.length > 0) {
      const daySuccessful = dayTasks.filter(t => t.outcome === 'success').length;
      const dayCost = dayTasks.reduce((sum, t) => sum + t.cost, 0);
      const dayTokens = dayTasks.reduce((sum, t) => sum + t.tokenCount, 0);

      dailyStats.push({
        date: dateStr,
        tasks: dayTasks.length,
        successfulTasks: daySuccessful,
        cost: dayCost,
        successRate: dayTasks.length > 0 ? daySuccessful / dayTasks.length : 0,
        tokenCount: dayTokens,
      });
    }
  }

  data.runtimes[runtime] = {
    runtime,
    totalTasks: runtimeTasks.length,
    successfulTasks: successful,
    failedTasks: failed,
    partialTasks: partial,
    successRate: runtimeTasks.length > 0 ? successful / runtimeTasks.length : 0,
    avgDurationMinutes: runtimeTasks.length > 0 ? totalDuration / runtimeTasks.length : 0,
    avgCost: runtimeTasks.length > 0 ? totalCost / runtimeTasks.length : 0,
    totalCost,
    totalTokens,
    byCapability,
    byModel,
    dailyStats,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get metrics for a specific runtime
 */
export function getRuntimeMetricsSync(runtime: RuntimeType): RuntimeMetrics | null {
  const data = loadMetricsSync();
  return data.runtimes[runtime] || null;
}

/**
 * Get metrics for all runtimes
 */
export function getAllRuntimeMetricsSync(): Partial<Record<RuntimeType, RuntimeMetrics>> {
  const data = loadMetricsSync();
  return data.runtimes;
}

/**
 * Get aggregated metrics across all runtimes
 */
export function getAggregatedMetricsSync(): {
  totalTasks: number;
  totalCost: number;
  totalTokens: number;
  avgSuccessRate: number;
  avgDuration: number;
  byRuntime: Partial<Record<RuntimeType, RuntimeMetrics>>;
} {
  const data = loadMetricsSync();
  const runtimes = Object.values(data.runtimes).filter((r): r is RuntimeMetrics => r !== undefined);

  const totalTasks = runtimes.reduce((sum, r) => sum + r.totalTasks, 0);
  const totalCost = runtimes.reduce((sum, r) => sum + r.totalCost, 0);
  const totalTokens = runtimes.reduce((sum, r) => sum + r.totalTokens, 0);
  const totalSuccessful = runtimes.reduce((sum, r) => sum + r.successfulTasks, 0);
  const totalDuration = runtimes.reduce((sum, r) => sum + (r.avgDurationMinutes * r.totalTasks), 0);

  return {
    totalTasks,
    totalCost,
    totalTokens,
    avgSuccessRate: totalTasks > 0 ? totalSuccessful / totalTasks : 0,
    avgDuration: totalTasks > 0 ? totalDuration / totalTasks : 0,
    byRuntime: data.runtimes,
  };
}

/**
 * Get tasks for a specific issue
 */
export function getIssueTasksSync(issueId: string): TaskRecord[] {
  const data = loadMetricsSync();
  return data.tasks.filter(t => t.issueId === issueId);
}

/**
 * Get recent tasks
 */
export function getRecentTasksSync(limit: number = 50): TaskRecord[] {
  const data = loadMetricsSync();
  return data.tasks
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, limit);
}

/**
 * Clear all metrics (for testing)
 */
export function clearMetricsSync(): void {
  saveMetricsSync({ ...DEFAULT_METRICS });
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants of the sync helpers above. Sync variants are
// preserved so existing CLI callers keep working; new callers can use the
// Effect variants to compose with typed error channels.

/** Tagged error for metrics parse failures. */
export class MetricsParseError extends Data.TaggedError('MetricsParseError')<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `loadMetrics`. Returns DEFAULT_METRICS on any failure. */
export const loadMetrics = (): Effect.Effect<MetricsData> =>
  Effect.try({
    try: () => loadMetricsSync(),
    catch: () => null,
  }).pipe(Effect.orElseSucceed(() => ({ ...DEFAULT_METRICS })));

/** Effect variant of `saveMetrics`. Lifts FS errors into the FsError channel. */
export const saveMetrics = (data: MetricsData): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => saveMetricsSync(data),
    catch: (cause) =>
      new FsError({ path: METRICS_FILE, operation: 'write', cause }),
  });

/** Effect variant of `recordTask`. Lifts FS errors into the FsError channel. */
export const recordTask = (
  task: Omit<TaskRecord, 'id'>,
): Effect.Effect<TaskRecord, FsError> =>
  Effect.try({
    try: () => recordTaskSync(task),
    catch: (cause) =>
      new FsError({ path: METRICS_FILE, operation: 'recordTask', cause }),
  });

/** Effect variant of `getRuntimeMetrics`. */
export const getRuntimeMetrics = (
  runtime: RuntimeType,
): Effect.Effect<RuntimeMetrics | null> =>
  Effect.sync(() => getRuntimeMetricsSync(runtime));

/** Effect variant of `getAllRuntimeMetrics`. */
export const getAllRuntimeMetrics = (): Effect.Effect<
  Partial<Record<RuntimeType, RuntimeMetrics>>
> => Effect.sync(() => getAllRuntimeMetricsSync());

/** Effect variant of `getAggregatedMetrics`. */
export const getAggregatedMetrics = (): Effect.Effect<
  ReturnType<typeof getAggregatedMetricsSync>
> => Effect.sync(() => getAggregatedMetricsSync());

/** Effect variant of `getIssueTasks`. */
export const getIssueTasks = (
  issueId: string,
): Effect.Effect<TaskRecord[]> => Effect.sync(() => getIssueTasksSync(issueId));

/** Effect variant of `getRecentTasks`. */
export const getRecentTasks = (
  limit: number = 50,
): Effect.Effect<TaskRecord[]> => Effect.sync(() => getRecentTasksSync(limit));

/** Effect variant of `clearMetrics`. */
export const clearMetrics = (): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => clearMetricsSync(),
    catch: (cause) =>
      new FsError({ path: METRICS_FILE, operation: 'clearMetrics', cause }),
  });
