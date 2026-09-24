import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

import { isUnsupported } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3920 W1. The tmux adapter names an agent only for an Overdeck session —
 * one with agent state or a managed name — so a stray session on the socket
 * never becomes a directory row.
 */

const sessions = ['agent-pan-1', 'conv-flywheel', 'scratch', 'custom-with-state'].map((name) => (
  { name, created: new Date(), attached: false, windows: 1 }
));

vi.mock('../../../../src/lib/tmux.js', () => ({
  listSessions: () => Effect.succeed(sessions),
}));
vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  isAliveOnTmux: async () => ({ alive: true, paneAlive: true }),
  isIdle: () => false,
}));
vi.mock('../../../../src/lib/agents/agent-state-read.js', () => ({
  getAgentState: (name: string) => (name === 'custom-with-state'
    ? { issueId: 'PAN-2', role: 'work', model: 'm', harness: 'claude-code' }
    : null),
}));

const { TmuxBackend } = await import('../../../../src/lib/terminal-backends/tmux.js');

describe('TmuxBackend.list — agentId', () => {
  it('sets agentId for managed names and sessions with agent state only', async () => {
    const result = await Effect.runPromise(new TmuxBackend().list());
    if (isUnsupported(result)) throw new Error('list() unsupported');
    const byPane = new Map(result.map((snapshot) => [snapshot.paneId, snapshot]));
    expect(byPane.get('agent-pan-1')?.agentId).toBe('agent-pan-1');
    expect(byPane.get('conv-flywheel')?.agentId).toBe('conv-flywheel');
    expect(byPane.get('custom-with-state')?.agentId).toBe('custom-with-state');
    expect(byPane.get('scratch')).not.toHaveProperty('agentId');
  });
});
