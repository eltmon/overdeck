import { describe, expect, it } from 'vitest';

import { resolveNeedsYouAction } from '../flywheelNeedsYou';
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
