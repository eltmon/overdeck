import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ZoneActionStrip } from '../ZoneActionStrip';
import { useZoneAActions } from '../useZoneAActions';
import { DialogProvider } from '../../DialogProvider';
import { useDashboardStore } from '../../../lib/store';

vi.mock('../useZoneAActions', () => ({
  useZoneAActions: vi.fn(),
}));

vi.mock('../../CloseOutIssueButton', () => ({
  CloseOutIssueButton: ({ issueId }: { issueId: string }) => (
    <button data-testid={`zone-a-close-out-${issueId}`}>Close Out</button>
  ),
}));

vi.mock('../../shared/ModelPicker/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [], harnessPolicy: null }),
  HarnessSelect: () => null,
}));

vi.mock('../../../hooks/useSwitchModel', () => ({
  useSwitchModel: () => ({ switchMutation: { mutate: vi.fn() }, isPending: false }),
}));

vi.mock('../../../hooks/useRestartAgent', () => ({
  useRestartAgent: () => ({ restartMutation: { mutate: vi.fn() }, isPending: false }),
}));

const mutation = { isPending: false, isSuccess: false };

function renderStrip(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        {ui}
      </DialogProvider>
    </QueryClientProvider>,
  );
}

function mockZoneState(overrides: Partial<ReturnType<typeof useZoneAActions>> = {}) {
  vi.mocked(useZoneAActions).mockReturnValue({
    workspace: { exists: true } as any,
    reviewStatus: null,
    reviewStatusLoading: false,
    lifecycle: undefined,
    planningState: { hasPlan: false, hasBeads: false, beadsCount: 0, planningComplete: false },
    agentLaunchState: null,
    setAgentLaunchState: vi.fn(),
    startAgentMutation: mutation as any,
    reviewMutation: mutation as any,
    cancelMutation: mutation as any,
    resetSessionMutation: mutation as any,
    reopenMutation: mutation as any,
    createWorkspaceMutation: mutation as any,
    copySettingsMutation: mutation as any,
    syncMainMutation: mutation as any,
    onStartAgent: vi.fn(),
    onReview: vi.fn(),
    onCancel: vi.fn(),
    onResetSession: vi.fn(),
    onReopen: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onCopySettings: vi.fn(),
    onSyncMain: vi.fn(),
    onDismissPending: vi.fn(),
    ...overrides,
  });
}

describe('ZoneActionStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Close Out for verifying-on-main issues', () => {
    mockZoneState();

    renderStrip(<ZoneActionStrip issueId="PAN-1190" issue={{ identifier: 'PAN-1190', state: 'verifying_on_main' } as any} />);

    expect(screen.getByTestId('zone-a-close-out-PAN-1190')).toBeInTheDocument();
  });

  it('does not render Close Out for non-verifying issues', () => {
    mockZoneState();

    renderStrip(<ZoneActionStrip issueId="PAN-1190" issue={{ identifier: 'PAN-1190', state: 'in_progress' } as any} />);

    expect(screen.queryByTestId('zone-a-close-out-PAN-1190')).not.toBeInTheDocument();
  });

  it('renders auto-merge countdown and hides Merge while cooldown is scheduled', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
      useDashboardStore.setState({ rpcConnected: true });
      mockZoneState({
        reviewStatus: {
          readyForMerge: true,
          reviewStatus: 'passed',
          testStatus: 'passed',
          mergeStatus: 'pending',
        } as any,
      });

      renderStrip(
        <ZoneActionStrip
          issueId="PAN-1418"
          issue={{
            identifier: 'PAN-1418',
            state: 'in_review',
            autoMergeScheduled: {
              executeAt: '2026-05-23T12:02:05.000Z',
              scheduledAt: '2026-05-23T12:00:00.000Z',
            },
          } as any}
        />,
      );

      expect(screen.getByText('Auto-merging in')).toBeInTheDocument();
      expect(screen.getByText('2:05')).toBeInTheDocument();
      expect(screen.queryByTestId('merge-btn')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders Merge when no auto-merge cooldown is scheduled', () => {
    mockZoneState({
      reviewStatus: {
        readyForMerge: true,
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'pending',
      } as any,
    });

    renderStrip(<ZoneActionStrip issueId="PAN-1418" issue={{ identifier: 'PAN-1418', state: 'in_review' } as any} />);

    expect(screen.getByTestId('merge-btn')).toBeInTheDocument();
    expect(screen.queryByText('Auto-merging in')).not.toBeInTheDocument();
  });
});
