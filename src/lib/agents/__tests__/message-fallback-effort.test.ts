/**
 * PAN-4253: the messaging fresh-launch fallback (session rotation path) must
 * re-apply the persisted effort instead of letting the launcher fall back to
 * the role frontmatter default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  resumeAgent: vi.fn(async () => ({ success: false, error: 'session not found' })),
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
  closeAgentPane: vi.fn(async () => undefined),
  launchAgentPane: vi.fn(async () => ({ backend: 'tmux' as const, paneId: 'w1:p1', terminalId: undefined })),
  waitForPromptReady: vi.fn(async () => true),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false, supervisorScriptPath: undefined })),
  buildResumeMessageForAgent: vi.fn(async () => ({ error: 'test short-circuit: no transcript to resume' })),
  markKickoffRedelivered: vi.fn(),
}));

vi.mock('../../session-rotation.js', () => ({ ALLOW_SESSION_ROTATION_ON_RESUME: true }));

vi.mock('../../agents.js', () => ({
  resumeAgent: mocks.resumeAgent,
  assertWorkspaceStackHealthyForSpawn: mocks.assertWorkspaceStackHealthyForSpawn,
  resolveRoutedSpawnModel: vi.fn(() => { throw new Error('resolveRoutedSpawnModel must not be called when state.model is set'); }),
}));

vi.mock('../../terminal-backends/launch.js', () => ({
  closeAgentPane: mocks.closeAgentPane,
  launchAgentPane: mocks.launchAgentPane,
}));

vi.mock('../runtime-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime-command.js')>();
  return { ...actual, waitForPromptReady: mocks.waitForPromptReady };
});

vi.mock('../supervisor-channels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supervisor-channels.js')>();
  return {
    ...actual,
    prepareSupervisorForRelaunch: mocks.prepareSupervisorForRelaunch,
    buildResumeMessageForAgent: mocks.buildResumeMessageForAgent,
    markKickoffRedelivered: mocks.markKickoffRedelivered,
  };
});

import { messageAgent } from '../messaging.js';
import { getAgentDir, saveAgentStateSync } from '../agent-state.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resumeAgent.mockResolvedValue({ success: false, error: 'session not found' });
  mocks.assertWorkspaceStackHealthyForSpawn.mockResolvedValue(undefined);
  mocks.closeAgentPane.mockResolvedValue(undefined);
  mocks.launchAgentPane.mockResolvedValue({ backend: 'tmux', paneId: 'w1:p1', terminalId: undefined });
  mocks.waitForPromptReady.mockResolvedValue(true);
  mocks.prepareSupervisorForRelaunch.mockResolvedValue({ useSupervisor: false, supervisorScriptPath: undefined });
  mocks.buildResumeMessageForAgent.mockResolvedValue({ error: 'test short-circuit: no transcript to resume' });

  tempHome = mkdtempSync(join(tmpdir(), 'pan-4253-message-fallback-home-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspace = mkdtempSync(join(tmpdir(), 'pan-4253-message-fallback-ws-'));
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

describe('messageAgent fresh-launch fallback re-applies the persisted effort (PAN-4253)', () => {
  it('writes the persisted effort into the fallback launcher', async () => {
    const agentId = 'agent-message-fallback-effort-max';
    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-4253',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-opus-5-5',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      effort: 'max',
      effortSource: 'explicit',
    } as never);

    await messageAgent(agentId, 'feedback for the stopped agent');

    expect(readLauncher(agentId)).toContain('--effort max');
  });

  it('resolves legacy state (no persisted effort) to the role default', async () => {
    const agentId = 'agent-message-fallback-effort-legacy';
    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-4253',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-opus-5-5',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });

    await messageAgent(agentId, 'feedback for the stopped agent');

    expect(readLauncher(agentId)).toContain('--effort high');
  });
});
