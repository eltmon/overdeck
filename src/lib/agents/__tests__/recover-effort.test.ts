/**
 * PAN-4253: recoverAgent must re-apply the persisted effort on every
 * recovery branch instead of letting the launcher fall back to the role
 * frontmatter default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' })),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false, supervisorScriptPath: undefined })),
  deliverInitialPromptWithRetry: vi.fn(async () => ({ ok: true, path: 'supervisor' })),
  stopAgent: vi.fn(() => Effect.succeed(undefined)),
  sessionExistsSync: vi.fn(() => false),
  getProviderEnvForModel: vi.fn(async () => ({})),
  getProviderExportsForModel: vi.fn(async () => ''),
}));

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

vi.mock('../delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../delivery.js')>();
  return { ...actual, deliverInitialPromptWithRetry: mocks.deliverInitialPromptWithRetry };
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

vi.mock('../termination.js', () => ({ stopAgent: mocks.stopAgent }));

vi.mock('../provider-env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../provider-env.js')>();
  return {
    ...actual,
    getProviderEnvForModel: mocks.getProviderEnvForModel,
    getProviderExportsForModel: mocks.getProviderExportsForModel,
  };
});

import { recoverAgent } from '../recovery.js';
import { saveAgentStateSync, getAgentDir, getAgentState } from '../agent-state.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertWorkspaceStackHealthyForSpawn.mockResolvedValue(undefined);
  mocks.prepareHarnessLaunch.mockResolvedValue({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' });
  mocks.prepareSupervisorForRelaunch.mockResolvedValue({ useSupervisor: false, supervisorScriptPath: undefined });
  mocks.deliverInitialPromptWithRetry.mockResolvedValue({ ok: true, path: 'supervisor' });
  mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
  mocks.sessionExistsSync.mockReturnValue(false);
  mocks.getProviderEnvForModel.mockResolvedValue({});
  mocks.getProviderExportsForModel.mockResolvedValue('');

  tempHome = mkdtempSync(join(tmpdir(), 'pan-4253-recover-effort-home-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspace = mkdtempSync(join(tmpdir(), 'pan-4253-recover-effort-ws-'));
});

afterEach(() => {
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

function readLauncher(agentId: string): string {
  return readFileSync(join(getAgentDir(agentId), 'launcher.sh'), 'utf8');
}

describe('recoverAgent re-applies the persisted effort (PAN-4253)', () => {
  it('re-applies a persisted explicit effort on the claude-code default branch', async () => {
    const agentId = 'agent-recover-effort-max';
    mkdirSync(getAgentDir(agentId), { recursive: true });
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
      effort: 'max',
      effortSource: 'explicit',
    } as never);

    const result = await recoverAgent(agentId, { force: true });

    expect(result).not.toBeNull();
    expect(readLauncher(agentId)).toContain('--effort max');
  });

  it('resolves legacy state (no persisted effort) to the role default', async () => {
    const agentId = 'agent-recover-effort-legacy';
    mkdirSync(getAgentDir(agentId), { recursive: true });
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
    });

    const result = await recoverAgent(agentId, { force: true });

    expect(result).not.toBeNull();
    expect(readLauncher(agentId)).toContain('--effort high');
  });
});
