/**
 * PAN-4253: restartAgent must re-apply the persisted effort on every
 * restart instead of letting the launcher fall back to the role
 * frontmatter default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' })),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false, supervisorScriptPath: undefined })),
  resolveHarness: vi.fn(async () => 'claude-code'),
  waitForPromptReady: vi.fn(async () => true),
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'supervisor' })),
  stopAgent: vi.fn(() => Effect.succeed(undefined)),
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

vi.mock('../../harness-resolve.js', () => ({ resolveHarness: mocks.resolveHarness }));

vi.mock('../runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime-command.js')>();
  return { ...actual, waitForPromptReady: mocks.waitForPromptReady };
});

vi.mock('../delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../delivery.js')>();
  return { ...actual, deliverAgentMessage: mocks.deliverAgentMessage };
});

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmux.js')>();
  return {
    ...actual,
    createSession: vi.fn(() => Effect.succeed(undefined)),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    killSession: vi.fn(() => Effect.succeed(undefined)),
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    listPaneValues: vi.fn(async () => []),
  };
});

vi.mock('../termination.js', () => ({ stopAgent: mocks.stopAgent }));

import { restartAgent } from '../recovery.js';
import { saveAgentStateSync, getAgentDir, getAgentState } from '../agent-state.js';
import { readSessionIndex } from '../../session-history.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertWorkspaceStackHealthyForSpawn.mockResolvedValue(undefined);
  mocks.prepareHarnessLaunch.mockResolvedValue({ binaryPath: '/opt/claude/bin/claude', pathExport: 'export PATH="$PATH"' });
  mocks.prepareSupervisorForRelaunch.mockResolvedValue({ useSupervisor: false, supervisorScriptPath: undefined });
  mocks.resolveHarness.mockResolvedValue('claude-code');
  mocks.waitForPromptReady.mockResolvedValue(true);
  mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'supervisor' });
  mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));

  tempHome = mkdtempSync(join(tmpdir(), 'pan-4253-restart-effort-home-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspace = mkdtempSync(join(tmpdir(), 'pan-4253-restart-effort-ws-'));
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

describe('restartAgent re-applies the persisted effort (PAN-4253)', () => {
  it('re-applies a persisted explicit effort and keeps it on state', async () => {
    const agentId = 'agent-restart-effort-max';
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

    const result = await restartAgent(agentId, { graceful: false });

    expect(result.success).toBe(true);
    expect(readLauncher(agentId)).toContain('--effort max');
    expect(getAgentState(agentId)?.effort).toBe('max');
  });

  it('resolves legacy state (no persisted effort) to the role default and writes it back', async () => {
    const agentId = 'agent-restart-effort-legacy';
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

    const result = await restartAgent(agentId, { graceful: false });

    expect(result.success).toBe(true);
    expect(readLauncher(agentId)).toContain('--effort high');
    const after = getAgentState(agentId);
    expect(after?.effort).toBe('high');
    expect(after?.effortSource).toBe('default');
  });

  it('records the relaunch effort on the new sessions.json line', async () => {
    const agentId = 'agent-restart-effort-sessions-json';
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

    const result = await restartAgent(agentId, { graceful: false });

    expect(result.success).toBe(true);
    expect(readSessionIndex(agentId).at(-1)?.effort).toBe('high');
  });
});
