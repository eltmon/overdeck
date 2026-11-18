/**
 * PAN-5541 WI-7: useLiveDockItems's needsYouIds folds in every pending agent
 * request's issue id, alongside the existing pending-input subjects.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const usePendingInputSubjectsMock = vi.fn(() => [] as unknown[]);
const usePendingAgentRequestDecisionsMock = vi.fn(() => ({ decisions: [] as unknown[], isFetched: true }));
vi.mock('../../../lib/useDecisions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/useDecisions')>()),
  usePendingInputSubjects: () => usePendingInputSubjectsMock(),
  usePendingAgentRequestDecisions: () => usePendingAgentRequestDecisionsMock(),
}));

import { useLiveDockItems } from '../ConversationDock';
import { useConvoDock } from '../../../lib/convoDock';
import { useDashboardStore } from '../../../lib/store';

function reset() {
  useConvoDock.setState({ items: [], expanded: false });
  useDashboardStore.setState({ agentsById: {}, issuesRaw: [] } as Parameters<typeof useDashboardStore.setState>[0]);
  usePendingInputSubjectsMock.mockReturnValue([]);
  usePendingAgentRequestDecisionsMock.mockReturnValue({ decisions: [], isFetched: true });
}

describe('useLiveDockItems needsYouIds (PAN-5541)', () => {
  it('contains the pending agent request\'s issue id, lowercased (AC1)', () => {
    reset();
    usePendingAgentRequestDecisionsMock.mockReturnValue({
      decisions: [{
        id: 'req-1',
        source: 'agent',
        label: 'agent-pan-7 · PAN-7',
        kinds: ['secretRequest'],
        since: '',
        blocking: true,
        agentRequest: { id: 'req-1', kind: 'secret', name: 'K', prompt: 'p', agentId: 'agent-pan-7', agentKind: 'agent', issueId: 'PAN-7', expiresAt: '' },
      }],
      isFetched: true,
    });

    const { result } = renderHook(() => useLiveDockItems());
    expect(result.current.needsYouIds.has('pan-7')).toBe(true);
  });

  it('is unchanged when no agent request is pending (AC2)', () => {
    reset();
    const { result } = renderHook(() => useLiveDockItems());
    expect(result.current.needsYouIds).toEqual(new Set());
  });
});
