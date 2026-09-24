import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  getLatestSessionId: vi.fn(),
  hasCompletionMarkerForAgent: vi.fn(),
  claudeSessionTranscriptExists: vi.fn(),
  getPrFacts: vi.fn(),
  sessionExistsSync: vi.fn(),
  isAlive: vi.fn(),
}));

vi.mock('../../../src/lib/agents.js', async () => {
  const { Effect } = await import('effect');
  return {
    getAgentState: mocks.getAgentState,
    getLatestSessionId: mocks.getLatestSessionId,
    getAgentRuntimeState: () => Effect.succeed(mocks.getAgentRuntimeStateSync()),
    normalizeAgentId: (id: string) => id,
  };
});

// PAN-3926: the classifier asks the backend-aware oracle; never probe the
// host's real terminal backend from a unit test.
vi.mock('../../../src/lib/agents/liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/agents/liveness.js')>()),
  isAlive: mocks.isAlive,
}));

vi.mock('../../../src/lib/agents/supervisor-channels.js', () => ({
  hasCompletionMarkerForAgent: mocks.hasCompletionMarkerForAgent,
}));

vi.mock('../../../src/lib/runtimes/storage/claude-code.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/runtimes/storage/claude-code.js')>()),
  claudeSessionTranscriptExists: mocks.claudeSessionTranscriptExists,
}));

// PAN-3917: owed rework is the PR's `CHANGES_REQUESTED`, not a status row.
vi.mock('../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExistsSync: mocks.sessionExistsSync,
  sessionExists: vi.fn(),
}));

import { getWorkAgentLifecycleState, issueOwesRework } from '../../../src/lib/work-agent-lifecycle.js';

describe('issueOwesRework', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is true when the PR has changes requested', async () => {
    mocks.getPrFacts.mockResolvedValue({ changesRequested: true });
    await expect(issueOwesRework('PAN-3846')).resolves.toBe(true);
  });

  it('is false for an approved PR, a forge error, and no issue id', async () => {
    mocks.getPrFacts.mockResolvedValue({ changesRequested: false });
    await expect(issueOwesRework('PAN-3846')).resolves.toBe(false);
    mocks.getPrFacts.mockRejectedValue(new Error('gh exploded'));
    await expect(issueOwesRework('PAN-3846')).resolves.toBe(false);
    await expect(issueOwesRework(undefined)).resolves.toBe(false);
  });
});

describe('getWorkAgentLifecycleState after handoff (PAN-3334)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentState.mockReturnValue({
      id: 'agent-pan-3846',
      issueId: 'PAN-3846',
      workspace: '/tmp',
      harness: 'claude-code',
      model: 'claude-sonnet-5',
      status: 'stopped',
    });
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.getLatestSessionId.mockReturnValue('session-3846');
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
    mocks.getPrFacts.mockResolvedValue({ changesRequested: false });
    mocks.claudeSessionTranscriptExists.mockReturnValue(true);
    mocks.hasCompletionMarkerForAgent.mockReturnValue(true);
  });

  it('reports the handed-off agent as warm-resumable when its PR owes no rework (supersedes PAN-3334)', async () => {
    const state = await getWorkAgentLifecycleState('agent-pan-3846');

    expect(state.handedOff).toBe(true);
    expect(state.canResumeSession).toBe(true);
    expect(state.recommendedAction).toBe('resume');
    expect(state.reason).toContain('handed off');
    expect(mocks.getPrFacts).toHaveBeenCalledWith('PAN-3846');
  });

  it('leaves a non-handed-off stopped agent resumable', async () => {
    mocks.hasCompletionMarkerForAgent.mockReturnValue(false);

    const state = await getWorkAgentLifecycleState('agent-pan-3846');

    expect(state.handedOff).toBe(false);
    expect(state.canResumeSession).toBe(true);
  });
});
