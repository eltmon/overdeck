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

export interface ProposedPlan {
  id: string;
  plan: string;
  planFilePath?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export type ConversationEvent =
  | { kind: 'messages'; messages: ChatMessage[]; workLog: WorkLogEntry[]; streaming: boolean; proposedPlan?: ProposedPlan }
  | { kind: 'discovering' };
