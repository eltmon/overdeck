import type { LegacyConversation as Conversation } from '../overdeck/conversations.js';
import type { RuntimeName } from '../runtimes/types.js';

export interface CompactSummaryOptions {
  model?: string;
  richMode?: boolean;
  includeThinking?: boolean;
  harness?: RuntimeName;
  timeoutMs?: number;
}

export interface ConversationTranscriptAdapter {
  readonly name: RuntimeName;
  readonly supportsPlainForkAsSource: boolean;
  readonly supportsSourceAuthoredHandoff: boolean;
  resolveSessionFile(conv: Conversation): Promise<string | null>;
  serializeTranscript(sessionFile: string, options?: { includeThinking?: boolean }): Promise<string>;
  compactSummary(
    sessionFile: string,
    options?: CompactSummaryOptions,
  ): Promise<{ summary: string; summaryModel: string | null }>;
}
