import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  getLatestSessionIdSync: vi.fn(),
  hasCompletionMarkerForAgent: vi.fn(),
  claudeSessionTranscriptExists: vi.fn(),
  getPrFacts: vi.fn(),
  sessionExistsSync: vi.fn(),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
  getLatestSessionIdSync: mocks.getLatestSessionIdSync,
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

// PAN-3917: owed rework is the PR's `CHANGES_REQUESTED`, not a status row.
vi.mock('../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExistsSync: mocks.sessionExistsSync,
  sessionExists: vi.fn(),
}));

import { getWorkAgentLifecycleStateSync, issueOwesRework } from '../../../src/lib/work-agent-lifecycle.js';

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

describe('getWorkAgentLifecycleStateSync after handoff (PAN-3334)', () => {
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

  it('reports the handed-off agent as warm-resumable without asking the forge (supersedes PAN-3334)', () => {
    const state = getWorkAgentLifecycleStateSync('agent-pan-3846');

    expect(state.handedOff).toBe(true);
    expect(state.canResumeSession).toBe(true);
    expect(state.recommendedAction).toBe('resume');
    expect(state.reason).toContain('handed off');
    expect(mocks.getPrFacts).not.toHaveBeenCalled();
  });

  it('leaves a non-handed-off stopped agent resumable', () => {
    mocks.hasCompletionMarkerForAgent.mockReturnValue(false);

    const state = getWorkAgentLifecycleStateSync('agent-pan-3846');

    expect(state.handedOff).toBe(false);
    expect(state.canResumeSession).toBe(true);
  });
});
