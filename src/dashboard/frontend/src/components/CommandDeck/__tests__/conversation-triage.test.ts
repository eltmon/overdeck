/** PAN-4639 WI-4: pure triage helpers — section placement, snooze presets, wake label. */
import { describe, expect, it } from 'vitest';

import type { ConversationTreeNode } from '../conversation-tree';
import {
  type TriageConversation,
  SECTION_ORDER,
  formatSnoozeWake,
  groupNeedsYou,
  isSnoozed,
  partitionConversationSections,
  sectionOf,
  snoozePresets,
} from '../conversation-triage';

let nextId = 1;

function conv(extra: Partial<TriageConversation> = {}): TriageConversation {
  const id = nextId++;
  return {
    id,
    createdAt: new Date(2026, 9, 1, 10, 0, 0).toISOString(),
    sessionAlive: false,
    ...extra,
  };
}

function node(conversation: TriageConversation, descendants: ConversationTreeNode<TriageConversation>[] = []): ConversationTreeNode<TriageConversation> {
  return { conv: conversation, depth: 0, naturalDepth: 0, descendants, orphanOf: null, flattenedFrom: null, criticOf: null };
}

function descendant(conversation: TriageConversation): ConversationTreeNode<TriageConversation> {
  return { conv: conversation, depth: 1, naturalDepth: 1, descendants: [], orphanOf: null, flattenedFrom: null, criticOf: null };
}

const NOW = Date.parse('2026-10-05T12:00:00.000Z'); // a Monday

describe('isSnoozed', () => {
  it('is true only for a future, parseable snoozedUntil', () => {
    expect(isSnoozed(conv({ snoozedUntil: new Date(NOW + 1000).toISOString() }), NOW)).toBe(true);
    expect(isSnoozed(conv({ snoozedUntil: new Date(NOW - 1000).toISOString() }), NOW)).toBe(false);
    expect(isSnoozed(conv({ snoozedUntil: null }), NOW)).toBe(false);
    expect(isSnoozed(conv(), NOW)).toBe(false);
  });
});

describe('groupNeedsYou', () => {
  it('is true when the root has a pending input', () => {
    expect(groupNeedsYou(node(conv({ pendingInputCount: 1 })))).toBe(true);
  });

  it('is true when a descendant has a pending input, even with a quiet root', () => {
    expect(groupNeedsYou(node(conv(), [descendant(conv({ pendingInputCount: 1 }))]))).toBe(true);
  });

  it('is false when neither the root nor any descendant has a pending input', () => {
    expect(groupNeedsYou(node(conv(), [descendant(conv())]))).toBe(false);
  });
});

describe('sectionOf / partitionConversationSections (D6, D9, triage-helpers.ac1, ac2)', () => {
  it('a settled root with a descendant that needs you still lands in needsYou', () => {
    const settledRoot = node(conv({ settledAt: '2026-10-01T00:00:00.000Z' }), [descendant(conv({ pendingInputCount: 1 }))]);
    expect(sectionOf(settledRoot, NOW)).toBe('needsYou');
  });

  it('a snoozed root with a descendant that needs you still lands in needsYou', () => {
    const snoozedRoot = node(conv({ snoozedUntil: new Date(NOW + 1000).toISOString() }), [descendant(conv({ pendingInputCount: 1 }))]);
    expect(sectionOf(snoozedRoot, NOW)).toBe('needsYou');
  });

  it('a root snoozed until a future time lands in snoozed', () => {
    expect(sectionOf(node(conv({ snoozedUntil: new Date(NOW + 1000).toISOString() })), NOW)).toBe('snoozed');
  });

  it('a root whose wake time has passed lands in inbox, not snoozed', () => {
    expect(sectionOf(node(conv({ snoozedUntil: new Date(NOW - 1000).toISOString() })), NOW)).toBe('inbox');
  });

  it('a settled root with no pending input lands in settled', () => {
    expect(sectionOf(node(conv({ settledAt: '2026-10-01T00:00:00.000Z' })), NOW)).toBe('settled');
  });

  it('an untouched root lands in inbox', () => {
    expect(sectionOf(node(conv()), NOW)).toBe('inbox');
  });

  it('partitions into all four sections in SECTION_ORDER, empty ones included', () => {
    const sections = partitionConversationSections([node(conv())], NOW);
    expect(sections.map((s) => s.id)).toEqual(SECTION_ORDER);
    expect(sections.find((s) => s.id === 'needsYou')?.nodes).toEqual([]);
  });

  it('orders snoozed roots by soonest wake first', () => {
    const later = node(conv({ snoozedUntil: new Date(NOW + 10_000).toISOString() }));
    const sooner = node(conv({ snoozedUntil: new Date(NOW + 1_000).toISOString() }));
    const sections = partitionConversationSections([later, sooner], NOW);
    const snoozed = sections.find((s) => s.id === 'snoozed')!.nodes;
    expect(snoozed.map((n) => n.conv.id)).toEqual([sooner.conv.id, later.conv.id]);
  });

  it('orders settled roots by newest settledAt first', () => {
    const older = node(conv({ settledAt: '2026-09-01T00:00:00.000Z' }));
    const newer = node(conv({ settledAt: '2026-10-01T00:00:00.000Z' }));
    const sections = partitionConversationSections([older, newer], NOW);
    const settled = sections.find((s) => s.id === 'settled')!.nodes;
    expect(settled.map((n) => n.conv.id)).toEqual([newer.conv.id, older.conv.id]);
  });

  it('keeps needsYou and inbox in input order', () => {
    const first = node(conv({ pendingInputCount: 1 }));
    const second = node(conv({ pendingInputCount: 1 }));
    const sections = partitionConversationSections([second, first], NOW);
    const needsYou = sections.find((s) => s.id === 'needsYou')!.nodes;
    expect(needsYou.map((n) => n.conv.id)).toEqual([second.conv.id, first.conv.id]);
  });
});

describe('snoozePresets (D12, triage-helpers.ac3)', () => {
  it('returns hour, evening, tomorrow and nextWeek at 10:00 local', () => {
    const now = new Date(2026, 9, 6, 10, 0, 0); // Tuesday 10:00
    const presets = snoozePresets(now);
    expect(presets.map((p) => p.id)).toEqual(['hour', 'evening', 'tomorrow', 'nextWeek']);

    const hour = presets.find((p) => p.id === 'hour')!;
    expect(hour.until.getTime()).toBe(now.getTime() + 60 * 60 * 1000);

    const evening = presets.find((p) => p.id === 'evening')!;
    expect(evening.until).toEqual(new Date(2026, 9, 6, 18, 0, 0, 0));

    const tomorrow = presets.find((p) => p.id === 'tomorrow')!;
    expect(tomorrow.until).toEqual(new Date(2026, 9, 7, 9, 0, 0, 0));

    const nextWeek = presets.find((p) => p.id === 'nextWeek')!;
    expect(nextWeek.until).toEqual(new Date(2026, 9, 12, 9, 0, 0, 0)); // next Monday
  });

  it('omits evening at 17:30', () => {
    const now = new Date(2026, 9, 6, 17, 30, 0);
    const presets = snoozePresets(now);
    expect(presets.map((p) => p.id)).toEqual(['hour', 'tomorrow', 'nextWeek']);
  });

  it('on a Monday, nextWeek is the following Monday 09:00', () => {
    const monday = new Date(2026, 9, 5, 10, 0, 0); // a Monday
    const presets = snoozePresets(monday);
    const nextWeek = presets.find((p) => p.id === 'nextWeek')!;
    expect(nextWeek.until).toEqual(new Date(2026, 9, 12, 9, 0, 0, 0));
  });
});

describe('formatSnoozeWake (D13, triage-helpers.ac4)', () => {
  const now = new Date(2026, 9, 6, 10, 0, 0); // Tuesday

  it('formats later today as "back today HH:MM"', () => {
    expect(formatSnoozeWake(new Date(2026, 9, 6, 18, 30).toISOString(), now)).toBe('back today 18:30');
  });

  it('formats the next calendar day as "back tomorrow HH:MM"', () => {
    expect(formatSnoozeWake(new Date(2026, 9, 7, 9, 0).toISOString(), now)).toBe('back tomorrow 09:00');
  });

  it('formats 2-6 days out as "back <Ddd> HH:MM"', () => {
    expect(formatSnoozeWake(new Date(2026, 9, 9, 9, 0).toISOString(), now)).toBe('back Fri 09:00');
  });

  it('formats 7+ days out as "back <Mmm> <D> HH:MM"', () => {
    expect(formatSnoozeWake(new Date(2026, 9, 13, 9, 0).toISOString(), now)).toBe('back Oct 13 09:00');
  });
});
