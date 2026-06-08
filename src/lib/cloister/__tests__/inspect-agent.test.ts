import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  execFileAsync: vi.fn(),
  existsSync: vi.fn(),
  generateLauncherScriptSync: vi.fn(),
  getDiffBase: vi.fn(),
  getDiffStats: vi.fn(),
  getProviderEnvForModel: vi.fn(),
  isIssueClosed: vi.fn(),
  killSession: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  sessionExists: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock('child_process', () => {
  function execFile(): void {
    throw new Error('execFile callback form is not used in inspect-agent tests');
  }

  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = mocks.execFileAsync;
  return { exec: vi.fn(), execFile };
});

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

vi.mock('../inspect-checkpoints.js', () => ({
  getCurrentHead: vi.fn(() => Effect.succeed('abcdef123456')),
  getDiffBase: mocks.getDiffBase,
  getDiffStats: mocks.getDiffStats,
  saveCheckpoint: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  setReviewStatusSync: vi.fn(),
}));

vi.mock('../../bd-mutex.js', () => ({
  withBdMutex: <T>(effect: T) => effect,
}));

vi.mock('../../launcher-generator.js', () => ({
  generateLauncherScriptSync: mocks.generateLauncherScriptSync,
}));

vi.mock('../../tmux.js', () => ({
  createSession: mocks.createSession,
  killSession: mocks.killSession,
  sessionExists: mocks.sessionExists,
}));

vi.mock('../../config-yaml.js', () => ({
  loadConfigSync: vi.fn(() => ({ config: {} })),
  resolveModel: vi.fn(() => 'claude-sonnet-4-6'),
}));

vi.mock('../../claude-permissions.js', () => ({
  bypassPrefixForAgentFlagSync: vi.fn(() => ''),
}));

vi.mock('../../providers.js', () => ({
  clearCredentialFileAuthSync: vi.fn(),
  getProviderForModelSync: vi.fn(() => ({ authType: 'none' })),
  setupCredentialFileAuthSync: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  getProviderEnvForModel: mocks.getProviderEnvForModel,
  saveAgentRuntimeState: mocks.saveAgentRuntimeState,
}));

import { spawnInspectAgent } from '../inspect-agent.js';

describe('spawnInspectAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mocks.killSession.mockReturnValue(Effect.succeed(undefined));
    mocks.createSession.mockReturnValue(Effect.succeed(undefined));
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue('Inspect {{issueId}} {{beadId}} {{diffBase}} {{diffStats}} {{beadDescription}}');
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ title: 'bead title' }), stderr: '' });
    mocks.getDiffBase.mockReturnValue(Effect.succeed('abcdef1234567890'));
    mocks.getDiffStats.mockReturnValue(Effect.succeed('diff stats'));
    mocks.getProviderEnvForModel.mockResolvedValue({});
    mocks.generateLauncherScriptSync.mockReturnValue('#!/usr/bin/env bash\n');
  });

  it('skips inspect dispatch when the issue is closed', async () => {
    mocks.isIssueClosed.mockResolvedValue(true);

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'panopticon',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      skipped: true,
      message: 'PAN-1613: skipping inspect dispatch — issue is closed',
    }));
    expect(mocks.sessionExists).not.toHaveBeenCalled();
    expect(mocks.generateLauncherScriptSync).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('spawns inspect normally when the issue is open', async () => {
    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'panopticon',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tmuxSession: 'inspect-pan-1613-workspace-b95lw',
      message: 'Spawned inspect for PAN-1613 bead workspace-b95lw',
    }));
    expect(result.skipped).toBeUndefined();
    expect(mocks.sessionExists).toHaveBeenCalledWith('inspect-pan-1613-workspace-b95lw');
    expect(mocks.generateLauncherScriptSync).toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith(
      'inspect-pan-1613-workspace-b95lw',
      '/workspace',
      expect.stringContaining('launcher.sh'),
      expect.any(Object),
    );
  });
});
