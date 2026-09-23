import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { HerdrBackend } from '../../../../src/lib/terminal-backends/herdr.js';
import { isUnsupported } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3920 W1. `list()` carries the Overdeck agent id on each snapshot: the
 * pane's `agentId` token first, then Herdr's live agent name — but the name
 * only on a pane that carries Overdeck tokens. Herdr names every agent it
 * detects (`codex-1`, `claude-1`), the operator's own panes included, and
 * those must not become directory rows.
 */

function fakeApi(handler: (method: string) => unknown) {
  return { call: async (method: string) => handler(method) ?? {} };
}

describe('HerdrBackend.list — agentId', () => {
  it('reads the agentId token, then the live name of an Overdeck-tokened agent', async () => {
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
        return {
          agents: [
            { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1', agent_status: 'idle', name: 'agent-pan-2', tokens: { issue: 'PAN-2', role: 'work' } },
            // The operator's own codex pane: Herdr named it, Overdeck never stamped it.
            { pane_id: 'w1:p4', terminal_id: 't4', workspace_id: 'w1', agent_status: 'working', name: 'codex-1' },
          ],
        };
      }
      return {};
    });
    const backend = new HerdrBackend(api as never);
    const result = await Effect.runPromise(backend.list());
    if (isUnsupported(result)) throw new Error('list() unsupported');

    const byPane = new Map(result.map((snapshot) => [snapshot.paneId, snapshot]));
    expect(byPane.get('w1:p1')?.agentId).toBe('agent-pan-1');
    expect(byPane.get('w1:p2')?.agentId).toBe('agent-pan-2');
    expect(byPane.get('w1:p4')).not.toHaveProperty('agentId');
    expect(byPane.get('w1:p3')).not.toHaveProperty('agentId');
  });
});
