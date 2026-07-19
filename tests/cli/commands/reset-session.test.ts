import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAgentSessionPointers: vi.fn(async () => ({ cleared: [] })),
  listAgentIdsByPrefixSync: vi.fn(() => [
    'agent-pan-2895-review',
    'agent-pan-2895-review-security',
  ]),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentStateSync: (agentId: string) => ({
    id: agentId,
    workspace: '/tmp/feature-pan-2895',
  }),
  getAgentDir: (agentId: string) => `/tmp/overdeck-agents/${agentId}`,
  getLatestSessionIdSync: (agentId: string) => `${agentId}-session`,
}));

vi.mock('../../../src/lib/agents/session-pointers.js', () => ({
  clearAgentSessionPointers: mocks.clearAgentSessionPointers,
}));

vi.mock('../../../src/lib/overdeck/agents.js', () => ({
  listAgentIdsByPrefixSync: mocks.listAgentIdsByPrefixSync,
}));

vi.mock('../../../src/lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: () => ({ hasLiveTmuxSession: false }),
}));

vi.mock('../../../src/lib/issue-id.js', () => ({
  resolveIssueIdSync: (id: string) => id.toUpperCase(),
}));

import { resetReviewSessionsCommand } from '../../../src/cli/commands/reset-session.js';

describe('resetReviewSessionsCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears the parent review session and every convoy reviewer session', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await resetReviewSessionsCommand('pan-2895');

    expect(mocks.listAgentIdsByPrefixSync).toHaveBeenCalledWith('agent-pan-2895-review');
    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledTimes(2);
    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledWith('agent-pan-2895-review');
    expect(mocks.clearAgentSessionPointers).toHaveBeenCalledWith('agent-pan-2895-review-security');

    consoleSpy.mockRestore();
  });
});
