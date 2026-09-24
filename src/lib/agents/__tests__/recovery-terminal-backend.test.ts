/**
 * PAN-3960: restartAgent and recoverAgent relaunch an agent through
 * `launchAgentPane` on the terminal backend the host selects NOW — never on the
 * backend the agent's previous pane used, and never with a direct (or sync)
 * tmux `createSession`. Recovery reads liveness from liveness.ts. Both backends
 * are recording fakes registered over the real adapters; nothing here touches a
 * real tmux server or Herdr socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import type { TerminalBackendName } from '../../terminal-backends/types.js';
import { fakeTerminalBackend, type FakeTerminalBackend } from '../../../../tests/helpers/fake-terminal-backend.js';

const mocks = vi.hoisted(() => ({
  host: 'herdr' as 'herdr' | 'tmux',
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' })),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false, supervisorScriptPath: undefined })),
  resolveHarness: vi.fn(async () => 'claude-code'),
  waitForPromptReady: vi.fn(async () => true),
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'herdr' })),
  deliverResumeMessageWithTranscriptConfirmation: vi.fn(async () => ({ delivered: true, attempts: 1 })),
  prepareAutonomousAgentResumePane: vi.fn(async () => ({ ready: true, action: 'clear' })),
  waitForReadySignal: vi.fn(async () => true),
  stopAgent: vi.fn(() => Effect.succeed(undefined)),
  detectPendingOperatorDecision: vi.fn(async () => null),
  tmuxCreateSession: vi.fn(() => Effect.succeed(undefined)),
  tmuxSessionExists: vi.fn(() => Effect.succeed(false)),
  tmuxListPaneValues: vi.fn(async () => [] as string[]),
  tmuxKillSession: vi.fn(() => Effect.succeed(undefined)),
  findRuntimePid: vi.fn(async () => null as number | null | 'indeterminate'),
  queryTmuxSession: vi.fn(async () => 'missing' as 'exists' | 'missing' | 'error'),
}));

// The legacy tmux check on a Herdr host (liveness.ts) — never a real tmux call.
vi.mock('../tmux-session-query.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux-session-query.js')>();
  return { ...actual, queryTmuxSession: mocks.queryTmuxSession };
});

vi.mock('../runtime-pid-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime-pid-probe.js')>();
  return { ...actual, findAgentRuntimePidInSubtree: mocks.findRuntimePid };
});

vi.mock('../../terminal-backends/select.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/select.js')>();
  return {
    ...actual,
    hostTerminalBackendName: vi.fn(async () => mocks.host),
    // PAN-3956: a herdr host in these tests has a live session server.
    probeHerdrAvailability: vi.fn(async () => ({
      binary: '/usr/bin/herdr', session: 'overdeck', socket: '/tmp/herdr.sock', socketExists: true, available: true,
    })),
  };
});

// No Herdr socket: the host has no agent, no pane, nothing alive.
vi.mock('../../terminal-backends/herdr.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../terminal-backends/herdr.js')>();
  return {
    ...actual,
    findHerdrAgent: vi.fn(async () => null),
    findHerdrAgentPane: vi.fn(async () => null),
    probeHerdrAgentLiveness: vi.fn(async () => ({ kind: 'absent' })),
  };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  return {
    ...actual,
    createSession: mocks.tmuxCreateSession,
    createSessionSync: vi.fn(() => { throw new Error('createSessionSync must not be called'); }),
    sessionExists: mocks.tmuxSessionExists,
    killSession: mocks.tmuxKillSession,
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    listPaneValues: mocks.tmuxListPaneValues,
    sendKeys: vi.fn(() => Effect.succeed(undefined)),
  };
});

vi.mock('../spawn-prep.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../spawn-prep.js')>();
  return { ...actual, assertWorkspaceStackHealthyForSpawn: mocks.assertWorkspaceStackHealthyForSpawn };
});

vi.mock('../../harness-binary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness-binary.js')>();
  return { ...actual, prepareHarnessLaunch: mocks.prepareHarnessLaunch };
});

vi.mock('../supervisor-channels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor-channels.js')>();
  return { ...actual, prepareSupervisorForRelaunch: mocks.prepareSupervisorForRelaunch };
});

vi.mock('../../harness-resolve.js', () => ({ resolveHarness: mocks.resolveHarness }));

vi.mock('../runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime-command.js')>();
  return { ...actual, waitForPromptReady: mocks.waitForPromptReady };
});

vi.mock('../delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../delivery.js')>();
  return {
    ...actual,
    deliverAgentMessage: mocks.deliverAgentMessage,
    deliverResumeMessageWithTranscriptConfirmation: mocks.deliverResumeMessageWithTranscriptConfirmation,
  };
});

vi.mock('../resume-pane-choice.js', () => ({
  prepareAutonomousAgentResumePane: mocks.prepareAutonomousAgentResumePane,
}));

vi.mock('../identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../identity.js')>();
  return { ...actual, waitForReadySignal: mocks.waitForReadySignal };
});

vi.mock('../termination.js', () => ({ stopAgent: mocks.stopAgent }));

vi.mock('../pending-decision-gate.js', () => ({
  detectPendingOperatorDecision: mocks.detectPendingOperatorDecision,
}));

import { recoverAgent, restartAgent } from '../recovery.js';
import { registerTerminalBackend } from '../../terminal-backends/registry.js';
import { getAgentDir, getAgentStateSync, saveAgentStateSync } from '../agent-state.js';
import { appendSessionIdToHistory } from '../../session-history.js';
import { sessionFilePath } from '../../runtimes/storage/claude-code.js';

/**
 * Drive a promise whose path waits on a real `setTimeout` (restartAgent's 500ms
 * settle before the continue prompt) under fake timers. Real I/O in between
 * resolves on its own event-loop turns, so time is advanced in small steps with
 * a real `setImmediate` turn after each one until the promise settles.
 */
async function settleWithFakeTimers<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = promise.finally(() => { settled = true; });
  // Bounded by wall-clock, not a turn count: the restart path does real I/O
  // (fs writes, dynamic imports) before it reaches its fake timers, and under
  // CI load 1000 quick turns ran out first, leaving the timer never advanced.
  // Date is not faked here (toFake: setTimeout/clearTimeout only).
  const deadline = Date.now() + 4000;
  while (!settled && Date.now() < deadline) {
    await vi.advanceTimersByTimeAsync(50);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return tracked;
}

let herdr: FakeTerminalBackend;
let tmux: FakeTerminalBackend;
let tempHome: string;
let workspace: string;
let prevHome: string | undefined;
let prevOverdeckHome: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  herdr = fakeTerminalBackend('herdr');
  tmux = fakeTerminalBackend('tmux');
  registerTerminalBackend(herdr);
  registerTerminalBackend(tmux);
  mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(false));
  mocks.tmuxListPaneValues.mockResolvedValue([]);
  mocks.findRuntimePid.mockResolvedValue(null);
  mocks.queryTmuxSession.mockResolvedValue('missing');
  mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'herdr' });
  mocks.waitForPromptReady.mockResolvedValue(true);

  tempHome = mkdtempSync(join(tmpdir(), 'pan-3960-relaunch-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-3960-relaunch-ws-'));
  prevHome = process.env.HOME;
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.HOME = tempHome;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

/** A stopped claude-code agent whose last pane lived on `previousBackend`. */
function writeStoppedAgent(agentId: string, previousBackend: TerminalBackendName): void {
  const sessionId = `${agentId}-session`;
  const transcriptPath = sessionFilePath(workspace, sessionId);
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, '{"type":"summary","summary":"prior work"}\n');
  mkdirSync(getAgentDir(agentId), { recursive: true });
  appendSessionIdToHistory(agentId, sessionId, 'launcher');
  saveAgentStateSync({
    id: agentId,
    issueId: 'PAN-3960',
    workspace,
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-5',
    status: 'stopped',
    startedAt: new Date().toISOString(),
    kickoffDelivered: true,
    sessionId,
    backend: previousBackend,
    paneId: previousBackend === 'tmux' ? agentId : 'w9:p9',
  });
}

const cases: Array<{ host: TerminalBackendName; previous: TerminalBackendName }> = [
  { host: 'herdr', previous: 'tmux' },
  { host: 'tmux', previous: 'herdr' },
];

describe('restartAgent relaunches on the host backend (PAN-3960)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(cases)('$host host, agent previously on $previous', async ({ host, previous }) => {
    mocks.host = host;
    const agentId = `agent-pan-3960-restart-${host}`;
    writeStoppedAgent(agentId, previous);

    const result = await settleWithFakeTimers(restartAgent(agentId, { graceful: false }));

    expect(result).toEqual({ success: true });
    const selected = host === 'herdr' ? herdr : tmux;
    const other = host === 'herdr' ? tmux : herdr;
    expect(other.starts).toHaveLength(0);
    expect(selected.starts).toHaveLength(1);
    expect(selected.starts[0]!.spec).toMatchObject({
      name: agentId,
      tokens: { issue: 'PAN-3960', role: 'work', harness: 'claude-code', model: 'claude-sonnet-5' },
      env: expect.objectContaining({ GIT_SEQUENCE_EDITOR: 'false', TERM: 'xterm-256color' }),
    });
    // The claude-code continue prompt goes through the backend-aware delivery
    // door, not a tmux paste.
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      agentId,
      expect.any(String),
      'restartAgent:continue-prompt',
      undefined,
    );
    expect(mocks.tmuxCreateSession).not.toHaveBeenCalled();
    expect(getAgentStateSync(agentId)?.backend).toBe(host);
  });
});

describe('recoverAgent relaunches on the host backend (PAN-3960)', () => {
  it.each(cases)('$host host, agent previously on $previous', async ({ host, previous }) => {
    mocks.host = host;
    const agentId = `agent-pan-3960-recover-${host}`;
    writeStoppedAgent(agentId, previous);

    const result = await recoverAgent(agentId);

    expect(result?.action).toBe('respawned');
    const selected = host === 'herdr' ? herdr : tmux;
    const other = host === 'herdr' ? tmux : herdr;
    expect(other.starts).toHaveLength(0);
    expect(selected.starts).toHaveLength(1);
    expect(selected.starts[0]!.spec).toMatchObject({
      name: agentId,
      tokens: { issue: 'PAN-3960', role: 'work', harness: 'claude-code', model: 'claude-sonnet-5' },
    });
    expect(mocks.tmuxCreateSession).not.toHaveBeenCalled();
    expect(getAgentStateSync(agentId)?.backend).toBe(host);
  });

  it('leaves a live agent alone — liveness comes from liveness.ts, not a tmux probe', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-recover-live';
    writeStoppedAgent(agentId, 'herdr');
    const { probeHerdrAgentLiveness } = await import('../../terminal-backends/herdr.js');
    vi.mocked(probeHerdrAgentLiveness).mockResolvedValueOnce({ kind: 'alive' } as never);

    const result = await recoverAgent(agentId);

    expect(result?.action).toBe('already-running');
    expect(herdr.starts).toHaveLength(0);
    expect(tmux.starts).toHaveLength(0);
    expect(herdr.closes).toHaveLength(0);
    expect(tmux.closes).toHaveLength(0);
  });

  it('does not reap or relaunch when the liveness probe is indeterminate', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-recover-indeterminate';
    writeStoppedAgent(agentId, 'herdr');
    const { probeHerdrAgentLiveness } = await import('../../terminal-backends/herdr.js');
    vi.mocked(probeHerdrAgentLiveness).mockResolvedValueOnce({ kind: 'indeterminate', reason: 'socket down' } as never);

    const result = await recoverAgent(agentId);

    expect(result?.action).toBe('already-running');
    expect(herdr.starts).toHaveLength(0);
    expect(herdr.closes).toHaveLength(0);
    expect(tmux.closes).toHaveLength(0);
  });

  // Review of #3992 (M3): an agent launched before the host moved to Herdr is
  // still running in its tmux session. Herdr knows nothing about it, and that
  // must not read as a death — closeAgentPane would kill the live session.
  it('treats a live same-name tmux session on a Herdr host as already running', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-recover-legacy-tmux';
    writeStoppedAgent(agentId, 'tmux');
    mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(true));
    mocks.queryTmuxSession.mockResolvedValue('exists');
    mocks.tmuxListPaneValues.mockResolvedValue(['4242\t0']);
    mocks.findRuntimePid.mockResolvedValue(4243);

    const result = await recoverAgent(agentId);

    expect(result?.action).toBe('already-running');
    expect(herdr.starts).toHaveLength(0);
    expect(tmux.starts).toHaveLength(0);
    expect(herdr.closes).toHaveLength(0);
    expect(tmux.closes).toHaveLength(0);
    expect(mocks.tmuxKillSession).not.toHaveBeenCalled();
  });

  // Review of #4018 (L2): a tmux probe that errors is not "no session".
  it('does not reap when the legacy tmux probe on a Herdr host errors', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-recover-legacy-error';
    writeStoppedAgent(agentId, 'tmux');
    mocks.queryTmuxSession.mockResolvedValue('error');

    const result = await recoverAgent(agentId);

    expect(result?.action).toBe('already-running');
    expect(herdr.starts).toHaveLength(0);
    expect(herdr.closes).toHaveLength(0);
    expect(tmux.closes).toHaveLength(0);
  });

  it('still reaps a legacy tmux corpse on a Herdr host and relaunches on Herdr', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-recover-legacy-corpse';
    writeStoppedAgent(agentId, 'tmux');
    mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(true));
    mocks.queryTmuxSession.mockResolvedValue('exists');
    mocks.tmuxListPaneValues.mockResolvedValue(['4242\t0']);
    mocks.findRuntimePid.mockResolvedValue(null);

    const result = await recoverAgent(agentId);

    expect(result?.action).toBe('respawned');
    expect(tmux.closes).toEqual([expect.objectContaining({ backend: 'tmux', paneId: agentId })]);
    expect(herdr.starts).toHaveLength(1);
  });
});
