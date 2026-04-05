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
}

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  changedFiles?: string[];
  tone: 'thinking' | 'tool' | 'info' | 'error';
  toolTitle?: string;
}

export type ConversationEvent =
  | { kind: 'messages'; messages: ChatMessage[]; workLog: WorkLogEntry[]; streaming: boolean }
  | { kind: 'discovering' };
