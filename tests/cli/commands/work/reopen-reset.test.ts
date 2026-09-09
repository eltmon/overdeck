import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetTrackerContext, mockReopenWorkspaceState, mockSpinnerSucceed } = vi.hoisted(() => ({
  mockGetTrackerContext: vi.fn(),
  mockReopenWorkspaceState: vi.fn(),
  mockSpinnerSucceed: vi.fn(),
}));

vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ succeed: mockSpinnerSucceed }),
  }),
}));

vi.mock('../../../../src/lib/reopen.js', () => ({
  reopenWorkspaceState: (...args: unknown[]) => mockReopenWorkspaceState(...args),
}));

vi.mock('../../../../src/lib/cloister/work-agent-prompt.js', () => ({
  getTrackerContext: (...args: unknown[]) => mockGetTrackerContext(...args),
}));

import { resetWorkspaceState } from '../../../../src/cli/commands/reopen.js';

describe('resetWorkspaceState', () => {
  beforeEach(() => {
    mockReopenWorkspaceState.mockReset();
    mockSpinnerSucceed.mockReset();
    mockGetTrackerContext.mockReset();
    mockGetTrackerContext.mockResolvedValue('tracker context');
    mockReopenWorkspaceState.mockReturnValue(Effect.succeed({
      specialistStatesReset: true,
      previousReviewStatus: 'passed',
      previousTestStatus: 'passed',
      previousMergeStatus: 'merged',
      queueItemsRemoved: {},
      continueFileUpdated: false,
    }));
  });

  it('runs the canonical pipeline reset when no local feature workspace exists', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await resetWorkspaceState('PAN-3795', { force: true }, null);

    expect(mockReopenWorkspaceState).toHaveBeenCalledWith('PAN-3795', null, {
      reason: undefined,
      trackerContext: undefined,
    });
    expect(mockSpinnerSucceed).toHaveBeenCalledWith('Canonical pipeline state reset');
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('Workspace breadcrumb skipped');
    expect(output).not.toContain('Specialist states were not modified');
    log.mockRestore();
  });

  it('keeps tracker context and the breadcrumb path for a local feature workspace', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await resetWorkspaceState('PAN-3795', { reason: 'retry' }, '/repo/workspaces/feature-pan-3795');

    expect(mockGetTrackerContext).toHaveBeenCalledWith('PAN-3795', '/repo/workspaces/feature-pan-3795');
    expect(mockReopenWorkspaceState).toHaveBeenCalledWith('PAN-3795', '/repo/workspaces/feature-pan-3795', {
      reason: 'retry',
      trackerContext: 'tracker context',
    });
    log.mockRestore();
  });
});
