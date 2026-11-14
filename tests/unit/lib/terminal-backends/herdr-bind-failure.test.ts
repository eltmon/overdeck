/**
 * PAN-5243: a Herdr launch that cannot bind its agent name closes ITS OWN pane.
 *
 * Two starts raced for `agent-pan-5237`. The loser's `agent.rename` failed with
 * `agent_name_taken`; `startAgent` threw without closing the pane it had just
 * opened (it only did so on a detection timeout), so an unnamed, untokened
 * Claude Code pane leaked where no reader could find it. A failed rename or
 * stamp now closes exactly that pane, and `launchAgentPane` reports the name
 * collision as the typed `AgentNameTakenError`.
 */
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { HerdrBackend } from '../../../../src/lib/terminal-backends/herdr.js';
import { HerdrApiError } from '../../../../src/lib/terminal-backends/herdr-api.js';
import { launchAgentPane, nameTakenDetail } from '../../../../src/lib/terminal-backends/launch.js';
import { AgentNameTakenError, type TerminalBackend, type WorkspaceRef } from '../../../../src/lib/terminal-backends/types.js';

interface Call { method: string; params: Record<string, unknown> }

const workspace: WorkspaceRef = { backend: 'herdr', workspaceId: 'w1Y5', issueId: 'PAN-5237', cwd: '/w/feature-pan-5237' };

const spec = {
  kind: 'codex',
  argv: ['bash', '/tmp/launcher.sh'],
  env: {},
  tokens: { issue: 'PAN-5237', role: 'work' as const, harness: 'codex', model: 'gpt-5.5' },
  name: 'agent-pan-5237',
};

/** A Herdr session where the new pane `w1Y5:p4` is detected, then one step fails. */
function fakeApi(failing: 'agent.rename' | 'pane.report_metadata', log: Call[]) {
  return {
    call: async (method: string, params: Record<string, unknown>) => {
      log.push({ method, params });
      switch (method) {
        case 'tab.create':
          return { type: 'tab_created', tab: { tab_id: 'w1Y5:t4' }, root_pane: { pane_id: 'w1Y5:p4', terminal_id: 'term_p4', workspace_id: 'w1Y5' } };
        case 'pane.get':
          return { pane: { pane_id: 'w1Y5:p4', terminal_id: 'term_p4', workspace_id: 'w1Y5', agent: 'claude', agent_status: 'idle' } };
        case failing:
          throw failing === 'agent.rename'
            ? new HerdrApiError({ method, code: 'agent_name_taken', message: 'agent name agent-pan-5237 is already used; candidates: pane_id=w1Y5:p3' })
            : new HerdrApiError({ method, code: 'error', message: 'metadata rejected' });
        default:
          return {};
      }
    },
  };
}

const closes = (log: Call[]) => log.filter((call) => call.method === 'pane.close').map((call) => call.params['pane_id']);

describe('HerdrBackend.startAgent bind failure (PAN-5243)', () => {
  it('closes only its own pane when agent.rename fails with agent_name_taken', async () => {
    const log: Call[] = [];
    const backend = new HerdrBackend(fakeApi('agent.rename', log) as never, { detectTimeoutMs: 1_000, detectPollMs: 0, sizeTerminal: async () => undefined });

    const error = await Effect.runPromise(Effect.flip(backend.startAgent(workspace, spec)));

    expect(closes(log)).toEqual(['w1Y5:p4']);
    expect(log.some((call) => call.method === 'pane.report_metadata')).toBe(false);
    expect(nameTakenDetail(error)).toContain('agent_name_taken');
  });

  it('closes only its own pane when stamping the pane identity fails', async () => {
    const log: Call[] = [];
    const backend = new HerdrBackend(fakeApi('pane.report_metadata', log) as never, { detectTimeoutMs: 1_000, detectPollMs: 0, sizeTerminal: async () => undefined });

    const error = await Effect.runPromise(Effect.flip(backend.startAgent(workspace, spec)));

    expect(closes(log)).toEqual(['w1Y5:p4']);
    expect(nameTakenDetail(error)).toBeNull();
  });
});

describe('launchAgentPane name collision (PAN-5243)', () => {
  it('maps a Herdr agent_name_taken failure to AgentNameTakenError', async () => {
    const log: Call[] = [];
    const herdr = new HerdrBackend(fakeApi('agent.rename', log) as never, { detectTimeoutMs: 1_000, detectPollMs: 0, sizeTerminal: async () => undefined });
    // codex launches skip detection, so force the claude-code path that renames.
    const backend = {
      name: 'herdr',
      workspaceFor: () => Effect.succeed(workspace),
      startAgent: (ws: WorkspaceRef, s: Parameters<HerdrBackend['startAgent']>[1]) => herdr.startAgent(ws, { ...s, detection: 'required' }),
    } as unknown as TerminalBackend;

    const error = await launchAgentPane({
      issueId: 'PAN-5237', cwd: '/w/feature-pan-5237', agentId: 'agent-pan-5237', argv: ['bash', 'launcher.sh'], env: {}, tokens: spec.tokens,
    }, backend).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentNameTakenError);
    expect((error as AgentNameTakenError).agentName).toBe('agent-pan-5237');
  });

  it('maps a tmux duplicate session failure to AgentNameTakenError and leaves other failures alone', () => {
    expect(nameTakenDetail({ message: 'startAgent failed', cause: { message: 'duplicate session: agent-pan-5237' } })).toContain('duplicate session');
    expect(nameTakenDetail(new Error('herdr detected no agent in pane w1Y5:p4'))).toBeNull();
  });
});
