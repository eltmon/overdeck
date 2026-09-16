import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

const { mockGetProjectSync, mockResolveProjectCreateIntent, mockPerformProjectCreate } = vi.hoisted(() => ({
  mockGetProjectSync: vi.fn(),
  mockResolveProjectCreateIntent: vi.fn(),
  mockPerformProjectCreate: vi.fn(),
}));

vi.mock('../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/projects.js')>('../../../src/lib/projects.js');
  return { ...actual, getProjectSync: mockGetProjectSync };
});

vi.mock('../../../src/lib/projects/create.js', () => ({
  resolveProjectCreateIntent: mockResolveProjectCreateIntent,
  performProjectCreate: mockPerformProjectCreate,
}));

import { projectAddTargetCommand, projectAddCommand } from '../../../src/cli/commands/project.js';
import { getProjectByKey, listProjectTargets } from '../../../src/lib/workspaces/resolver.js';

let odb: OverdeckTestDb;
let projectRoot: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-project-target-'));
  mockGetProjectSync.mockReset();
  mockGetProjectSync.mockReturnValue({ name: 'Test Project', path: projectRoot });
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('pan project add (PAN-3836: resolve-before-create)', () => {
  let consoleLogSpy: any;
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pan-3836-project-add-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockResolveProjectCreateIntent.mockClear();
    mockPerformProjectCreate.mockClear();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('AC1.1: --dry-run validates without creating', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue({
      mode: 'existing',
      key: 'test-proj',
      name: 'Test Project',
      path: projectDir,
      findings: [],
      isGitRepository: true,
      wouldClone: false,
      wouldGitInit: false,
      willCreateMainWorkspace: false,
      cloneUrl: null,
      provider: null,
      repoSlug: null,
      defaultBranch: null,
      remoteChecked: false,
      proposedIssuePrefix: 'TP',
    });

    await projectAddCommand(projectDir, { dryRun: true });

    expect(mockResolveProjectCreateIntent).toHaveBeenCalled();
    expect(mockPerformProjectCreate).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('dry-run'));
  });

  it('AC1.2: shows findings if validation fails', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue({
      mode: 'existing',
      key: null,
      name: '',
      path: projectDir,
      findings: [
        {
          field: 'path',
          code: 'path-not-a-directory',
          message: 'Path is not a directory',
        },
      ],
      isGitRepository: false,
      wouldClone: false,
      wouldGitInit: false,
      willCreateMainWorkspace: false,
      cloneUrl: null,
      provider: null,
      repoSlug: null,
      defaultBranch: null,
      remoteChecked: false,
      proposedIssuePrefix: null,
    });

    await projectAddCommand(projectDir);

    expect(mockResolveProjectCreateIntent).toHaveBeenCalled();
    expect(mockPerformProjectCreate).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Validation issues'));
  });

  it('AC1.3: creates project when validation passes and not --dry-run', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue({
      mode: 'existing',
      key: 'test-proj',
      name: 'Test Project',
      path: projectDir,
      findings: [],
      isGitRepository: true,
      wouldClone: false,
      wouldGitInit: false,
      willCreateMainWorkspace: false,
      cloneUrl: null,
      provider: null,
      repoSlug: null,
      defaultBranch: null,
      remoteChecked: false,
      proposedIssuePrefix: 'TP',
    });

    mockPerformProjectCreate.mockResolvedValue({
      key: 'test-proj',
      name: 'Test Project',
      path: projectDir,
      mainWorkspaceId: 'ws-123',
    });

    await projectAddCommand(projectDir);

    expect(mockResolveProjectCreateIntent).toHaveBeenCalled();
    expect(mockPerformProjectCreate).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Added project'));
  });
});

describe('pan project add-target (PAN-1990)', () => {
  it('creates a project_targets row for the project', async () => {
    await projectAddTargetCommand('test-project', { path: '/repo/secondary' });

    expect(getProjectByKey('test-project')?.primaryPath).toBe(projectRoot);
    const targets = listProjectTargets('test-project');
    expect(targets).toHaveLength(1);
    expect(targets[0].path).toBe('/repo/secondary');
    expect(targets[0].isPrimary).toBe(false);
  });

  it('--primary demotes the previous primary so exactly one primary row remains', async () => {
    await projectAddTargetCommand('test-project', { path: '/repo/first', primary: true });
    await projectAddTargetCommand('test-project', { path: '/repo/second', primary: true });

    const targets = listProjectTargets('test-project');
    expect(targets.filter((t) => t.isPrimary)).toHaveLength(1);
    expect(targets.find((t) => t.isPrimary)?.path).toBe('/repo/second');
  });

  it('exits 1 for an unregistered project key', async () => {
    mockGetProjectSync.mockReturnValue(null);
    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(projectAddTargetCommand('missing-project', { path: '/repo/x' })).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
