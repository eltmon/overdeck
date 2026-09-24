import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, exec: vi.fn() };
});

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return { ...actual, promisify: () => mockExecAsync };
});

const isWorktreeAddCall = (command: unknown, args?: unknown): boolean =>
  (typeof command === 'string' && command.includes('git worktree add'))
  || (command === 'git' && Array.isArray(args) && args[0] === 'worktree' && args[1] === 'add');

const isInstallCall = (command: unknown): boolean => command === 'npm install';

import { createWorkspace } from '../../../../src/lib/workspace-manager/create.js';
import {
  isWorkspaceSetupIncomplete,
  workspaceNeedsSetup,
} from '../../../../src/lib/workspace-manager/setup-marker.js';
import { upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';

let odb: OverdeckTestDb;
let tempDir: string;
let workspacePath: string;
let installShouldFail: boolean;

const projectConfig = () => ({ name: 'Test', path: tempDir });

beforeEach(() => {
  odb = setupOverdeckTestDb();
  tempDir = mkdtempSync(join(tmpdir(), 'pan-4171-resume-'));
  // Temp HOME: preTrustDirectory and the skills merge write under it.
  vi.stubEnv('HOME', join(tempDir, 'home'));
  mkdirSync(join(tempDir, 'home'), { recursive: true });
  workspacePath = join(tempDir, 'workspaces', 'feature-pan-4171');
  installShouldFail = true;
  upsertProjectFromConfig('test-project', projectConfig());

  mockExecAsync.mockReset();
  mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
    if (isWorktreeAddCall(command, args)) {
      // Real git is not run here; stand in for the worktree it would create.
      mkdirSync(workspacePath, { recursive: true });
      writeFileSync(join(workspacePath, '.git'), 'gitdir: elsewhere\n');
    }
    if (isInstallCall(command) && installShouldFail) {
      throw new Error('npm ERR! network unreachable');
    }
    return { stdout: '', stderr: '' };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  teardownOverdeckTestDb(odb);
  rmSync(tempDir, { recursive: true, force: true });
});

const worktreeAddCount = () => mockExecAsync.mock.calls.filter(([c, a]) => isWorktreeAddCall(c, a)).length;
const installCount = () => mockExecAsync.mock.calls.filter(([c]) => isInstallCall(c)).length;

describe('createWorkspace: an aborted setup is resumed, not skipped (PAN-4171)', () => {
  it('fails the create and leaves the worktree marked setup-incomplete when the dependency install fails', async () => {
    const result = await createWorkspace({ projectConfig: projectConfig(), featureName: 'pan-4171' });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Dependency install failed');
    expect(existsSync(workspacePath)).toBe(true);
    expect(isWorkspaceSetupIncomplete(workspacePath)).toBe(true);
    // The shared caller check says the existing directory still needs setup.
    expect(workspaceNeedsSetup(workspacePath)).toBe(true);
  });

  it('a retry fails again with the install error while the install keeps failing', async () => {
    await createWorkspace({ projectConfig: projectConfig(), featureName: 'pan-4171' });
    const retry = await createWorkspace({ projectConfig: projectConfig(), featureName: 'pan-4171' });

    expect(retry.success).toBe(false);
    expect(retry.errors.join(' ')).toContain('Dependency install failed');
    expect(retry.errors.join(' ')).not.toContain('already exists');
    expect(isWorkspaceSetupIncomplete(workspacePath)).toBe(true);
  });

  it('a retry resumes the setup in the existing worktree and completes it', async () => {
    await createWorkspace({ projectConfig: projectConfig(), featureName: 'pan-4171' });
    // Work written into the half-built worktree must survive the retry.
    writeFileSync(join(workspacePath, 'agent-work.txt'), 'keep me');

    installShouldFail = false;
    const retry = await createWorkspace({ projectConfig: projectConfig(), featureName: 'pan-4171' });

    expect(retry.errors).toEqual([]);
    expect(retry.success).toBe(true);
    expect(retry.steps).toContain('Resuming unfinished workspace setup');
    expect(retry.steps).toContain('Installed dependencies (npm)');
    expect(worktreeAddCount()).toBe(1);
    expect(installCount()).toBe(2);
    expect(existsSync(join(workspacePath, 'agent-work.txt'))).toBe(true);
    expect(isWorkspaceSetupIncomplete(workspacePath)).toBe(false);
    expect(workspaceNeedsSetup(workspacePath)).toBe(false);
  });

  it('a completed workspace carries no marker and a second create still refuses it', async () => {
    installShouldFail = false;
    const first = await createWorkspace({ projectConfig: projectConfig(), featureName: 'pan-4171' });
    expect(first.success).toBe(true);
    expect(workspaceNeedsSetup(workspacePath)).toBe(false);

    const second = await createWorkspace({ projectConfig: projectConfig(), featureName: 'pan-4171' });
    expect(second.success).toBe(false);
    expect(second.errors.join(' ')).toContain('already exists');
    expect(worktreeAddCount()).toBe(1);
  });
});
