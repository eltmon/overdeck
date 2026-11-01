/**
 * The usage-limit state of a conversation and the outcome of a scheduled
 * delivery, both read from the Claude Code transcript tail (PAN-4641 WI-3,
 * FR-3 and the parsing half of FR-9).
 *
 * `readConversationUsageLimit` answers "is this conversation waiting on a
 * limit, and until when": the last main-chain user/assistant record must be a
 * usage-limit error. `deliveryOutcomeFromTranscriptTail` answers "did the
 * message pasted at `sentAtMs` land": the newest main-chain assistant record
 * after the paste decides. Both reuse `providerErrorFromTranscriptTail` so the
 * classification of a limit record lives in one place.
 */
import type { HarnessTranscriptKind } from '@overdeck/contracts';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { providerErrorFromTranscriptTail, readTranscriptTail, type ConversationUsageLimit } from './conversation-provider-error.js';
import { isVaultBrowseConversation } from './conversation-vault-rows.js';
import type { LegacyConversation as Conversation } from './conversations.js';

export interface ConversationLimitState {
  /** False once `resetsAt` has passed; true while it is in the future or unknown. */
  limited: boolean;
  resetsAt: string | null;
  window: string | null;
  source: 'quota-limits' | 'message-text' | null;
  /** The error record's timestamp. */
  errorAt: string;
}

export interface UsageLimitDeps {
  resolveSessionFile?: (conv: Conversation) => Promise<string | null>;
  readTail?: (path: string) => Promise<{ text: string; cutFirstLine: boolean } | null>;
  now?: () => number;
}

export type DeliveryOutcome =
  | { kind: 'waiting' }
  | { kind: 'confirmed' }
  | { kind: 'limited-again'; usageLimit: ConversationUsageLimit };

type JsonRecord = { [key: string]: unknown };

/**
 * Transcript formats Overdeck reads usage-limit records from (D2). Only Claude
 * Code writes `quotaLimits` / `resets …` on its limit records today; a new
 * transcript kind must decide here.
 */
const USAGE_LIMIT_READER: Record<HarnessTranscriptKind, boolean> = {
  'claude-jsonl': true,
  'ohmypi-jsonl': false,
  'codex-rollout-jsonl': false,
  'acp-jsonl': false,
  'kimi-wire-jsonl': false,
  'muse-jsonl': false,
  'prime-agent-jsonl': false,
};

/** Whether `conv` can have scheduled messages: its transcript has a usage-limit reader and it is not a vault browse copy. */
export function conversationSupportsScheduledMessages(conv: Conversation): boolean {
  if (isVaultBrowseConversation(conv)) return false;
  return USAGE_LIMIT_READER[getHarnessBehavior(conv.harness).transcriptKind];
}

async function defaultResolveSessionFile(conv: Conversation): Promise<string | null> {
  // Lazy: conversation-reads pulls in the dashboard transcript parsers.
  const { resolveSessionFile } = await import('./conversation-reads.js');
  return resolveSessionFile(conv);
}

async function readConversationTail(conv: Conversation, deps: UsageLimitDeps): Promise<{ text: string; cutFirstLine: boolean } | null> {
  const path = await (deps.resolveSessionFile ?? defaultResolveSessionFile)(conv);
  if (!path) return null;
  return (deps.readTail ?? readTranscriptTail)(path);
}

export async function readConversationUsageLimit(conv: Conversation, deps: UsageLimitDeps = {}): Promise<ConversationLimitState | null> {
  if (!conversationSupportsScheduledMessages(conv)) return null;
  const tail = await readConversationTail(conv, deps);
  if (!tail) return null;
  const error = providerErrorFromTranscriptTail(tail.text, tail.cutFirstLine);
  if (!error?.usageLimit) return null;
  const { resetsAt, window, source } = error.usageLimit;
  const now = (deps.now ?? Date.now)();
  return {
    limited: resetsAt === null || Date.parse(resetsAt) > now,
    resetsAt,
    window,
    source,
    errorAt: error.at,
  };
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

/**
 * Walks the tail newest-first over main-chain user/assistant records with
 * timestamp > sentAtMs. The newest such assistant record decides: a
 * usage-limit error → `limited-again`, anything else → `confirmed`. User
 * records alone (the pasted message, tool results) mean `waiting`.
 */
export function deliveryOutcomeFromTranscriptTail(text: string, cutFirstLine: boolean, sentAtMs: number): DeliveryOutcome {
  const lines = text.split('\n');
  if (cutFirstLine) lines.shift();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    let record: JsonRecord | null;
    try {
      record = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (!record) continue;
    if (record['isSidechain'] === true) continue;
    const type = record['type'];
    if (type !== 'user' && type !== 'assistant') continue;
    const at = typeof record['timestamp'] === 'string' ? Date.parse(record['timestamp']) : Number.NaN;
    // Newest-first: the first record at or before the paste ends the walk.
    if (!(at > sentAtMs)) return { kind: 'waiting' };
    if (type === 'user') continue;
    const usageLimit = providerErrorFromTranscriptTail(line, false)?.usageLimit ?? null;
    return usageLimit ? { kind: 'limited-again', usageLimit } : { kind: 'confirmed' };
  }
  return { kind: 'waiting' };
}

export async function readDeliveryOutcome(conv: Conversation, sentAtMs: number, deps: UsageLimitDeps = {}): Promise<DeliveryOutcome> {
  const tail = await readConversationTail(conv, deps);
  if (!tail) return { kind: 'waiting' };
  return deliveryOutcomeFromTranscriptTail(tail.text, tail.cutFirstLine, sentAtMs);
}
