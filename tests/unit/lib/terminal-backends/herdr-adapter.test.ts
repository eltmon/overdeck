import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';

import { HerdrBackend, toAgentState, toBackendEvents, tokenPayload } from '../../../../src/lib/terminal-backends/herdr.js';
import { HerdrApiError } from '../../../../src/lib/terminal-backends/herdr-api.js';
import { resetPromptGuard } from '../../../../src/lib/terminal-backends/prompt-guard.js';
import { isUnsupported } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3917 W8. Adapter behaviour that the wire recordings pin down: which
 * Herdr events become contract events, and what a stalled prompt means.
 */

interface Call { method: string; params: Record<string, unknown> }

function fakeApi(handler: (call: Call) => unknown, log: Call[] = []) {
  return {
    log,
    api: {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        const result = handler({ method, params });
        if (result instanceof Error) throw result;
        return result ?? {};
      },
    },
  };
}

beforeEach(() => {
  resetPromptGuard();
});

describe('toBackendEvents', () => {
  it('reads agent state from pane_updated, which is where Herdr reports it', () => {
    // Recorded live 2026-09-18: the global pane.agent_status_changed
    // subscription needs a pane id, so the workspace-wide stream carries status
    // transitions inside pane_updated instead.
    const events = toBackendEvents('pane_updated', {
      pane: { pane_id: 'w2:p2', terminal_id: 't', workspace_id: 'w2', agent: 'claude', agent_status: 'idle' },
    });
    expect(events).toEqual([{ kind: 'agent-state', paneId: 'w2:p2', state: 'idle' }]);
  });

  it('emits both state and metadata when a pane_updated carries tokens', () => {
    const events = toBackendEvents('pane_updated', {
      pane: {
        pane_id: 'w2:p2', terminal_id: 't', workspace_id: 'w2',
        agent_status: 'working', tokens: { issue: 'PAN-3917', role: 'work' },
      },
    });
    expect(events.map((event) => event.kind)).toEqual(['agent-state', 'metadata']);
  });

  it('maps creation, exit and workspace close', () => {
    expect(toBackendEvents('pane_created', { pane: { pane_id: 'w1:p1', terminal_id: 't', workspace_id: 'w1' } }))
      .toEqual([{ kind: 'pane-created', paneId: 'w1:p1', workspaceId: 'w1' }]);
    expect(toBackendEvents('pane_exited', { pane_id: 'w1:p1' }))
      .toEqual([{ kind: 'pane-exited', paneId: 'w1:p1', code: null }]);
    expect(toBackendEvents('workspace_closed', { workspace_id: 'w1' }))
      .toEqual([{ kind: 'workspace-closed', workspaceId: 'w1' }]);
    expect(toBackendEvents('layout_updated', {})).toEqual([]);
  });

  it('keeps Herdr states and reserves unknown for anything else', () => {
    expect(toAgentState('blocked')).toBe('blocked');
    expect(toAgentState('done')).toBe('done');
    expect(toAgentState(undefined)).toBe('unknown');
  });

  it('drops absent tokens so an operator pane carries no issue', () => {
    expect(tokenPayload({ role: 'work', harness: 'claude-code', model: 'claude-opus-5' }))
      .toEqual({ role: 'work', harness: 'claude-code', model: 'claude-opus-5' });
  });
});

describe('HerdrBackend.prompt on a stalled wait', () => {
  const sender = { id: 'conv-2781' };

  it('reports delivered — a stalled wait is not proof the text never landed', async () => {
    const { api, log } = fakeApi(({ method }) => {
      if (method === 'agent.get') return { agent: { pane_id: 'w1:p2', agent_status: 'idle', tokens: {} } };
      if (method === 'agent.prompt') {
        return new HerdrApiError({
          method,
          code: 'agent_prompt_stalled',
          message: 'agent prompt produced no observed working or blocked state within 5000 ms',
        });
      }
      return {};
    });

    const result = await Effect.runPromise(
      new HerdrBackend(api as never).prompt({ agentName: 'a' }, 'hello', { messageId: 'm1', sender, wait: {} }),
    );
    expect(result).toMatchObject({ delivered: true, messageId: 'm1', state: 'idle' });
    // Exactly one prompt: the adapter must never re-send after a stall.
    expect(log.filter((call) => call.method === 'agent.prompt')).toHaveLength(1);
  });

  it('keeps agent_blocked an error — Herdr refuses before writing any input', async () => {
    const { api } = fakeApi(({ method }) => {
      if (method === 'agent.get') return { agent: { pane_id: 'w1:p2', agent_status: 'blocked', tokens: {} } };
      if (method === 'agent.prompt') {
        return new HerdrApiError({ method, code: 'agent_blocked', message: 'agent is blocked' });
      }
      return {};
    });

    await expect(
      Effect.runPromise(new HerdrBackend(api as never).prompt({ agentName: 'a' }, 'hello', { messageId: 'm2', sender })),
    ).rejects.toMatchObject({ message: expect.stringContaining('agent_blocked') });
  });
});

describe('HerdrBackend.resume', () => {
  it('is unsupported with the protocol reason', async () => {
    const result = await Effect.runPromise(new HerdrBackend({ call: async () => ({}) } as never).resume({
      backend: 'herdr', workspaceId: 'w1', paneId: 'w1:p2', terminalId: 't', agentName: 'a',
    }));
    expect(isUnsupported(result)).toBe(true);
    if (isUnsupported(result)) expect(result.reason).toContain('resume');
  });
});

describe('HerdrBackend.workspaceFor', () => {
  it('reuses the workspace whose issue token matches, and stamps a new one', async () => {
    const existing = fakeApi(({ method }) =>
      method === 'workspace.list' ? { workspaces: [{ workspace_id: 'w7', tokens: { issue: 'PAN-3917' } }] } : {});
    const reused = await Effect.runPromise(new HerdrBackend(existing.api as never).workspaceFor('pan-3917', '/w'));
    expect(reused).toMatchObject({ workspaceId: 'w7' });
    expect(existing.log.some((call) => call.method === 'workspace.create')).toBe(false);

    const fresh = fakeApi(({ method }) => {
      if (method === 'workspace.list') return { workspaces: [] };
      if (method === 'workspace.create') return { workspace: { workspace_id: 'w8' } };
      return {};
    });
    const created = await Effect.runPromise(new HerdrBackend(fresh.api as never).workspaceFor('PAN-4000', '/w'));
    expect(created).toMatchObject({ workspaceId: 'w8', issueId: 'PAN-4000' });
    expect(fresh.log.find((call) => call.method === 'workspace.report_metadata')?.params)
      .toMatchObject({ workspace_id: 'w8', source: 'overdeck', tokens: { issue: 'PAN-4000' } });
  });
});

describe('HerdrBackend.startAgent when Herdr never detects the agent', () => {
  const workspace = { backend: 'herdr' as const, workspaceId: 'w1', issueId: 'PAN-1', cwd: '/w' };
  const spec = {
    kind: 'claude-code',
    argv: ['bash', 'launcher.sh'],
    env: {},
    tokens: { issue: 'PAN-1', role: 'work' as const, harness: 'claude-code', model: 'claude-opus-5' },
    name: 'agent-pan-1',
  };

  it('closes the pane and fails the launch instead of returning an unaddressable name', async () => {
    // Only a DETECTED agent can be renamed, and every caller addresses the pane
    // by the Overdeck agent id. Reporting success here hands back a reference
    // that no prompt, wait or close can reach.
    vi.useFakeTimers();
    try {
      const { api, log } = fakeApi(({ method }) => {
        if (method === 'pane.split') return { pane: { pane_id: 'w1:p3', terminal_id: 't3', workspace_id: 'w1' } };
        if (method === 'pane.get') return { pane: { pane_id: 'w1:p3', terminal_id: 't3', workspace_id: 'w1' } };
        return {};
      });

      const launch = Effect.runPromise(new HerdrBackend(api as never).startAgent(workspace, spec));
      const settled = expect(launch).rejects.toMatchObject({
        message: expect.stringContaining('detected no agent'),
      });
      await vi.advanceTimersByTimeAsync(61_000);
      await settled;

      expect(log.some((call) => call.method === 'agent.rename')).toBe(false);
      expect(log.find((call) => call.method === 'pane.close')?.params).toMatchObject({ pane_id: 'w1:p3' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('HerdrBackend.prompt when the target metadata cannot be read', () => {
  const unreadable = () => fakeApi(({ method }) => {
    if (method === 'agent.get') return new HerdrApiError({ method, code: 'not_found', message: 'no such agent' });
    return {};
  });

  it('refuses a non-operator sender rather than treating the target as ungated', async () => {
    const { api, log } = unreadable();
    const result = await Effect.runPromise(
      new HerdrBackend(api as never).prompt({ agentName: 'agent-pan-1-slot-2' }, 'do this', {
        messageId: 'm1',
        sender: { id: 'agent-pan-9-review', issue: 'PAN-9', role: 'review' },
      }),
    );

    expect(result).toMatchObject({ refused: true });
    expect(log.some((call) => call.method === 'agent.prompt')).toBe(false);
  });

  it('still lets an operator conversation through', async () => {
    const { api } = unreadable();
    const result = await Effect.runPromise(
      new HerdrBackend(api as never).prompt({ agentName: 'agent-pan-1-slot-2' }, 'do this', {
        messageId: 'm2',
        sender: { id: 'conv-2781' },
      }),
    );

    expect(result).toMatchObject({ delivered: true });
  });
});
