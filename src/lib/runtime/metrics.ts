/**
 * Runtime Metrics Tracking
 *
 * Track performance metrics per runtime for comparison and analysis.
 */

import { RuntimeType } from './interface.js';

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

