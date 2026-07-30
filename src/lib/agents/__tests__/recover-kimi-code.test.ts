/**
 * PAN-1837 review fix (cycle 7, P2): a fresh Kimi Code recovery must not
 * leave a running, unowned Kimi session when the replacement session
 * identity can't be captured — recoverAgent()'s kimi-code branch now fails
 * closed (stops the process, reports failure) instead of logging and
 * continuing to mark the agent running with no captured pointer.
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
  deliverInitialPromptWithRetry: vi.fn(async () => ({ ok: true, path: 'supervisor' })),
  waitForNewKimiSessionAsync: vi.fn(async () => null),
  stopAgent: vi.fn(() => Effect.succeed(undefined)),
  sessionExistsSync: vi.fn(() => false),
  getProviderEnvForModel: vi.fn(async () => ({})),
  getProviderExportsForModel: vi.fn(async () => ''),
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

vi.mock('../delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../delivery.js')>();
  return {
    ...actual,
    deliverInitialPromptWithRetry: mocks.deliverInitialPromptWithRetry,
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
    sessionExistsSync: mocks.sessionExistsSync,
    killSessionSync: vi.fn(),
  };
});

vi.mock('../termination.js', () => ({
  stopAgent: mocks.stopAgent,
}));

vi.mock('../provider-env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../provider-env.js')>();
  return {
    ...actual,
    getProviderEnvForModel: mocks.getProviderEnvForModel,
    getProviderExportsForModel: mocks.getProviderExportsForModel,
  };
});

import { recoverAgent } from '../recovery.js';
import { saveAgentStateSync, getAgentDir } from '../agent-state.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertWorkspaceStackHealthyForSpawn.mockResolvedValue(undefined);
  mocks.prepareHarnessLaunch.mockResolvedValue({ binaryPath: '/opt/kimi/bin/kimi', pathExport: "export PATH='/opt/kimi/bin':\"$PATH\"" });
  mocks.prepareSupervisorForRelaunch.mockResolvedValue({ useSupervisor: false, supervisorScriptPath: undefined });
  mocks.deliverInitialPromptWithRetry.mockResolvedValue({ ok: true, path: 'supervisor' });
  mocks.waitForNewKimiSessionAsync.mockResolvedValue(null);
  mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
  mocks.sessionExistsSync.mockReturnValue(false);
  mocks.getProviderEnvForModel.mockResolvedValue({});
  mocks.getProviderExportsForModel.mockResolvedValue('');

  tempHome = mkdtempSync(join(tmpdir(), 'pan-recover-kimi-test-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspace = mkdtempSync(join(tmpdir(), 'pan-recover-kimi-workspace-'));
});

afterEach(() => {
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('recoverAgent — Kimi Code fresh-relaunch session capture (PAN-1837 review fix)', () => {
  it('throws and stops the agent instead of marking it running when the replacement session id never appears', async () => {
    const agentId = 'agent-kimi-recover-timeout';

    mkdirSync(getAgentDir(agentId), { recursive: true });

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

    await expect(recoverAgent(agentId, { force: true })).rejects.toThrow('kimi-code session capture timed out');
    expect(mocks.stopAgent).toHaveBeenCalledWith(agentId);
  });

  it('succeeds and pins the new session id when capture finds a fresh directory', async () => {
    mocks.waitForNewKimiSessionAsync.mockResolvedValue('fresh-recover-session');
    const agentId = 'agent-kimi-recover-success';

    mkdirSync(getAgentDir(agentId), { recursive: true });

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

    const result = await recoverAgent(agentId, { force: true });

    expect(result).not.toBeNull();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
  });
});
