import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAgentSessionPointers: vi.fn(async () => ({ cleared: [] })),
  listAgentIdsByPrefix: vi.fn(() => [
    'agent-pan-2895-review',
    'agent-pan-2895-review-security',
  ]),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentState: (agentId: string) => ({
    id: agentId,
    workspace: '/tmp/feature-pan-2895',
  }),
  getAgentDir: (agentId: string) => `/tmp/overdeck-agents/${agentId}`,
  getLatestSessionId: (agentId: string) => `${agentId}-session`,
}));

vi.mock('../../../src/lib/agents/session-pointers.js', () => ({
  clearAgentSessionPointers: mocks.clearAgentSessionPointers,
}));

vi.mock('../../../src/lib/overdeck/agents.js', () => ({
  listAgentIdsByPrefix: mocks.listAgentIdsByPrefix,
}));

vi.mock('../../../src/lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: () => ({ hasLiveTmuxSession: false }),
}));

vi.mock('../../../src/lib/issue-id.js', () => ({
  resolveIssueId: (id: string) => id.toUpperCase(),
}));

import { resetReviewSessionsCommand, resetSessionCommand } from '../../../src/cli/commands/reset-session.js';

describe('resetSessionCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('targets a full agent-… id directly instead of rebuilding from the issue id (PAN-2948)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await resetSessionCommand('agent-min-880-review');

    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledWith('agent-min-880-review');

    consoleSpy.mockRestore();
  });

  it('targets the work agent for a bare issue id', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await resetSessionCommand('pan-2895');

    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledWith('agent-pan-2895');

    consoleSpy.mockRestore();
  });
});

describe('resetReviewSessionsCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears the parent review session and every convoy reviewer session', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await resetReviewSessionsCommand('pan-2895');

    expect(mocks.listAgentIdsByPrefix).toHaveBeenCalledWith('agent-pan-2895-review');
    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledTimes(2);
    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledWith('agent-pan-2895-review');
    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledWith('agent-pan-2895-review-security');

    consoleSpy.mockRestore();
  });
});
