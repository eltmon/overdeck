/**
 * Review of #3992 (L1): the codex-TUI and Muse readiness waiters probe the
 * agent's pane on the host's terminal backend. They used a tmux-only
 * `sessionExists`, which answers "gone" for every Herdr pane, so a restart,
 * recovery or message fallback that now lands on Herdr never became ready.
 * Nothing here touches a real tmux server or Herdr socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  findHerdrAgent: vi.fn(),
  findHerdrAgentPane: vi.fn(),
  readHerdrPaneText: vi.fn(),
  tmuxSessionExists: vi.fn(),
  tmuxCapturePane: vi.fn(),
}));

vi.mock('../../terminal-backends/select.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/select.js')>();
  return {
    ...actual,
    hostTerminalBackendName: vi.fn(async () => 'herdr'),
    probeHerdrAvailability: vi.fn(async () => ({
      binary: '/usr/bin/herdr', session: 'overdeck', socket: '/tmp/herdr.sock', socketExists: true, available: true,
    })),
  };
});

vi.mock('../../terminal-backends/herdr.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/herdr.js')>();
  return {
    ...actual,
    findHerdrAgent: mocks.findHerdrAgent,
    findHerdrAgentPane: mocks.findHerdrAgentPane,
    readHerdrPaneText: mocks.readHerdrPaneText,
  };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  return { ...actual, sessionExists: mocks.tmuxSessionExists, capturePane: mocks.tmuxCapturePane };
});

vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return { ...actual, loadConfigSync: () => ({ config: { codex: { transport: 'tui' } } }) };
});

import { waitForPromptReady } from '../runtime-command.js';

const HERDR_AGENT = {
  paneId: 'w1:p3', terminalId: 'term-3', workspaceId: 'w1', state: 'unknown', tokens: {}, paneBound: true,
};
const CODEX_READY = ['› ', 'gpt-5.6 high · ~/Projects/overdeck'].join('\n');
const MUSE_READY = 'Muse Code\n⟩ \n muse-spark-1.3';

/**
 * Drive a waiter that sleeps on a real `setTimeout` between polls under fake
 * timers. Each poll does async work (dynamic imports, probes) before it
 * schedules its timer, so time is advanced in steps with a real `setImmediate`
 * turn after each, bounded by wall-clock — never by a fixed turn count.
 */
async function settleWithFakeTimers<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = promise.finally(() => { settled = true; });
  const deadline = Date.now() + 4000;
  while (!settled && Date.now() < deadline) {
    await vi.advanceTimersByTimeAsync(50);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return tracked;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findHerdrAgent.mockResolvedValue(HERDR_AGENT);
  mocks.findHerdrAgentPane.mockResolvedValue({ paneId: 'w1:p3', terminalId: 'term-3', workspaceId: 'w1' });
  mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(false));
  mocks.tmuxCapturePane.mockReturnValue(Effect.succeed(''));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TUI readiness on a Herdr host', () => {
  it('codex TUI becomes ready from the Herdr pane — tmux is never asked', async () => {
    mocks.readHerdrPaneText.mockResolvedValue(CODEX_READY);

    await expect(waitForPromptReady('agent-pan-3960-codex', 'codex', 5)).resolves.toBe(true);

    expect(mocks.findHerdrAgent).toHaveBeenCalledWith('agent-pan-3960-codex');
    expect(mocks.readHerdrPaneText).toHaveBeenCalledWith('w1:p3', 80);
    expect(mocks.tmuxSessionExists).not.toHaveBeenCalled();
    expect(mocks.tmuxCapturePane).not.toHaveBeenCalled();
  });

  it('Muse becomes ready once its prompt renders in the Herdr pane', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.readHerdrPaneText
      .mockResolvedValueOnce('Muse Code is starting')
      .mockResolvedValue(MUSE_READY);

    await expect(settleWithFakeTimers(waitForPromptReady('agent-pan-3960-muse', 'muse', 5))).resolves.toBe(true);

    expect(mocks.readHerdrPaneText).toHaveBeenCalledTimes(2);
    expect(mocks.tmuxSessionExists).not.toHaveBeenCalled();
  });

  it.each(['codex', 'muse'] as const)('%s stops waiting once Herdr holds no pane for the agent', async (harness) => {
    mocks.findHerdrAgent.mockResolvedValue(null);

    await expect(waitForPromptReady(`agent-pan-3960-${harness}-gone`, harness, 5)).resolves.toBe(false);

    expect(mocks.readHerdrPaneText).not.toHaveBeenCalled();
  });
});
