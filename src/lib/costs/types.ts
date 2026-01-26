/**
 * Cost Tracking Types
 *
 * Type definitions for the event-sourced cost tracking system.
 */

/**
 * Cost event logged after each Claude Code API response
 */
export interface CostEvent {
  /** Timestamp in ISO 8601 format */
  ts: string;

  /** Agent ID (e.g., "agent-pan-74" or "agent-pan-74-subagent-aa82e20") */
  agent: string;

  /** Input tokens consumed */
  input: number;

  /** Output tokens generated */
  output: number;

  /** Cache read tokens (prompt cache hits) */
  cache_read: number;

  /** Cache write tokens (prompt cache creation) */
  cache_write: number;

  /** Model used (e.g., "claude-sonnet-4", "claude-haiku-4-5") */
  model: string;

  /** Issue ID extracted from agent name (optional for manual sessions) */
  issueId?: string;
}

/**
 * Aggregated cost data for a single issue
 */
export interface IssueCostData {
  /** Total cost in USD */
  totalCost: number;

  /** Total input tokens */
  inputTokens: number;

  /** Total output tokens */
  outputTokens: number;

  /** Total cache read tokens */
  cacheReadTokens: number;

  /** Total cache write tokens */
  cacheWriteTokens: number;

  /** Cost breakdown by model */
  models: Record<string, number>;

  /** Number of cost events recorded for this issue */
  eventCount: number;

  /** Last time this issue's costs were updated */
  lastUpdated: string;
}

/**
 * Pre-computed aggregation cache
 */
export interface CostCache {
  /** Cache format version (for migrations) */
  version: number;

  /** Timestamp of last processed event */
  lastEventTs: string;

  /** Line number of last processed event (for incremental updates) */
  lastEventLine: number;

  /** Cost data by issue ID */
  issues: Record<string, IssueCostData>;
}

/**
 * Migration state marker
 */
export interface MigrationState {
  /** Whether historical migration has been completed */
  completed: boolean;

  /** Timestamp when migration completed */
  completedAt: string;

  /** Number of workspaces migrated */
  workspaceCount: number;

  /** Number of events created */
  eventCount: number;

  /** Any errors encountered during migration */
  errors?: string[];
}

/**
 * Hook payload structure (received via stdin)
 */
export interface HookUsagePayload {
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  model: string;
}
