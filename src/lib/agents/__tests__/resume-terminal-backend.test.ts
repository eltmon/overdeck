/**
 * PAN-3960: resumeAgent relaunches an agent through `launchAgentPane` on the
 * terminal backend the host selects NOW — never on the backend the agent's
 * previous pane used, and never with a direct tmux `createSession`. Both
 * backends are recording fakes registered over the real adapters; nothing here
 * touches a real tmux server or Herdr socket.
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
  deliverInitialPromptWithRetry: vi.fn(async (..._args: unknown[]) => ({ ok: true } as { ok: boolean; failure?: string })),
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
    deliverInitialPromptWithRetry: mocks.deliverInitialPromptWithRetry,
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

import { resumeAgent } from '../resume.js';
import { registerTerminalBackend } from '../../terminal-backends/registry.js';
import { getAgentDir, getAgentState, saveAgentStateSync } from '../agent-state.js';
import { appendSessionIdToHistory } from '../../session-history.js';
import { sessionFilePath } from '../../runtimes/storage/claude-code.js';

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
  // clearAllMocks keeps queued *Once values; drop them so no test leaks into the next.
  mocks.resolveHarness.mockReset().mockResolvedValue('claude-code');
  mocks.deliverInitialPromptWithRetry.mockReset().mockResolvedValue({ ok: true });
  mocks.deliverResumeMessageWithTranscriptConfirmation.mockReset().mockResolvedValue({ delivered: true, attempts: 1 });

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
function writeStoppedAgent(
  agentId: string,
  previousBackend: TerminalBackendName,
  status: 'stopped' | 'running' = 'stopped',
  harness: 'claude-code' | 'acp' | 'kimi-code' = 'claude-code',
): void {
  const sessionId = `${agentId}-session`;
  const transcriptPath = sessionFilePath(workspace, sessionId);
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, '{"type":"summary","summary":"prior work"}\n');
  mkdirSync(getAgentDir(agentId), { recursive: true });
  appendSessionIdToHistory(agentId, sessionId, 'launcher');
  if (harness === 'acp') writeFileSync(join(getAgentDir(agentId), 'acp-session-id'), sessionId);
  if (harness === 'kimi-code') writeFileSync(join(getAgentDir(agentId), 'kimi-session-id'), sessionId);
  saveAgentStateSync({
    id: agentId,
    issueId: 'PAN-3960',
    workspace,
    harness,
    role: 'work',
    model: harness === 'kimi-code' ? 'kimi-code/k3' : 'claude-sonnet-5',
    status,
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

describe('resumeAgent relaunches on the host backend (PAN-3960)', () => {
  it.each(cases)('$host host, agent previously on $previous', async ({ host, previous }) => {
    mocks.host = host;
    const agentId = `agent-pan-3960-resume-${host}`;
    writeStoppedAgent(agentId, previous);

    const result = await resumeAgent(agentId);

    expect(result).toEqual({ success: true, messageDelivered: true });
    const selected = host === 'herdr' ? herdr : tmux;
    const other = host === 'herdr' ? tmux : herdr;
    expect(other.starts).toHaveLength(0);
    expect(selected.starts).toHaveLength(1);
    expect(selected.starts[0]!.spec).toMatchObject({
      name: agentId,
      cwd: workspace,
      argv: ['bash', join(getAgentDir(agentId), 'launcher.sh')],
      tokens: { issue: 'PAN-3960', role: 'work', harness: 'claude-code', model: 'claude-sonnet-5' },
      env: expect.objectContaining({ OVERDECK_AGENT_ID: agentId, OVERDECK_ISSUE_ID: 'PAN-3960' }),
    });
    expect(selected.starts[0]!.workspace.issueId).toBe('PAN-3960');
    expect(mocks.tmuxCreateSession).not.toHaveBeenCalled();
    expect(getAgentState(agentId)?.backend).toBe(host);
  });
});

describe('resumeAgent marks the relaunch as starting (PAN-3923 review, F3)', () => {
  it('holds status starting while the relaunched harness boots, then running once the message lands', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3923-resume-starting';
    writeStoppedAgent(agentId, 'herdr');
    const statusAtLaunch: Array<string | undefined> = [];
    const statusWhileBooting: Array<string | undefined> = [];
    const realStart = herdr.startAgent;
    vi.spyOn(herdr, 'startAgent').mockImplementation((workspaceRef, spec) => {
      statusAtLaunch.push(getAgentState(agentId)?.status);
      return realStart(workspaceRef, spec);
    });
    mocks.waitForPromptReady.mockImplementation(async () => {
      statusWhileBooting.push(getAgentState(agentId)?.status);
      return true;
    });

    const result = await resumeAgent(agentId);

    expect(result).toEqual({ success: true, messageDelivered: true });
    // A concurrent same-id dispatch reads `starting` for the whole boot and never reaps.
    expect(statusAtLaunch).toEqual(['starting']);
    expect(statusWhileBooting.every((status) => status === 'starting')).toBe(true);
    expect(getAgentState(agentId)?.status).toBe('running');
  });
});

describe('resumeAgent restores the prior status when the relaunch fails (PAN-3923 review 2)', () => {
  type FailureExit = 'acp-delivery' | 'kimi-delivery' | 'continue-unconfirmed' | 'launch-throws';
  const failureCases: Array<{ exit: FailureExit; prior: 'stopped' | 'running' }> = [
    { exit: 'acp-delivery', prior: 'stopped' },
    { exit: 'kimi-delivery', prior: 'stopped' },
    { exit: 'continue-unconfirmed', prior: 'stopped' },
    { exit: 'continue-unconfirmed', prior: 'running' },
    { exit: 'launch-throws', prior: 'stopped' },
    { exit: 'launch-throws', prior: 'running' },
  ];

  it.each(failureCases)('$exit leaves a $prior run at $prior, not starting', async ({ exit, prior }) => {
    mocks.host = 'herdr';
    const agentId = `agent-pan-3923-resume-fail-${exit}-${prior}`;
    // A `running` prior status here is a crashed run: no pane, no process.
    const harness = exit === 'acp-delivery' ? 'acp' : exit === 'kimi-delivery' ? 'kimi-code' : 'claude-code';
    writeStoppedAgent(agentId, 'herdr', prior, harness);
    mocks.resolveHarness.mockResolvedValueOnce(harness);
    const stoppedAtBefore = getAgentState(agentId)?.stoppedAt;
    const statusAtLaunch: Array<string | undefined> = [];
    const realStart = herdr.startAgent;
    vi.spyOn(herdr, 'startAgent').mockImplementation((workspaceRef, spec) => {
      statusAtLaunch.push(getAgentState(agentId)?.status);
      if (exit === 'launch-throws') throw new Error('herdr socket closed mid-launch');
      return realStart(workspaceRef, spec);
    });
    if (exit === 'acp-delivery') {
      mocks.deliverInitialPromptWithRetry.mockResolvedValueOnce({ ok: false, failure: 'acp session refused the prompt' });
    } else if (exit === 'kimi-delivery') {
      mocks.deliverInitialPromptWithRetry.mockResolvedValueOnce({ ok: false, failure: 'kimi prompt never landed' });
    } else if (exit === 'continue-unconfirmed') {
      mocks.deliverResumeMessageWithTranscriptConfirmation.mockResolvedValueOnce({ delivered: false, attempts: 3 });
    }

    const result = await resumeAgent(agentId);

    expect(result.success).toBe(false);
    // The relaunch really ran under `starting` — the restore is what undoes it.
    expect(statusAtLaunch).toEqual(['starting']);
    const after = getAgentState(agentId);
    expect(after?.status).toBe(prior);
    expect(after?.stoppedAt).toBe(stoppedAtBefore);
  });
});

describe('resumeAgent on a Herdr host (review of #3992)', () => {
  it('reads and keys the relaunched Herdr pane for the resume-summary gate (M2)', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-resume-gate-pane';
    writeStoppedAgent(agentId, 'herdr');

    const result = await resumeAgent(agentId);

    expect(result).toEqual({ success: true, messageDelivered: true });
    expect(mocks.prepareAutonomousAgentResumePane).toHaveBeenCalledWith(agentId, 'work', {
      pane: expect.objectContaining({ backend: 'herdr', paneId: `w1:p-${agentId}` }),
    });
  });

  it('fails the resume, without delivering, when the gate check fails safe (M2)', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-resume-gate-unreadable';
    writeStoppedAgent(agentId, 'herdr');
    mocks.prepareAutonomousAgentResumePane.mockResolvedValueOnce({
      ready: false,
      reason: 'could not read herdr pane',
    } as never);

    const result = await resumeAgent(agentId);

    expect(result.success).toBe(false);
    expect(mocks.deliverResumeMessageWithTranscriptConfirmation).not.toHaveBeenCalled();
  });

  it('refuses to resume a running agent whose legacy tmux session is live — no close, no relaunch (M3)', async () => {
    mocks.host = 'herdr';
    const agentId = 'agent-pan-3960-resume-legacy-tmux';
    writeStoppedAgent(agentId, 'tmux', 'running');
    mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(true));
    mocks.queryTmuxSession.mockResolvedValue('exists');
    mocks.tmuxListPaneValues.mockResolvedValue(['4242\t0']);
    mocks.findRuntimePid.mockResolvedValue(4243);

    const result = await resumeAgent(agentId);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/appears healthy/);
    expect(herdr.starts).toHaveLength(0);
    expect(tmux.starts).toHaveLength(0);
    expect(herdr.closes).toHaveLength(0);
    expect(tmux.closes).toHaveLength(0);
    expect(mocks.tmuxKillSession).not.toHaveBeenCalled();
  });
});
