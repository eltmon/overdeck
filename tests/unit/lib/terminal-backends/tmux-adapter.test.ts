import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

import { isUnsupported } from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3917 FR-3 / W8. The tmux adapter wraps what Overdeck already does —
 * `createSession`, `sendKeys`, `sessionExists`, and the liveness oracle — and
 * answers `unsupported` (a value, never a throw) for what tmux cannot do.
 */

const created: Array<{ name: string; cwd: string; command?: string; env?: Record<string, string> }> = [];
const killed: string[] = [];
let aliveVerdict: { alive: boolean; paneAlive?: boolean; reason?: string } = { alive: true, paneAlive: true };
let idle = false;
let sessions: Array<{ name: string; created: Date; attached: boolean; windows: number }> = [];
let agentState: Record<string, unknown> | null = null;

vi.mock('../../../../src/lib/tmux.js', () => ({
  createSession: (name: string, cwd: string, command?: string, options?: { env?: Record<string, string> }) =>
    Effect.sync(() => { created.push({ name, cwd, command, env: options?.env }); }),
  killSession: (name: string) => Effect.sync(() => { killed.push(name); }),
  listSessions: () => Effect.succeed(sessions),
  sendKeys: () => Effect.succeed(undefined),
  sessionExists: () => Effect.succeed(true),
}));

// PAN-3917 W12: the tmux adapter's inventory probes TMUX (isAliveOnTmux), not
// the host's selected backend — a Herdr host still lists its tmux sessions.
vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  isAliveOnTmux: async () => aliveVerdict,
  isIdle: () => idle,
}));

// PAN-3917/lint:circular: tmux.ts imports the read-only leaf, not agent-state.ts.
vi.mock('../../../../src/lib/agents/agent-state-read.js', () => ({
  getAgentState: () => agentState,
}));

const { TmuxBackend, toPaneRole, tmuxTargetTokens } = await import('../../../../src/lib/terminal-backends/tmux.js');

beforeEach(() => {
  created.length = 0;
  killed.length = 0;
  aliveVerdict = { alive: true, paneAlive: true };
  idle = false;
  sessions = [];
  agentState = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tmux adapter — workspace and start', () => {
  it('uses the session-name prefix as the issue workspace', async () => {
    const workspace = await Effect.runPromise(new TmuxBackend().workspaceFor('PAN-3917', '/w'));
    expect(workspace).toEqual({ backend: 'tmux', workspaceId: 'agent-pan-3917', issueId: 'PAN-3917', cwd: '/w' });
  });

  it('creates the session with the agent id, cwd, launcher command and env', async () => {
    const backend = new TmuxBackend();
    const workspace = await Effect.runPromise(backend.workspaceFor('PAN-3917', '/w'));
    if (isUnsupported(workspace)) throw new Error('workspaceFor must be supported on tmux');

    const pane = await Effect.runPromise(backend.startAgent(workspace, {
      kind: 'claude-code',
      argv: ['bash', '/home/x/.overdeck/agents/agent-pan-3917/launcher.sh'],
      env: { OVERDECK_AGENT_ID: 'agent-pan-3917' },
      tokens: { issue: 'PAN-3917', role: 'work', harness: 'claude-code', model: 'claude-opus-5' },
      name: 'agent-pan-3917',
    }));

    expect(created[0]).toMatchObject({
      name: 'agent-pan-3917',
      cwd: '/w',
      command: 'bash /home/x/.overdeck/agents/agent-pan-3917/launcher.sh',
      env: { OVERDECK_AGENT_ID: 'agent-pan-3917' },
    });
    expect(pane).toMatchObject({
      backend: 'tmux',
      paneId: 'agent-pan-3917',
      terminalId: 'agent-pan-3917',
      agentName: 'agent-pan-3917',
    });
  });

  // Review of #3992 (L3): tmux runs the command through `sh -c`; an
  // OVERDECK_HOME with a space must not split the launcher path.
  it('quotes a launcher path that contains a space', async () => {
    const backend = new TmuxBackend();
    const workspace = await Effect.runPromise(backend.workspaceFor('PAN-3960', '/w'));
    if (isUnsupported(workspace)) throw new Error('workspaceFor must be supported on tmux');

    await Effect.runPromise(backend.startAgent(workspace, {
      kind: 'claude-code',
      argv: ['bash', "/home/x/My Overdeck/agents/planning-pan-3960/it's-launcher.sh"],
      env: {},
      tokens: { issue: 'PAN-3960', role: 'plan', harness: 'claude-code', model: 'claude-sonnet-5' },
      name: 'planning-pan-3960',
    }));

    expect(created[0]!.command).toBe("bash '/home/x/My Overdeck/agents/planning-pan-3960/it'\\''s-launcher.sh'");
  });
});

describe('tmux adapter — states', () => {
  it('reports working, idle and exited from the liveness oracle', async () => {
    sessions = [{ name: 'agent-pan-3917', created: new Date(), attached: false, windows: 1 }];
    agentState = { issueId: 'PAN-3917', role: 'work', model: 'claude-opus-5', harness: 'claude-code' };
    const backend = new TmuxBackend();

    const working = await Effect.runPromise(backend.list());
    expect(working).toMatchObject([{ state: 'working', tokens: { issue: 'PAN-3917', role: 'work' } }]);

    idle = true;
    expect(await Effect.runPromise(backend.list())).toMatchObject([{ state: 'idle' }]);

    aliveVerdict = { alive: false, reason: 'no-session' };
    expect(await Effect.runPromise(backend.list())).toMatchObject([{ state: 'exited' }]);
  });

  it('maps Overdeck roles onto the pane-token roles', () => {
    expect(toPaneRole('work')).toBe('work');
    expect(toPaneRole('review')).toBe('review');
    expect(toPaneRole('ship')).toBe('uat');
    expect(toPaneRole('strike')).toBe('strike');
    expect(toPaneRole(undefined)).toBe('work');
  });

  it('derives target tokens from the agent launch metadata', () => {
    agentState = { issueId: 'PAN-3917', role: 'review', model: 'gpt-5.5', harness: 'codex' };
    expect(tmuxTargetTokens('agent-pan-3917-review')).toEqual({
      issue: 'PAN-3917',
      role: 'review',
      harness: 'codex',
      model: 'gpt-5.5',
    });
  });
});

describe('tmux adapter — unsupported operations carry a reason', () => {
  const backend = new TmuxBackend();

  it.each([
    ['wait', () => backend.wait()],
    ['observe', () => backend.observe()],
    ['control', () => backend.control()],
    ['events', () => backend.events()],
    ['reportMetadata', () => backend.reportMetadata()],
    ['resume', () => backend.resume()],
  ])('%s', async (_name, run) => {
    const result = await Effect.runPromise(run());
    expect(isUnsupported(result)).toBe(true);
    if (isUnsupported(result)) expect(result.reason.length).toBeGreaterThan(10);
  });
});

describe('tmux adapter — close', () => {
  it('kills the session behind a pane ref', async () => {
    await Effect.runPromise(new TmuxBackend().close({
      backend: 'tmux',
      workspaceId: 'agent-pan-3917',
      paneId: 'agent-pan-3917',
      terminalId: 'agent-pan-3917',
      agentName: 'agent-pan-3917',
    }));
    expect(killed).toEqual(['agent-pan-3917']);
  });
});
