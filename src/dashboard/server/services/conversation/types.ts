import type { ChatMessage, CompactBoundary, ProposedPlan, WorkLogEntry } from '@overdeck/contracts';

export interface ParseResult {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  /** Byte offset after the last parsed line — pass back for incremental reads. */
  byteOffset: number;
  /** True when the last assistant message has no completedAt and file was modified recently. */
  streaming: boolean;
  /** Total estimated cost in USD computed from assistant message usage data (cache-discount aware). */
  totalCost: number;
  /** Total token throughput (input + output + cache read + cache write) across assistant messages. */
  totalTokens: number;
  /** Last assistant usage observed after the active compact boundary. */
  latestAssistantUsage: LatestAssistantUsage | null;
  /** Byte offset of the active compact boundary used for context-window usage. */
  contextBoundaryOffset: number;
  /** Bytes from the active compact boundary through EOF. */
  contextActiveBytes: number;
  /** Unpaired tool_use entries waiting for tool_result (persist across incremental calls). */
  pendingToolUse: Map<string, WorkLogEntry>;
  /** Pre-arrived tool_result entries waiting for tool_use (persist across incremental calls). */
  unresolvedResults: Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>;
  /** Last sequence number assigned (persist across incremental calls). */
  lastSequence: number;
  /** File modification time in ms from the stat call made during parsing. */
  mtimeMs: number;
  /** Active proposed plan (ExitPlanMode with no matching tool_result yet). */
  proposedPlan?: ProposedPlan;
  /** ExitPlanMode tool_use IDs (persist across incremental calls). */
  planToolUseIds?: Set<string>;
  /** Compact boundary markers detected in the JSONL. */
  compactBoundaries?: CompactBoundary[];
  /** Current permission mode (plan/default/bypassPermissions/acceptEdits). */
  permissionMode?: string;
  /** Map assistant message ID → file paths touched by file-modifying tool_use calls. */
  fileEditsByAssistantId?: Map<string, Array<{ tool: string; filePath: string }>>;
  /** ID of the current pendingAssistant message (carried across incremental parses for file-edit tracking). */
  pendingAssistantId?: string;
  /** Orphaned tool_use entry UUIDs awaiting re-keying (carried across incremental parses). */
  orphanToolUseIds?: Set<string>;
  /**
   * Request/message IDs whose usage has already been counted into totalCost/totalTokens.
   * Claude Code writes one API response across several JSONL lines (text block, tool_use
   * block, …) that each repeat the same `usage`; counting every line double-counts cost.
   * Carried across incremental parses so a response split across read boundaries is counted once.
   */
  countedUsageIds?: Set<string>;
}

/** State carried across incremental parseConversationMessages calls. */
export interface ParseState {
  pendingToolUse: Map<string, WorkLogEntry>;
  unresolvedResults: Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>;
  lastSequence: number;
  planToolUseIds?: Set<string>;
  proposedPlan?: ProposedPlan;
  /** Latest assistant usage observed after the active compact boundary. */
  latestAssistantUsage?: LatestAssistantUsage | null;
  /** Byte offset of the active compact boundary used for context-window usage. */
  contextBoundaryOffset?: number;
  /** Current permission mode (plan/default/bypassPermissions/acceptEdits). */
  permissionMode?: string;
  /** Map assistant message ID → file paths touched by file-modifying tool_use calls in that turn. */
  fileEditsByAssistantId?: Map<string, Array<{ tool: string; filePath: string }>>;
  /** ID of the current pendingAssistant message (carried across incremental parses for file-edit tracking). */
  pendingAssistantId?: string;
  /** Orphaned tool_use entry UUIDs awaiting re-keying (carried across incremental parses). */
  orphanToolUseIds?: Set<string>;
  /** Request/message IDs already counted into cost/tokens (see ParseResult.countedUsageIds). */
  countedUsageIds?: Set<string>;
}

export interface ConversationActivitySummary {
  messages: ChatMessage[];
  streaming: boolean;
  isWorking: boolean;
  /** Tool name of the most recently pending tool call, if any (e.g. "Bash", "Read"). */
  currentTool: string | null;
}

/** Maximum bytes to read in a single incremental chunk (10 MB). */
export const MAX_READ_BYTES = 10 * 1024 * 1024;
export const MAX_FALLBACK_BYTES = 5 * 1024 * 1024;

export interface JsonlUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface JsonlEntry {
  type?: string;
  role?: string;
  message?: {
    id?: string;
    role?: string;
    content?: unknown[] | string;
    model?: string;
    stop_reason?: string | null;
    usage?: JsonlUsage;
  };
  timestamp?: string;
  sessionId?: string;
  uuid?: string;
  /** Claude Code per-API-request id. Stable across the multiple JSONL lines of one response. */
  requestId?: string;
}

export interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface LatestAssistantUsage {
  lastInputTokens: number;
  lastCacheReadTokens: number;
  lastCacheCreationTokens: number;
  maxObservedInputTokens: number;
  lastModel: string | null;
  lastTimestamp: string | null;
}
