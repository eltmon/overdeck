// Local type definitions for PAN-451 chat components.
// These mirror the Effect Schema types in packages/contracts/src/rpc.ts but are
// plain TypeScript interfaces so the frontend can use them without resolving
// through the workspace's contracts package symlink.

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  turnId?: string;
  createdAt: string;
  completedAt?: string;
  streaming?: boolean;
  sequence?: number;
  acknowledged?: boolean;
}

/** A user message whose send POST failed — held in the retry outbox. */
export interface FailedMessage {
  id: string;
  text: string;
  createdAt: string;
}

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  /** Tool result output (populated when tool_result is received). */
  result?: string;
  command?: string;
  changedFiles?: readonly string[];
  tone: 'thinking' | 'tool' | 'info' | 'error';
  toolTitle?: string;
  /** Raw tool_use input dict — drives per-tool expanded rendering (PAN-1459). */
  toolInput?: Record<string, unknown>;
  sequence?: number;
}

export interface ProposedPlan {
  id: string;
  plan: string;
  planFilePath?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export interface CompactBoundary {
  id: string;
  timestamp: string;
  trigger?: string;
  preTokens?: number;
  model?: string;
}

export interface ContextUsage {
  activeBytes: number;
  estimatedTokens: number;
  contextWindow: number;
  percentUsed: number;
  /** Last assistant turn's `usage.input_tokens`. Optional — older payloads omit it. */
  lastInputTokens?: number;
  /** Last assistant turn's `usage.cache_read_input_tokens`. */
  lastCacheReadTokens?: number;
  /** Last assistant turn's `usage.cache_creation_input_tokens`. */
  lastCacheCreationTokens?: number;
  /** Max input+cache observed since the last compact boundary — triggers 1M-context auto-detection. */
  maxObservedInputTokens?: number;
  /** Model the last assistant turn ran under, from JSONL. May differ from the conversation's stored `model`. */
  lastModel?: string | null;
  /** ISO timestamp of the last assistant turn. */
  lastTurnAt?: string | null;
}

export type ConversationEvent =
  | { kind: 'messages'; messages: ChatMessage[]; workLog: WorkLogEntry[]; streaming: boolean; snapshot?: boolean; proposedPlan?: ProposedPlan; compactBoundaries?: CompactBoundary[]; contextUsage?: ContextUsage | null }
  | { kind: 'discovering' };

// ─── Turn Diff Types ─────────────────────────────────────────────────────────
// Mirror T3Code's types from apps/web/src/types.ts

export interface TurnDiffFileChange {
  path: string;
  kind?: string;
  additions?: number;
  deletions?: number;
}

export interface TurnDiffSummary {
  turnId: string;
  completedAt: string;
  status?: string;
  files: TurnDiffFileChange[];
  checkpointRef?: string;
  assistantMessageId?: string;
  checkpointTurnCount?: number;
}
