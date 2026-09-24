/**
 * PAN-3917 W12: a Herdr detection failure must say WHY.
 *
 * `pan start PAN-3705` failed on the live session with nothing but
 * "herdr detected no agent in pane wE:p2 within 60000ms" — true, and useless.
 * The cause was visible in one field the message did not carry: the pane's
 * foreground process was `node …/pty-supervisor.js claude …`, so Herdr's
 * detector (which reads the foreground process) never saw `claude`. Every
 * detection failure now carries that process line plus the pane's last lines of
 * output, so the next one is diagnosable from the error alone.
 */
import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';

import { HerdrBackend, probeHerdrAgentLiveness } from '../../../../src/lib/terminal-backends/herdr.js';
import { HerdrApiError } from '../../../../src/lib/terminal-backends/herdr-api.js';
import type { WorkspaceRef } from '../../../../src/lib/terminal-backends/types.js';

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

const workspace: WorkspaceRef = {
  backend: 'herdr',
  workspaceId: 'wE',
  issueId: 'PAN-3705',
  cwd: '/tmp/workspaces/feature-pan-3705',
};

const spec = {
  kind: 'claude-code',
  argv: ['bash', '/tmp/launcher.sh'],
  env: {},
  tokens: { issue: 'PAN-3705', role: 'work' as const, harness: 'claude-code', model: 'claude-sonnet-5' },
  name: 'agent-pan-3705',
};

describe('startAgent detection failure', () => {
  it('reports the pane foreground process and its last output, then closes the pane', async () => {
    const { api, log } = fakeApi(({ method }) => {
      switch (method) {
        case 'pane.split':
          return { pane: { pane_id: 'wE:p2', terminal_id: 'term_1', workspace_id: 'wE' } };
        // never detected: `agent` stays absent
        case 'pane.get':
          return { pane: { pane_id: 'wE:p2', terminal_id: 'term_1', workspace_id: 'wE' } };
        case 'pane.process_info':
          return {
            process_info: {
              foreground_processes: [
                { name: 'node', cmdline: 'node /dist/pty-supervisor.js claude --name agent-pan-3705' },
              ],
            },
          };
        case 'pane.read':
          return { text: 'launcher line 1\nlauncher line 2' };
        default:
          return {};
      }
    });

    const backend = new HerdrBackend(api as never, { detectTimeoutMs: 0, detectPollMs: 0 });
    const error = await Effect.runPromise(Effect.flip(backend.startAgent(workspace, spec)));

    expect(error.message).toContain('herdr detected no agent in pane wE:p2');
    expect(error.message).toContain('node /dist/pty-supervisor.js claude --name agent-pan-3705');
    expect(error.message).toContain('launcher line 2');

    // Diagnosed BEFORE the close — a closed pane has nothing left to read.
    const methods = log.map((call) => call.method);
    expect(methods.indexOf('pane.process_info')).toBeLessThan(methods.indexOf('pane.close'));
    expect(methods.indexOf('pane.read')).toBeLessThan(methods.indexOf('pane.close'));
    expect(log.find((call) => call.method === 'pane.read')?.params).toMatchObject({
      pane_id: 'wE:p2',
      source: 'recent_unwrapped',
      lines: 20,
    });
  });

  it('still fails cleanly when the diagnosis probes themselves fail', async () => {
    const { api } = fakeApi(({ method }) => {
      if (method === 'pane.split') return { pane: { pane_id: 'wE:p2', terminal_id: 't', workspace_id: 'wE' } };
      if (method === 'pane.get') return { pane: { pane_id: 'wE:p2', terminal_id: 't', workspace_id: 'wE' } };
      if (method === 'pane.process_info' || method === 'pane.read') {
        return new HerdrApiError({ method, code: 'timeout', message: 'no answer' });
      }
      return {};
    });

    const backend = new HerdrBackend(api as never, { detectTimeoutMs: 0, detectPollMs: 0 });
    const error = await Effect.runPromise(Effect.flip(backend.startAgent(workspace, spec)));

    expect(error.message).toContain('herdr detected no agent in pane wE:p2');
    expect(error.message).toContain('unavailable');
  });
});

describe('probeHerdrAgentLiveness', () => {
  it('reports a live agent with its state', async () => {
    const { api } = fakeApi(() => ({
      agent: { pane_id: 'wE:p2', terminal_id: 't', workspace_id: 'wE', agent: 'claude', agent_status: 'working' },
    }));

    await expect(probeHerdrAgentLiveness('agent-pan-3705', api as never))
      .resolves.toEqual({ kind: 'alive', paneId: 'wE:p2', state: 'working' });
  });

  it('reports an exited pane separately from an unknown agent', async () => {
    const { api } = fakeApi(() => ({
      agent: { pane_id: 'wE:p2', terminal_id: 't', workspace_id: 'wE', agent_status: 'exited' },
    }));

    await expect(probeHerdrAgentLiveness('agent-pan-3705', api as never))
      .resolves.toEqual({ kind: 'exited', paneId: 'wE:p2' });
  });

  it('treats a server answer of "no such agent" as absent', async () => {
    const { api } = fakeApi(({ method }) => new HerdrApiError({ method, code: 'not_found', message: 'no such agent' }));

    await expect(probeHerdrAgentLiveness('agent-pan-3705', api as never))
      .resolves.toEqual({ kind: 'absent' });
  });

  it('NEVER reports absence when the socket itself failed', async () => {
    // A Herdr outage folded into "absent" would confirm every agent dead at
    // once and the remediators would reap the whole fleet.
    for (const code of ['timeout', 'socket_error', 'disconnected']) {
      const { api } = fakeApi(({ method }) => new HerdrApiError({ method, code, message: `herdr ${code}` }));
      const result = await probeHerdrAgentLiveness('agent-pan-3705', api as never);
      expect(result.kind).toBe('indeterminate');
    }
  });
});
