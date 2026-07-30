import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLatestSessionIdSync = vi.fn();
const mockExistsSync = vi.fn<(path: string) => boolean>();

vi.mock('../../../../../src/lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/agents.js')>();
  return {
    ...actual,
    getLatestSessionIdSync: (agentId: string) => mockGetLatestSessionIdSync(agentId),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (path: string) => mockExistsSync(path),
  };
});

import { buildStoppedAgentLifecycle } from '../../../../../src/dashboard/server/routes/agents/shared.js';

function stoppedLifecycle(transcriptExists: boolean) {
  mockGetLatestSessionIdSync.mockReturnValue(null);
  mockExistsSync.mockImplementation((path) => {
    // PAN-3334: the lifecycle now probes for a completion marker; these tests
    // are not about handoff, so the marker is always absent here.
    if (/(^|\/)completed(\.processed)?$/.test(path)) return false;
    return transcriptExists;
  });

  return buildStoppedAgentLifecycle(
    'agent-pan-3194',
    {
      id: 'agent-pan-3194',
      issueId: 'PAN-3194',
      workspace: '/tmp/pan-3194-workspace',
      status: 'stopped',
      role: 'work',
      model: 'claude-sonnet-4-6',
      harness: 'claude-code',
    },
    {
      state: 'stopped',
      claudeSessionId: 'session-pan-3194',
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildStoppedAgentLifecycle transcript probe (PAN-3194)', () => {
  it('offers a fresh start when the saved Claude transcript is missing', () => {
    const lifecycle = stoppedLifecycle(false);

    expect(lifecycle).toMatchObject({
      hasSavedSession: true,
      hasResumableTranscript: false,
      recommendedAction: 'start',
      canStartFresh: true,
      canResumeSession: false,
      canResetSession: false,
      requiresSessionResetBeforeFreshStart: false,
    });
    expect(lifecycle.reason).toContain('jsonl-missing');
  });

  it('preserves the resume offer when the saved Claude transcript exists', () => {
    const lifecycle = stoppedLifecycle(true);

    expect(lifecycle).toMatchObject({
      hasSavedSession: true,
      hasResumableTranscript: true,
      recommendedAction: 'resume',
      canStartFresh: false,
      canResumeSession: true,
      canResetSession: true,
      requiresSessionResetBeforeFreshStart: true,
    });
  });
});
