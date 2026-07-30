/**
 * PAN-1837 review fix (cycle 5, P2): a fresh Kimi Code restart must not
 * report success while the replacement session identity capture is still
 * unresolved — restartAgent() now awaits the capture and fails loudly
 * (cleaning up the zombie session) when no new session directory ever
 * appears, instead of leaving the pointer cleared and letting the
 * newest-session-by-mtime fallback attribute a different same-cwd Kimi
 * session's transcript/cost to this agent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/kimi/bin/kimi', pathExport: "export PATH='/opt/kimi/bin':\"$PATH\"" })),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false, supervisorScriptPath: undefined })),
  resolveHarness: vi.fn(async () => 'kimi-code'),
  waitForPromptReady: vi.fn(async () => true),
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'supervisor' })),
  waitForNewKimiSessionAsync: vi.fn(async () => null),
  killSession: vi.fn(() => Effect.succeed(undefined)),
  stopAgent: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock('../spawn-prep.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../spawn-prep.js')>();
  return {
    ...actual,
    assertWorkspaceStackHealthyForSpawn: mocks.assertWorkspaceStackHealthyForSpawn,
  };
});

vi.mock('../../harness-binary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../harness-binary.js')>();
  return {
    ...actual,
    prepareHarnessLaunch: mocks.prepareHarnessLaunch,
  };
});

vi.mock('../supervisor-channels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor-channels.js')>();
  return {
    ...actual,
    prepareSupervisorForRelaunch: mocks.prepareSupervisorForRelaunch,
  };
});

vi.mock('../../harness-resolve.js', () => ({
  resolveHarness: mocks.resolveHarness,
}));

vi.mock('../runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime-command.js')>();
  return {
    ...actual,
    waitForPromptReady: mocks.waitForPromptReady,
  };
});

vi.mock('../delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../delivery.js')>();
  return {
    ...actual,
    deliverAgentMessage: mocks.deliverAgentMessage,
  };
});

vi.mock('../../runtimes/kimi-code.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtimes/kimi-code.js')>();
  return {
    ...actual,
    waitForNewKimiSessionAsync: mocks.waitForNewKimiSessionAsync,
  };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  return {
    ...actual,
    createSession: vi.fn(() => Effect.succeed(undefined)),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    killSession: mocks.killSession,
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    listPaneValues: vi.fn(() => Effect.succeed([])),
  };
});

vi.mock('../termination.js', () => ({
  stopAgent: mocks.stopAgent,
}));

import { restartAgent } from '../recovery.js';
import { saveAgentStateSync, getAgentDir } from '../agent-state.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertWorkspaceStackHealthyForSpawn.mockResolvedValue(undefined);
  mocks.prepareHarnessLaunch.mockResolvedValue({ binaryPath: '/opt/kimi/bin/kimi', pathExport: "export PATH='/opt/kimi/bin':\"$PATH\"" });
  mocks.prepareSupervisorForRelaunch.mockResolvedValue({ useSupervisor: false, supervisorScriptPath: undefined });
  mocks.resolveHarness.mockResolvedValue('kimi-code');
  mocks.waitForPromptReady.mockResolvedValue(true);
  mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'supervisor' });
  mocks.waitForNewKimiSessionAsync.mockResolvedValue(null);
  mocks.killSession.mockReturnValue(Effect.succeed(undefined));
  mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));

  tempHome = mkdtempSync(join(tmpdir(), 'pan-restart-kimi-test-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspace = mkdtempSync(join(tmpdir(), 'pan-restart-kimi-workspace-'));
});

afterEach(() => {
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('restartAgent — Kimi Code fresh-relaunch session capture (PAN-1837 review fix)', () => {
  it('fails and cleans up instead of reporting success when the replacement session id never appears', async () => {
    const agentId = 'agent-kimi-restart-timeout';

    mkdirSync(getAgentDir(agentId), { recursive: true });
    writeFileSync(join(getAgentDir(agentId), 'kimi-session-id'), 'stale-pre-restart-session\n');

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1837',
      workspace,
      harness: 'kimi-code',
      role: 'work',
      model: 'kimi-code/k3',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      kickoffDelivered: true,
    });

    const result = await restartAgent(agentId, { graceful: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain('kimi-code session capture timed out');
    // stopAgent fires once up front (clearing any zombie session before
    // relaunch) and a SECOND time from the catch block's failure cleanup —
    // that second call is the proof this must not be reported as a healthy
    // restart left running in the background.
    expect(mocks.stopAgent).toHaveBeenCalledTimes(2);
  });

  it('succeeds and pins the new session id when capture finds a fresh directory', async () => {
    mocks.waitForNewKimiSessionAsync.mockResolvedValue('fresh-session-abc');
    const agentId = 'agent-kimi-restart-success';

    mkdirSync(getAgentDir(agentId), { recursive: true });
    writeFileSync(join(getAgentDir(agentId), 'kimi-session-id'), 'stale-pre-restart-session\n');

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1837',
      workspace,
      harness: 'kimi-code',
      role: 'work',
      model: 'kimi-code/k3',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      kickoffDelivered: true,
    });

    const result = await restartAgent(agentId, { graceful: false });

    expect(result.success).toBe(true);
    // stopAgent is always called once up front to clear any zombie session
    // before relaunching; it must NOT be called a second time by the catch
    // block's failure cleanup, unlike the timeout case above.
    expect(mocks.stopAgent).toHaveBeenCalledTimes(1);
  });
});
