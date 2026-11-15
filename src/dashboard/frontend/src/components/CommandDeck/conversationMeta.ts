/**
 * conversationMeta — the words on a flat conversation row's meta line
 * (PAN-5293 F-D15): state · changes · harness (when not Claude Code) · cost.
 * Branch, model, tokens and harness go into the line's tooltip.
 */

import { getRuntimeBehavior, normalizeHarnessName, type ConversationChangeTotals } from '@overdeck/contracts';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { shortModel } from './modelLabels';

/** Compact token count, e.g. 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

/** A harness id's declared display name; an unknown future id stays raw. */
export function shortHarness(harness: string): string {
  const runtime = normalizeHarnessName(harness);
  return runtime ? getRuntimeBehavior(runtime).displayName : harness;
}

/**
 * The harness's display label, or null for the default (Claude Code) — the
 * one harness-name comparison UI call sites share (PAN-4562), so a second
 * caller (e.g. the New conversation button's summary line, PAN-5335) reuses
 * this instead of adding its own branch.
 */
export function nonDefaultHarnessLabel(harness: string): string | null {
  return harness !== 'claude-code' ? shortHarness(harness) : null;
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

/**
 * The conversation fields the meta line reads. Structural, so this module
 * does not import ConversationList (ConversationRow imports this module).
 */
export interface MetaConversation {
  pendingInputCount?: number;
  isWorking?: boolean;
  sessionAlive: boolean;
  lastActivityAt?: string | null;
  lastAttachedAt: string | null;
  createdAt: string;
  changeTotals?: ConversationChangeTotals;
  harness?: string | null;
  totalCost?: number;
  totalTokens?: number;
  model?: string | null;
  branch?: string | null;
}

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
  const nonDefaultLabel = nonDefaultHarnessLabel(harness);
  if (nonDefaultLabel !== null) {
    parts.push({ key: 'harness', text: nonDefaultLabel, title: `Harness: ${nonDefaultLabel}` });
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
