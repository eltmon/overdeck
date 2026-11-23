import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

const {
  mockExecAsync,
  mockCheckDiskFloor,
  mockReserveDiskFloor,
  mockEstimateWorkspaceDiskCost,
  mockCreateHumeConfig,
  mockAddTunnelIngress,
} = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockCheckDiskFloor: vi.fn(),
  mockReserveDiskFloor: vi.fn(),
  mockEstimateWorkspaceDiskCost: vi.fn(),
  mockCreateHumeConfig: vi.fn(),
  mockAddTunnelIngress: vi.fn(),
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

// PAN-5489: the Hume and tunnel steps call external APIs; stand in for them.
vi.mock('../../../../src/lib/hume.js', () => ({
  createHumeConfig: mockCreateHumeConfig,
  deleteHumeConfig: vi.fn(),
}));

vi.mock('../../../../src/lib/tunnel.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tunnel.js')>()),
  addTunnelIngress: mockAddTunnelIngress,
}));

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
  mockCheckDiskFloor.mockReset();
  mockCheckDiskFloor.mockResolvedValue(null);
  mockReserveDiskFloor.mockReset();
  mockReserveDiskFloor.mockResolvedValue({ ok: true, reservation: { release: vi.fn(async () => {}) } });
  mockEstimateWorkspaceDiskCost.mockReset();
  mockEstimateWorkspaceDiskCost.mockResolvedValue({ hostBytes: 1, stackBytes: 1, hostSource: 'measured', stackSource: 'measured' });
  mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
    if (isWorktreeAddCall(command, args)) {
      // Real git is not run here; stand in for the worktree it would create.
      // A real monorepo checkout has a root package.json (PAN-4929: createWorkspace
      // now skips the install entirely when it's missing), so the stand-in needs one too.
      mkdirSync(workspacePath, { recursive: true });
      writeFileSync(join(workspacePath, '.git'), 'gitdir: elsewhere\n');
      writeFileSync(join(workspacePath, 'package.json'), JSON.stringify({ name: 'test', private: true }), 'utf8');
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

describe('createWorkspace: a failed Hume step is re-run on the next create (PAN-5489)', () => {
  let secretsDir: string;
  const humeBlock = {
    template_config_id: 't',
    name_pattern: 'kaia-{{FEATURE_FOLDER}}',
    byollm_url_pattern: 'https://x/{{FEATURE_FOLDER}}',
  };
  const keyNotFound = '[hume] API key not found: HUME_API_KEY is not set in the process environment';

  beforeEach(() => {
    installShouldFail = false;
    // A sibling of the project directory: a secrets file inside the project is ignored.
    secretsDir = mkdtempSync(join(tmpdir(), 'pan-5489-secrets-'));
    mockCreateHumeConfig.mockReset();
    mockCreateHumeConfig
      .mockResolvedValueOnce({ success: false, steps: [keyNotFound] })
      .mockResolvedValue({ success: true, steps: ['[hume] Created config'], configId: 'cfg-1', configName: 'kaia-feature-pan-4171' });
    mockAddTunnelIngress.mockReset();
  });

  afterEach(() => {
    rmSync(secretsDir, { recursive: true, force: true });
  });

  const humeProject = () => ({
    ...projectConfig(),
    workspace: { hume: humeBlock, env: { secrets_file: join(secretsDir, 'secrets.env') } },
  });

  it('keeps the setup marker and names the failing step when the Hume step fails', async () => {
    const result = await createWorkspace({ projectConfig: humeProject(), featureName: 'pan-4171' });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain(`Hume EVI config setup failed: ${keyNotFound}`);
    expect(isWorkspaceSetupIncomplete(workspacePath)).toBe(true);
    expect(workspaceNeedsSetup(workspacePath)).toBe(true);
  });

  it('passes the project and its secrets_file to the Hume step', async () => {
    await createWorkspace({ projectConfig: humeProject(), featureName: 'pan-4171' });

    const options = mockCreateHumeConfig.mock.calls[0]?.[2];
    expect(options).toMatchObject({
      project: { key: 'Test', config: { workspace: { env: { secrets_file: join(secretsDir, 'secrets.env') } } } },
    });
  });

  it('a retry re-runs the Hume step, writes .hume-config and clears the marker', async () => {
    await createWorkspace({ projectConfig: humeProject(), featureName: 'pan-4171' });
    const retry = await createWorkspace({ projectConfig: humeProject(), featureName: 'pan-4171' });

    expect(retry.errors).toEqual([]);
    expect(retry.success).toBe(true);
    expect(mockCreateHumeConfig).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(workspacePath, '.hume-config'), 'utf8')).toContain('HUME_CONFIG_ID=cfg-1');
    expect(isWorkspaceSetupIncomplete(workspacePath)).toBe(false);
  });

  it('a tunnel-only failure names the failing step and still clears the marker', async () => {
    mockAddTunnelIngress.mockResolvedValue({
      success: false,
      steps: ['[tunnel] Read Cloudflare credentials', '[tunnel] Failed to get tunnel config: x'],
    });
    const tunnelProject = {
      ...projectConfig(),
      workspace: {
        tunnel: {
          provider: 'cloudflare' as const,
          tunnel_id: 'tid',
          account_id: 'aid',
          zone_id: 'zid',
          credentials_file: join(secretsDir, 'cert.pem'),
          service_target: 'https://localhost',
          hostnames: [],
        },
      },
    };

    const result = await createWorkspace({ projectConfig: tunnelProject, featureName: 'pan-4171' });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Tunnel setup failed: [tunnel] Failed to get tunnel config: x');
    expect(mockCreateHumeConfig).not.toHaveBeenCalled();
    expect(isWorkspaceSetupIncomplete(workspacePath)).toBe(false);
  });
});
