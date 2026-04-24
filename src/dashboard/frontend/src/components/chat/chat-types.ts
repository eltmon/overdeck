// Local type definitions for PAN-451 chat components.
// These mirror the Effect Schema types in packages/contracts/src/rpc.ts but are
// plain TypeScript interfaces so the frontend can use them without resolving
// through the workspace's contracts package symlink.

export type OutboxStatus = 'sending' | 'queued' | 'stalled' | 'failed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  turnId?: string;
  createdAt: string;
  completedAt?: string;
  streaming?: boolean;
  sequence?: number;
  /** Set only for client-side outbox entries (messages not yet confirmed by server JSONL). */
  outboxStatus?: OutboxStatus;
  /** Stable client id used for retry/discard operations on outbox entries. */
  outboxId?: string;
  /** Last transport error text when outboxStatus === 'failed'. */
  outboxError?: string;
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
  sequence?: number;
}

export type ConversationEvent =
  | { kind: 'messages'; messages: ChatMessage[]; workLog: WorkLogEntry[]; streaming: boolean }
  | { kind: 'discovering' };
