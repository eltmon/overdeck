/**
 * PAN-4683 WI-5: createRemoteWorkspace pushes the local feature branch before
 * it creates the VM, and creates no VM when that push fails.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projectRoot: '',
  pushFeatureBranch: vi.fn(),
  createVm: vi.fn(),
}));

vi.mock('../config.js', () => ({
  loadConfigSync: () => ({ remote: { enabled: true } }),
}));

vi.mock('../remote/index.js', () => ({
  createFlyProviderFromConfig: () => ({ createVm: mocks.createVm }),
}));

vi.mock('../projects.js', () => ({
  extractTeamPrefix: () => 'PAN',
  findProjectByTeam: () => ({ path: mocks.projectRoot }),
  resolveProjectFromIssueSync: () => null,
  getIssuePrefix: () => 'PAN',
}));

vi.mock('../overdeck/feature-branch-push.js', () => ({
  pushFeatureBranch: mocks.pushFeatureBranch,
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: (_command: string, _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: 'https://github.com/x/y.git\n', stderr: '' });
    },
  };
});

import { createRemoteWorkspace } from '../remote-workspace.js';

describe('createRemoteWorkspace pushes before provisioning (PAN-4683)', () => {
  beforeEach(() => {
    mocks.projectRoot = mkdtempSync(join(tmpdir(), 'remote-workspace-push-'));
    mocks.pushFeatureBranch.mockReset();
    mocks.createVm.mockReset();
    mocks.createVm.mockImplementation(() => Effect.fail(new Error('stop')));
  });

  afterEach(() => {
    rmSync(mocks.projectRoot, { recursive: true, force: true });
  });

  function createWorkspaceGit(): string {
    const workspace = join(mocks.projectRoot, 'workspaces', 'feature-pan-9004');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, '.git'), 'gitdir: /elsewhere\n');
    return workspace;
  }

  it('throws before creating a VM when the push is rejected', async () => {
    createWorkspaceGit();
    mocks.pushFeatureBranch.mockResolvedValue({ pushed: false, reason: 'rejected' });

    await expect(createRemoteWorkspace('PAN-9004')).rejects.toThrow(/Could not push feature\/pan-9004/);
    expect(mocks.createVm).not.toHaveBeenCalled();
  });

  it('pushes the local feature branch before creating the VM', async () => {
    const workspace = createWorkspaceGit();
    mocks.pushFeatureBranch.mockResolvedValue({ pushed: true });

    await expect(createRemoteWorkspace('PAN-9004')).rejects.toThrow(/stop/);
    expect(mocks.pushFeatureBranch).toHaveBeenCalledWith({ cwd: workspace, branch: 'feature/pan-9004' });
    expect(mocks.pushFeatureBranch.mock.invocationCallOrder[0]).toBeLessThan(mocks.createVm.mock.invocationCallOrder[0]);
  });

  it('skips the push when there is no local workspace checkout', async () => {
    await expect(createRemoteWorkspace('PAN-9004')).rejects.toThrow(/stop/);
    expect(mocks.pushFeatureBranch).not.toHaveBeenCalled();
    expect(mocks.createVm).toHaveBeenCalled();
  });
});
