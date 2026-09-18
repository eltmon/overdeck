import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  getLatestSessionIdSync: vi.fn(),
  hasCompletionMarkerForAgent: vi.fn(),
  claudeSessionTranscriptExists: vi.fn(),
  getReviewStatusSync: vi.fn(),
  sessionExistsSync: vi.fn(),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
  getLatestSessionIdSync: mocks.getLatestSessionIdSync,
  getAgentState: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getLatestSessionId: vi.fn(),
  normalizeAgentId: (id: string) => id,
}));

vi.mock('../../../src/lib/agents/supervisor-channels.js', () => ({
  hasCompletionMarkerForAgent: mocks.hasCompletionMarkerForAgent,
}));

vi.mock('../../../src/lib/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/paths.js')>()),
  claudeSessionTranscriptExists: mocks.claudeSessionTranscriptExists,
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExistsSync: mocks.sessionExistsSync,
  sessionExists: vi.fn(),
}));

import { getWorkAgentLifecycleStateSync, issueOwesReworkSync } from '../../../src/lib/work-agent-lifecycle.js';

describe('issueOwesReworkSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for a row whose only failure is uatStatus: failed (PAN-3846)', () => {
    mocks.getReviewStatusSync.mockReturnValue({ uatStatus: 'failed' });
    expect(issueOwesReworkSync('PAN-3846')).toBe(true);
  });

  it('returns false for a clean row, a missing row, and no issue id', () => {
    mocks.getReviewStatusSync.mockReturnValue({ uatStatus: 'passed' });
    expect(issueOwesReworkSync('PAN-3846')).toBe(false);
    mocks.getReviewStatusSync.mockReturnValue(null);
    expect(issueOwesReworkSync('PAN-3846')).toBe(false);
    expect(issueOwesReworkSync(undefined)).toBe(false);
  });
});

describe('getWorkAgentLifecycleStateSync warm-resume after handoff (PAN-3555 + PAN-3846)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-3846',
      issueId: 'PAN-3846',
      workspace: '/tmp',
      harness: 'claude-code',
      model: 'claude-sonnet-5',
      status: 'stopped',
    });
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.getLatestSessionIdSync.mockReturnValue('session-3846');
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.claudeSessionTranscriptExists.mockReturnValue(true);
    mocks.hasCompletionMarkerForAgent.mockReturnValue(true);
  });

  it('recommends the PAN-3555 warm resume when a failed UAT owes rework', () => {
    mocks.getReviewStatusSync.mockReturnValue({ uatStatus: 'failed' });

    const state = getWorkAgentLifecycleStateSync('agent-pan-3846');

    expect(state.handedOff).toBe(true);
    expect(state.owesRework).toBe(true);
    expect(state.recommendedAction).toBe('resume');
    expect(state.reason).toContain('owes it rework');
    expect(state.reason).not.toContain('nothing to resume');
  });

  it('still reports nothing to resume when the row owes no rework', () => {
    mocks.getReviewStatusSync.mockReturnValue({ uatStatus: 'passed' });

    const state = getWorkAgentLifecycleStateSync('agent-pan-3846');

    expect(state.owesRework).toBe(false);
    expect(state.recommendedAction).toBe('none');
    expect(state.reason).toContain('nothing to resume');
  });
});
