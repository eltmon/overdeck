import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

const { mockExecAsync, mockCheckDiskFloor, mockReserveDiskFloor, mockEstimateWorkspaceDiskCost, mockRelease } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockCheckDiskFloor: vi.fn(),
  mockReserveDiskFloor: vi.fn(),
  mockEstimateWorkspaceDiskCost: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, exec: vi.fn() };
});

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return { ...actual, promisify: () => mockExecAsync };
});

// checkDiskFloor and reserveDiskFloor read real free space via statfs
// (PAN-4723, PAN-4961): mock both so tests don't fail on CI runners whose /tmp
// has less than the 10 GiB floor. The disk-cost estimator runs real git and
// docker, so it is mocked too.
vi.mock('../../../../src/lib/disk-floor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/disk-floor.js')>()),
  checkDiskFloor: mockCheckDiskFloor,
  reserveDiskFloor: mockReserveDiskFloor,
}));

vi.mock('../../../../src/lib/workspace/disk-cost.js', () => ({
  estimateWorkspaceDiskCost: mockEstimateWorkspaceDiskCost,
  invalidateWorkspaceDiskCostMemo: vi.fn(),
}));

const isWorktreeAddCall = (command: unknown, args?: unknown): boolean =>
  (typeof command === 'string' && command.includes('git worktree add'))
  || (command === 'git' && Array.isArray(args) && args[0] === 'worktree' && args[1] === 'add');

const isInstallCall = (command: unknown): boolean => typeof command === 'string' && command.trim().endsWith(' install');

import { DISK_LOW_HELD_PREFIX } from '../../../../src/lib/disk-floor.js';
import { createWorkspace } from '../../../../src/lib/workspace-manager/create.js';
import { isWorkspaceSetupIncomplete } from '../../../../src/lib/workspace-manager/setup-marker.js';
import { upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';

const HELD = `${DISK_LOW_HELD_PREFIX}: only 9.0 GiB free on the filesystem holding /x; the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.`;

let odb: OverdeckTestDb;
let tempDir: string;
let installShouldFail: boolean;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  tempDir = mkdtempSync(join(tmpdir(), 'pan-4961-create-'));
  // Temp HOME: preTrustDirectory and the skills merge write under it.
  vi.stubEnv('HOME', join(tempDir, 'home'));
  mkdirSync(join(tempDir, 'home'), { recursive: true });
  installShouldFail = false;
  upsertProjectFromConfig('test-project', { name: 'Test', path: tempDir });

  mockRelease.mockReset();
  mockRelease.mockResolvedValue(undefined);
  mockCheckDiskFloor.mockReset();
  mockCheckDiskFloor.mockResolvedValue(null);
  mockReserveDiskFloor.mockReset();
  mockReserveDiskFloor.mockResolvedValue({ ok: true, reservation: { release: mockRelease } });
  mockEstimateWorkspaceDiskCost.mockReset();
  mockEstimateWorkspaceDiskCost.mockResolvedValue({ hostBytes: 300, stackBytes: 2_000, hostSource: 'measured', stackSource: 'measured' });
  mockExecAsync.mockReset();
  mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
    if (isWorktreeAddCall(command, args)) {
      // Real git is not run here; stand in for the worktree it would create.
      const targetPath = args?.[args.length - 2] as string;
      mkdirSync(targetPath, { recursive: true });
      writeFileSync(join(targetPath, '.git'), 'gitdir: elsewhere\n');
      writeFileSync(join(targetPath, 'package.json'), JSON.stringify({ name: 'test', private: true }), 'utf8');
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
const installCalls = () => mockExecAsync.mock.calls.filter(([c]) => isInstallCall(c));

describe('createWorkspace disk admission (PAN-4961)', () => {
  it('refuses without running git worktree add when admission refuses (create-admission.ac1)', async () => {
    mockReserveDiskFloor.mockResolvedValue({ ok: false, error: HELD });

    const result = await createWorkspace({ projectConfig: { name: 'Test', path: tempDir }, featureName: 'pan-4961' });

    expect(result.success).toBe(false);
    expect(result.errors[0].startsWith('Disk low — new workspace starts are held')).toBe(true);
    expect(worktreeAddCount()).toBe(0);
  });

  it('releases the reservation exactly once after a successful setup (create-admission.ac2)', async () => {
    const result = await createWorkspace({ projectConfig: { name: 'Test', path: tempDir }, featureName: 'pan-4961' });

    expect(result.success).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation exactly once when the dependency install fails (create-admission.ac2)', async () => {
    installShouldFail = true;

    const result = await createWorkspace({ projectConfig: { name: 'Test', path: tempDir }, featureName: 'pan-4961' });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Dependency install failed');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('holds before the root install and keeps the setup-incomplete marker (create-admission.ac3)', async () => {
    const workspacePath = join(tempDir, 'workspaces', 'feature-pan-4961');
    mockCheckDiskFloor.mockImplementation(async (path: string) => (path === workspacePath ? HELD : null));

    const result = await createWorkspace({ projectConfig: { name: 'Test', path: tempDir }, featureName: 'pan-4961' });

    expect(result.success).toBe(false);
    expect(result.errors).toContain(HELD);
    expect(installCalls()).toHaveLength(0);
    expect(isWorkspaceSetupIncomplete(workspacePath)).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('re-checks before each polyrepo per-repo install (create-admission.ac3)', async () => {
    const workspacePath = join(tempDir, 'workspaces', 'feature-pan-4962');
    const workspace = {
      type: 'polyrepo' as const,
      repos: [
        { name: 'fe', path: 'frontend', package_manager: 'pnpm' as const },
        { name: 'api', path: 'api', package_manager: 'npm' as const },
      ],
    };
    upsertProjectFromConfig('test-project', { name: 'Test', path: tempDir, workspace });
    mockCheckDiskFloor.mockImplementation(async (path: string) => (path === join(workspacePath, 'api') ? HELD : null));

    const result = await createWorkspace({ projectConfig: { name: 'Test', path: tempDir, workspace }, featureName: 'pan-4962' });

    expect(result.success).toBe(false);
    expect(result.errors).toContain(HELD);
    const commands = installCalls().map(([command, options]) => [command, (options as { cwd?: string }).cwd]);
    expect(commands).toContainEqual(['pnpm install', join(workspacePath, 'fe')]);
    expect(commands.some(([, cwd]) => cwd === join(workspacePath, 'api'))).toBe(false);
  });

  it('reserves host plus stack bytes with startDocker, host bytes alone without it (create-admission.ac4)', async () => {
    await createWorkspace({ projectConfig: { name: 'Test', path: tempDir }, featureName: 'pan-4961', startDocker: true });
    expect(mockReserveDiskFloor).toHaveBeenLastCalledWith({ path: tempDir, bytes: 2_300, label: 'workspace:pan-4961' });

    await createWorkspace({ projectConfig: { name: 'Test', path: tempDir }, featureName: 'pan-4963' });
    expect(mockReserveDiskFloor).toHaveBeenLastCalledWith({ path: tempDir, bytes: 300, label: 'workspace:pan-4963' });
  });

  it('never reserves for a dry run', async () => {
    const result = await createWorkspace({ projectConfig: { name: 'Test', path: tempDir }, featureName: 'pan-4961', dryRun: true });

    expect(result.success).toBe(true);
    expect(mockReserveDiskFloor).not.toHaveBeenCalled();
  });
});
