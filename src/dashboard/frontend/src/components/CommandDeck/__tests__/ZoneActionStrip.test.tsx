import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ZoneActionStrip } from '../ZoneActionStrip';
import { useZoneAActions } from '../useZoneAActions';

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

    render(<ZoneActionStrip issueId="PAN-1190" issue={{ identifier: 'PAN-1190', state: 'verifying_on_main' } as any} />);

    expect(screen.getByTestId('zone-a-close-out-PAN-1190')).toBeInTheDocument();
  });

  it('does not render Close Out for non-verifying issues', () => {
    mockZoneState();

    render(<ZoneActionStrip issueId="PAN-1190" issue={{ identifier: 'PAN-1190', state: 'in_progress' } as any} />);

    expect(screen.queryByTestId('zone-a-close-out-PAN-1190')).not.toBeInTheDocument();
  });
});
