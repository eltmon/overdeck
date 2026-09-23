import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { HerdrBackend } from '../../../../src/lib/terminal-backends/herdr.js';
import { isUnsupported } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3920 W1. `list()` carries the Overdeck agent id on each snapshot: the
 * pane's `agentId` token first, then Herdr's live agent name — the same
 * precedence `listHerdrAgents` uses — so the dashboard can join a `w1:p1` pane
 * to its agent.
 */

function fakeApi(handler: (method: string) => unknown) {
  return { call: async (method: string) => handler(method) ?? {} };
}

describe('HerdrBackend.list — agentId', () => {
  it('reads the agentId token, then the live agent name', async () => {
    const api = fakeApi((method) => {
      if (method === 'session.snapshot') {
        return {
          snapshot: {
            panes: [
              { pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', agent_status: 'working', tokens: { agentId: 'agent-pan-1', issue: 'PAN-1', role: 'work' } },
              { pane_id: 'w1:p3', terminal_id: 't3', workspace_id: 'w1', agent_status: 'idle' },
            ],
          },
        };
      }
      if (method === 'agent.list') {
        return { agents: [{ pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1', agent_status: 'idle', name: 'conv-x' }] };
      }
      return {};
    });
    const backend = new HerdrBackend(api as never);
    const result = await Effect.runPromise(backend.list());
    if (isUnsupported(result)) throw new Error('list() unsupported');

    const byPane = new Map(result.map((snapshot) => [snapshot.paneId, snapshot]));
    expect(byPane.get('w1:p1')?.agentId).toBe('agent-pan-1');
    expect(byPane.get('w1:p2')?.agentId).toBe('conv-x');
    // A pane Overdeck never stamped and Herdr never named carries no agent id.
    expect(byPane.get('w1:p3')).not.toHaveProperty('agentId');
  });
});
