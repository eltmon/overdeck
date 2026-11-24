/**
 * PAN-5652: `rebaseWithAgentFallback` waits for the work agent to push its
 * rebased branch. It decided the agent had stopped with tmux `has-session`,
 * which is false for every Herdr agent, so the wait ended on its first poll.
 * It now ends early only when the liveness oracle confirms the agent is gone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  isAlive: vi.fn(),
  messageAgent: vi.fn(),
  tmuxSessionExists: vi.fn(),
  head: 'old-head',
}));

vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');
  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    mocks.exec(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }
  (exec as any)[kCustom] = mocks.exec;
  return { exec, execFile: vi.fn() };
});

vi.mock('../../../../../lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    listSessionsSync: () => [],
    listSessions: () => Effect.succeed([]),
    listPaneValuesSync: () => [],
    listPaneValues: async () => [],
    sessionExists: mocks.tmuxSessionExists,
  };
});

vi.mock('../../../../../lib/agents/liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/agents/liveness.js')>()),
  isAlive: mocks.isAlive,
}));

// PAN-3917: config-yaml's defaults import lib/agents/tier-table, which still
// reaches the record plane W3 is deleting. Stub the one constant it needs.
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));

vi.mock('../../../../../lib/agents/agent-state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/agents/agent-state.js')>()),
  getAgentState: () => ({ id: 'agent-min-1144', status: 'running' }),
}));

vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: () => ({ id: 'agent-min-1144', status: 'running' }),
  messageAgent: mocks.messageAgent,
  spawnAgent: vi.fn(),
}));

vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: () => ({ hasLiveTmuxSession: true, canResumeSession: true, canStartFresh: false }),
}));

vi.mock('../../../../../lib/cloister/ship-log.js', () => ({
  appendShipLog: vi.fn(),
}));

import { Effect } from 'effect';
import { rebaseWithAgentFallback } from '../merge-strike.js';

const POLL_MS = 5_000;
const TIMEOUT_MS = 30 * 60 * 1000;

const options = {
  issueId: 'MIN-1144',
  // No such directory: the server-side rebase is skipped, so the agent path decides.
  workspacePath: '/nonexistent/workspaces/feature-min-1144',
  branchName: 'feature/min-1144',
  targetBranch: 'main',
  agentId: 'agent-min-1144',
  rebaseMsg: 'MERGE REQUESTED: rebase and push.',
  allowFreshStart: false,
  setStatus: () => undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.head = 'old-head';
  // Herdr host: tmux knows nothing about the agent.
  mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(false));
  mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true, backendState: 'working' });
  mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
  mocks.exec.mockImplementation(async (command) => (
    command.includes('rev-parse') ? { stdout: `${mocks.head}\n`, stderr: '' } : { stdout: '', stderr: '' }
  ));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Resolves once the rebase request reached the agent and the wait began. */
async function startWait() {
  let settled = false;
  const result = rebaseWithAgentFallback(options).finally(() => { settled = true; });
  await vi.waitUntil(() => mocks.messageAgent.mock.calls.length > 0, { timeout: 5_000, interval: 1 });
  return { result, settled: () => settled };
}

describe('rebaseWithAgentFallback wait on a Herdr-backed work agent (PAN-5652)', () => {
  it('keeps polling a live agent that tmux cannot see until it pushes', async () => {
    const wait = await startWait();

    await vi.advanceTimersByTimeAsync(POLL_MS * 6);
    expect(wait.settled()).toBe(false);
    expect(mocks.isAlive).toHaveBeenCalledWith('agent-min-1144');

    mocks.head = 'new-head';
    await vi.advanceTimersByTimeAsync(POLL_MS);

    await expect(wait.result).resolves.toEqual({ success: true, newHead: 'new-head' });
  });

  it('keeps waiting through an indeterminate probe and reports the timeout, not a stop', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
    const wait = await startWait();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - POLL_MS);
    expect(wait.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    await expect(wait.result).resolves.toEqual(expect.objectContaining({
      success: false,
      reason: 'Work agent did not push the rebased branch within 30 minutes',
    }));
  });

  it('stops waiting once the liveness oracle confirms the agent is gone', async () => {
    const wait = await startWait();

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'pane-dead' });
    await vi.advanceTimersByTimeAsync(POLL_MS);

    await expect(wait.result).resolves.toEqual(expect.objectContaining({
      success: false,
      reason: 'Work agent agent-min-1144 stopped before completing the rebase onto main',
    }));
  });
});
