import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { HerdrBackend } from '../../../../src/lib/terminal-backends/herdr.js';
import { launchAgentPane } from '../../../../src/lib/terminal-backends/launch.js';
import type {
  AgentPaneRef,
  StartAgentSpec,
  TerminalBackend,
  WorkspaceRef,
} from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-4311: launchAgentPane applies the pane's CPU class. Batch roles launch
 * under `nice -n <resources.agent_nice>`; operator conversations do not. The
 * test OVERDECK_HOME has no config.yaml, so the defaults (agent 10, lane 15)
 * apply.
 */

const workspace: WorkspaceRef = {
  backend: 'herdr',
  workspaceId: 'w1',
  issueId: 'PAN-1',
  cwd: '/w/feature-pan-1',
};

function fakeBackend(specs: StartAgentSpec[]): TerminalBackend {
  const pane: AgentPaneRef = {
    backend: 'herdr',
    workspaceId: 'w1',
    paneId: 'w1:p1',
    terminalId: 'w1:p1',
    agentName: 'agent-pan-1',
  };
  return {
    name: 'herdr',
    workspaceFor: () => Effect.succeed(workspace),
    startAgent: (_workspace: WorkspaceRef, spec: StartAgentSpec) => {
      specs.push(spec);
      return Effect.succeed(pane);
    },
  } as unknown as TerminalBackend;
}

const argv = ['bash', 'launcher.sh'];

describe('launchAgentPane CPU class (PAN-4311)', () => {
  it('wraps a work agent launch in nice', async () => {
    const specs: StartAgentSpec[] = [];
    await launchAgentPane({
      issueId: 'PAN-1',
      cwd: '/w/feature-pan-1',
      agentId: 'agent-pan-1',
      argv,
      env: {},
      tokens: { issue: 'PAN-1', role: 'work', harness: 'codex', model: 'm' },
    }, fakeBackend(specs));

    expect(specs[0]?.argv).toEqual(['nice', '-n', '10', '--', 'bash', 'launcher.sh']);
  });

  it('leaves an operator conversation launch unwrapped', async () => {
    const specs: StartAgentSpec[] = [];
    await launchAgentPane({
      cwd: '/home/e',
      agentId: 'conv-chat',
      argv,
      env: {},
      tokens: { role: 'conversation', harness: 'codex', model: 'm' },
    }, fakeBackend(specs));

    expect(specs[0]?.argv).toEqual(argv);
  });

  it('honors an explicit lane class', async () => {
    const specs: StartAgentSpec[] = [];
    await launchAgentPane({
      cwd: '/home/e',
      agentId: 'conv-lane-builder',
      argv,
      env: {},
      tokens: { role: 'conversation', harness: 'codex', model: 'm' },
      cpuClass: 'lane',
    }, fakeBackend(specs));

    expect(specs[0]?.argv).toEqual(['nice', '-n', '15', '--', 'bash', 'launcher.sh']);
  });

  it('types the nice prefix unquoted into a Herdr pane', async () => {
    const log: Array<{ method: string; params: Record<string, unknown> }> = [];
    const api = {
      call: async (method: string, params: Record<string, unknown>) => {
        log.push({ method, params });
        return method === 'pane.split'
          ? { pane: { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1' } }
          : {};
      },
    };
    const herdr = new HerdrBackend(api as never);
    const backend = Object.assign(Object.create(herdr) as TerminalBackend, {
      workspaceFor: () => Effect.succeed(workspace),
    });

    await launchAgentPane({
      issueId: 'PAN-1',
      cwd: '/w/feature-pan-1',
      agentId: 'agent-pan-1-review',
      argv: ['bash', '/home/e/.overdeck/agents/agent-pan-1-review/launcher.sh'],
      env: {},
      tokens: { issue: 'PAN-1', role: 'review', harness: 'codex', model: 'm' },
    }, backend);

    const text = log.find((call) => call.method === 'pane.send_input')?.params.text;
    expect(typeof text).toBe('string');
    expect(text as string).toMatch(/^nice -n 10 -- bash /);
  });
});
