import { describe, expect, it } from 'vitest';

import type { FlywheelInFlightRow, FlywheelLastTick } from '@overdeck/contracts';

import { buildNeedsYouCards, resolveNeedsYouAction } from '../flywheelNeedsYou';
import type { ConversationPendingInputRow } from '../useDecisions';

function row(overrides: Partial<ConversationPendingInputRow> = {}): ConversationPendingInputRow {
  return { name: 'conv-flywheel', ...overrides };
}

describe('resolveNeedsYouAction (PAN-4751 FR-3)', () => {
  it('reopens the question when conv-flywheel has a pending, unanswered AskUserQuestion', () => {
    const rows = [row({ pendingAskUserQuestion: { toolUseId: 'tu-1', askedAt: '2026-11-01T00:00:00Z', questions: [] } })];
    expect(resolveNeedsYouAction(rows, new Set())).toEqual({ kind: 'reopen-question', toolUseId: 'tu-1' });
  });

  it('shows the tick when there is no conv-flywheel row', () => {
    const rows = [row({ name: 'conv-other', pendingAskUserQuestion: { toolUseId: 'tu-1', askedAt: '2026-11-01T00:00:00Z', questions: [] } })];
    expect(resolveNeedsYouAction(rows, new Set())).toEqual({ kind: 'show-tick' });
  });

  it('shows the tick when the pending question is only on another conversation', () => {
    const rows = [
      row({ pendingAskUserQuestion: undefined }),
      row({ name: 'conv-other', pendingAskUserQuestion: { toolUseId: 'tu-2', askedAt: '2026-11-01T00:00:00Z', questions: [] } }),
    ];
    expect(resolveNeedsYouAction(rows, new Set())).toEqual({ kind: 'show-tick' });
  });

  it('shows the tick when the toolUseId is already in the answered set', () => {
    const rows = [row({ pendingAskUserQuestion: { toolUseId: 'tu-1', askedAt: '2026-11-01T00:00:00Z', questions: [] } })];
    expect(resolveNeedsYouAction(rows, new Set(['tu-1']))).toEqual({ kind: 'show-tick' });
  });

  it('shows the tick when the feed body is not an array', () => {
    expect(resolveNeedsYouAction({}, new Set())).toEqual({ kind: 'show-tick' });
  });

  it('shows the tick for a plan-only row with no AskUserQuestion', () => {
    const rows = [row({ pendingProposedPlan: { toolUseId: 'tu-3', askedAt: '2026-11-01T00:00:00Z', plan: 'do the thing' } })];
    expect(resolveNeedsYouAction(rows, new Set())).toEqual({ kind: 'show-tick' });
  });
});

describe('buildNeedsYouCards (PAN-5283 D14)', () => {
  const tick = (needsYouItems: NonNullable<FlywheelLastTick['needsYouItems']>): FlywheelLastTick => ({
    tick: 41, pick: null, phase: 'watch', inFlight: [], needsYou: needsYouItems.map((item) => item.text).join('; '),
    at: '2026-11-14T14:00:00.000Z', needsYouItems,
  });
  const waiverRow: FlywheelInFlightRow = {
    issueId: 'PAN-5095', title: 'Cost rollup', state: 'working', liveAgents: 0, inTick: true, lastJournal: null,
    blocker: { kind: 'test-removal-waiver', severity: 'needs-you', text: 'test-skip gate failed: needs your test-removal waiver', action: 'waive-test-removal' },
  };
  const startRow: FlywheelInFlightRow = {
    issueId: 'PAN-5300', title: 'New thing', state: 'planned', liveAgents: 0, inTick: false, lastJournal: null,
    blocker: { kind: 'start-failed', severity: 'needs-you', text: 'auto-start failed: spawn timed out', action: 'start-issue' },
  };

  it('buildNeedsYouCards merges a tick item with the row action for the issue it names', () => {
    const cards = buildNeedsYouCards(
      tick([{ text: 'Waive the test removal on PAN-5095', firstRaisedTick: 38, firstRaisedAt: '2026-11-14T13:12:00.000Z', firstRaisedMessageId: 'm38', context: 'the gate failed' }]),
      [waiverRow],
    );
    expect(cards).toEqual([{
      key: 'waive the test removal on pan-5095',
      text: 'Waive the test removal on PAN-5095',
      label: 'Waive the test removal on PAN-5095',
      context: 'the gate failed',
      firstRaisedTick: 38,
      firstRaisedAt: '2026-11-14T13:12:00.000Z',
      messageId: 'm38',
      issueId: 'PAN-5095',
      action: 'waive-test-removal',
    }]);
  });

  it('a free-text item gets no action, and an unnamed action row gets its own card', () => {
    const cards = buildNeedsYouCards(
      tick([{ text: 'Approve the Fly image <https://fly.io/x>', firstRaisedTick: 35, firstRaisedAt: '2026-11-14T13:50:00.000Z' }]),
      [startRow, { ...waiverRow, blocker: null }],
    );
    expect(cards[0]).toMatchObject({ label: 'Approve the Fly image', target: 'https://fly.io/x' });
    expect(cards[0]).not.toHaveProperty('action');
    expect(cards[1]).toEqual({
      key: 'row:PAN-5300', text: 'PAN-5300: auto-start failed: spawn timed out', label: 'PAN-5300: auto-start failed: spawn timed out',
      issueId: 'PAN-5300', action: 'start-issue',
    });
    expect(cards).toHaveLength(2);
  });

  it('returns no cards with no tick and no action rows', () => {
    expect(buildNeedsYouCards(null, [{ ...waiverRow, blocker: null }])).toEqual([]);
  });
});
