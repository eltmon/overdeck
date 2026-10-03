/**
 * PAN-4253: resumeAgent must re-apply the persisted effort on every relaunch
 * instead of letting the launcher fall back to the role frontmatter default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
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
    probeHerdrAvailability: vi.fn(async () => ({
      binary: '/usr/bin/herdr', session: 'overdeck', socket: '/tmp/herdr.sock', socketExists: true, available: true,
    })),
  };
});

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
let tempHome: string;
let workspace: string;
let prevHome: string | undefined;
let prevOverdeckHome: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.host = 'herdr';
  herdr = fakeTerminalBackend('herdr');
  registerTerminalBackend(herdr);
  mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(false));
  mocks.tmuxListPaneValues.mockResolvedValue([]);
  mocks.findRuntimePid.mockResolvedValue(null);
  mocks.queryTmuxSession.mockResolvedValue('missing');
  mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'herdr' });
  mocks.waitForPromptReady.mockResolvedValue(true);
  mocks.resolveHarness.mockReset().mockResolvedValue('claude-code');
  mocks.deliverInitialPromptWithRetry.mockReset().mockResolvedValue({ ok: true });
  mocks.deliverResumeMessageWithTranscriptConfirmation.mockReset().mockResolvedValue({ delivered: true, attempts: 1 });

  tempHome = mkdtempSync(join(tmpdir(), 'pan-4253-resume-effort-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-4253-resume-effort-ws-'));
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

function writeStoppedAgent(agentId: string, extra: Record<string, unknown> = {}): void {
  const sessionId = `${agentId}-session`;
  const transcriptPath = sessionFilePath(workspace, sessionId);
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath, '{"type":"summary","summary":"prior work"}\n');
  mkdirSync(getAgentDir(agentId), { recursive: true });
  appendSessionIdToHistory(agentId, sessionId, 'launcher');
  saveAgentStateSync({
    id: agentId,
    issueId: 'PAN-4253',
    workspace,
    harness: 'claude-code',
    role: 'work',
    model: 'claude-opus-5-5',
    status: 'stopped',
    startedAt: new Date().toISOString(),
    kickoffDelivered: true,
    sessionId,
    backend: 'herdr',
    paneId: 'w1:p-' + agentId,
    ...extra,
  } as never);
}

function readLauncher(agentId: string): string {
  return readFileSync(join(getAgentDir(agentId), 'launcher.sh'), 'utf8');
}

describe('resumeAgent re-applies the persisted effort (PAN-4253)', () => {
  it('re-applies a persisted explicit effort and keeps it on state', async () => {
    const agentId = 'agent-pan-4253-resume-max';
    writeStoppedAgent(agentId, { effort: 'max', effortSource: 'explicit' });

    const result = await resumeAgent(agentId);

    expect(result.success).toBe(true);
    expect(readLauncher(agentId)).toContain('--effort max');
    expect(getAgentState(agentId)?.effort).toBe('max');
  });

  it('resolves legacy state (no persisted effort) to the role default and writes it back', async () => {
    const agentId = 'agent-pan-4253-resume-legacy';
    writeStoppedAgent(agentId);

    const result = await resumeAgent(agentId);

    expect(result.success).toBe(true);
    expect(readLauncher(agentId)).toContain('--effort high');
    const after = getAgentState(agentId);
    expect(after?.effort).toBe('high');
    expect(after?.effortSource).toBe('default');
  });
});
