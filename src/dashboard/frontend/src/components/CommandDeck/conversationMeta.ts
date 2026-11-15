/**
 * conversationMeta — the words on a flat conversation row's meta line
 * (PAN-5293 F-D15): state · changes · harness (when not Claude Code) · cost.
 * Branch, model, tokens and harness go into the line's tooltip.
 */

import { getRuntimeBehavior, normalizeHarnessName } from '@overdeck/contracts';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { Conversation } from './ConversationList';

/** Compact token count, e.g. 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

/** Trim model IDs to a readable label, e.g. "claude-opus-4-8" → "opus-4-8". */
export function shortModel(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

/** A harness id's declared display name; an unknown future id stays raw. */
export function shortHarness(harness: NonNullable<Conversation['harness']>): string {
  const runtime = normalizeHarnessName(harness);
  return runtime ? getRuntimeBehavior(runtime).displayName : harness;
}

export type ConversationMetaTone = 'additions' | 'deletions' | 'muted';

export interface ConversationMetaPart {
  key: 'state' | 'changes' | 'additions' | 'deletions' | 'uncommitted' | 'harness' | 'cost';
  text: string;
  tone?: ConversationMetaTone;
  /** A tooltip for this part alone. */
  title?: string;
}

export interface ConversationMeta {
  parts: ConversationMetaPart[];
  /** "Branch x · Model y · N tokens · Harness z", for the whole line. */
  title: string;
}

type MetaConversation = Pick<Conversation,
  'pendingInputCount' | 'isWorking' | 'sessionAlive' | 'lastActivityAt' | 'lastAttachedAt' | 'createdAt'
  | 'changeTotals' | 'harness' | 'totalCost' | 'totalTokens' | 'model' | 'branch'>;

function stateWord(conv: MetaConversation, now: Date): string {
  if ((conv.pendingInputCount ?? 0) > 0) return 'Needs you';
  if (conv.isWorking) return 'Working';
  const since = formatRelativeTime(conv.lastActivityAt ?? conv.lastAttachedAt ?? conv.createdAt, now);
  return conv.sessionAlive ? `Idle ${since}` : since;
}

export function conversationMetaParts(conv: MetaConversation, now: Date): ConversationMeta {
  const parts: ConversationMetaPart[] = [{ key: 'state', text: stateWord(conv, now) }];

  const changes = conv.changeTotals;
  if (changes) {
    if (changes.files === 0) {
      parts.push({ key: 'changes', text: 'no file changes', tone: 'muted' });
    } else {
      parts.push({ key: 'additions', text: `+${changes.additions}`, tone: 'additions' });
      parts.push({ key: 'deletions', text: `−${changes.deletions}`, tone: 'deletions' });
      if (changes.uncommittedFiles > 0) {
        parts.push({ key: 'uncommitted', text: `${changes.uncommittedFiles} not committed`, tone: 'muted' });
      }
    }
  }

  const harness = conv.harness ?? 'claude-code';
  const harnessLabel = shortHarness(harness);
  if (harness !== 'claude-code') {
    parts.push({ key: 'harness', text: harnessLabel, title: `Harness: ${harnessLabel}` });
  }

  if (conv.totalCost !== undefined && conv.totalCost > 0) {
    parts.push({
      key: 'cost',
      text: conv.totalCost < 0.01 ? '<$0.01' : `$${conv.totalCost.toFixed(2)}`,
      title: 'Total cost (cache-discount aware)',
    });
  }

  const title = [
    conv.branch ? `Branch ${conv.branch}` : null,
    conv.model ? `Model ${shortModel(conv.model)}` : null,
    conv.totalTokens !== undefined && conv.totalTokens > 0 ? `${formatTokens(conv.totalTokens)} tokens` : null,
    `Harness ${harnessLabel}`,
  ].filter(Boolean).join(' · ');

  return { parts, title };
}
