/**
 * PAN-4639 WI-4: pure triage helpers for the Command Deck conversation list —
 * section placement (D6, D9), snooze presets (D12) and the wake label (D13).
 * No React. Every `now` is a parameter; nothing here calls Date.now().
 */
import type { ConversationTreeNode, TreeConversation } from './conversation-tree';

/**
 * The row fields these helpers read. A local type (like `TreeConversation`)
 * keeps this module free of an import cycle with the list.
 */
export interface TriageConversation extends TreeConversation {
  settledAt?: string | null;
  settleReason?: 'manual' | 'merge' | 'idle' | null;
  snoozedUntil?: string | null;
}

export type ConversationSectionId = 'needsYou' | 'inbox' | 'snoozed' | 'settled';

export const SECTION_ORDER: readonly ConversationSectionId[] = ['needsYou', 'inbox', 'snoozed', 'settled'];

export interface ConversationSection<C extends TriageConversation> {
  id: ConversationSectionId;
  nodes: ConversationTreeNode<C>[];
}

/** True when `conv.snoozedUntil` parses and is strictly after `now`. */
export function isSnoozed(conv: TriageConversation, now: number): boolean {
  if (!conv.snoozedUntil) return false;
  const until = Date.parse(conv.snoozedUntil);
  return !Number.isNaN(until) && until > now;
}

/** D6 rule 1: the root or any descendant has a pending input. */
export function groupNeedsYou(node: ConversationTreeNode): boolean {
  if ((node.conv.pendingInputCount ?? 0) > 0) return true;
  return node.descendants.some((descendant) => (descendant.conv.pendingInputCount ?? 0) > 0);
}

/** D6: needsYou, else snoozed, else settled, else inbox — decided on the root. */
export function sectionOf<C extends TriageConversation>(node: ConversationTreeNode<C>, now: number): ConversationSectionId {
  if (groupNeedsYou(node)) return 'needsYou';
  if (isSnoozed(node.conv, now)) return 'snoozed';
  if (node.conv.settledAt) return 'settled';
  return 'inbox';
}

/**
 * Input: the tree in today's order. Output: all four sections in
 * SECTION_ORDER (empty ones included), D9 ordering applied: needsYou and
 * inbox keep input order; snoozed orders by soonest wake; settled orders by
 * most recently settled.
 */
export function partitionConversationSections<C extends TriageConversation>(
  nodes: readonly ConversationTreeNode<C>[],
  now: number,
): ConversationSection<C>[] {
  const buckets: Record<ConversationSectionId, ConversationTreeNode<C>[]> = {
    needsYou: [],
    inbox: [],
    snoozed: [],
    settled: [],
  };
  for (const node of nodes) buckets[sectionOf(node, now)].push(node);

  buckets.snoozed.sort((a, b) => (Date.parse(a.conv.snoozedUntil ?? '') || 0) - (Date.parse(b.conv.snoozedUntil ?? '') || 0));
  buckets.settled.sort((a, b) => (Date.parse(b.conv.settledAt ?? '') || 0) - (Date.parse(a.conv.settledAt ?? '') || 0));

  return SECTION_ORDER.map((id) => ({ id, nodes: buckets[id] }));
}

export interface SnoozePreset {
  id: 'hour' | 'evening' | 'tomorrow' | 'nextWeek';
  label: string;
  until: Date;
}

function atLocalTime(base: Date, dayOffset: number, hours: number, minutes: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hours, minutes, 0, 0);
}

/** D12. `evening` is omitted once it's at or after 17:00 local. */
export function snoozePresets(now: Date): SnoozePreset[] {
  const presets: SnoozePreset[] = [{ id: 'hour', label: '1 hour', until: new Date(now.getTime() + 60 * 60 * 1000) }];

  if (now.getHours() < 17) {
    presets.push({ id: 'evening', label: 'This evening', until: atLocalTime(now, 0, 18, 0) });
  }
  presets.push({ id: 'tomorrow', label: 'Tomorrow morning', until: atLocalTime(now, 1, 9, 0) });

  // Next Monday strictly after today's date; a Monday itself snoozes to the following Monday.
  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  presets.push({ id: 'nextWeek', label: 'Next week', until: atLocalTime(now, daysUntilMonday, 9, 0) });

  return presets;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "today HH:MM" / "tomorrow HH:MM" / "<Ddd> HH:MM" within 7 days, else "<Mmm> <D> HH:MM". 24-hour, local. */
export function formatLocalWhen(iso: string, now: Date): string {
  const when = new Date(iso);
  const time = `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
  const dayDiff = Math.round((startOfLocalDay(when) - startOfLocalDay(now)) / 86_400_000);

  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `tomorrow ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `${WEEKDAY_NAMES[when.getDay()]} ${time}`;
  return `${MONTH_NAMES[when.getMonth()]} ${when.getDate()} ${time}`;
}

/** D13: "back " + formatLocalWhen. */
export function formatSnoozeWake(untilIso: string, now: Date): string {
  return `back ${formatLocalWhen(untilIso, now)}`;
}
