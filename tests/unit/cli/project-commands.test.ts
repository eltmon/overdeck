import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

const {
  mockGetProjectSync,
  mockResolveProjectCreateIntent,
  mockPerformProjectCreate,
  mockFinishProjectSetup,
} = vi.hoisted(() => ({
  mockGetProjectSync: vi.fn(),
  mockResolveProjectCreateIntent: vi.fn(),
  mockPerformProjectCreate: vi.fn(),
  mockFinishProjectSetup: vi.fn(),
}));

vi.mock('../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/projects.js')>('../../../src/lib/projects.js');
  return { ...actual, getProjectSync: mockGetProjectSync };
});

// Only the resolve half is mocked; toPublicProjectIntent and the error class are
// the real ones, so a test asserting redaction is asserting production behavior.
vi.mock('../../../src/lib/projects/create.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/projects/create.js')>(
    '../../../src/lib/projects/create.js',
  );
  return { ...actual, resolveProjectCreateIntent: mockResolveProjectCreateIntent };
});

vi.mock('../../../src/lib/projects/create-perform.js', () => ({
  performProjectCreate: mockPerformProjectCreate,
  finishProjectSetup: mockFinishProjectSetup,
}));

import {
  projectAddTargetCommand,
  projectAddCommand,
  projectCloneCommand,
  projectFinishSetupCommand,
} from '../../../src/cli/commands/project.js';
import { ProjectCreateFailureError } from '../../../src/lib/projects/create.js';

/**
 * Run a command that is expected to terminate the process, and assert the code.
 *
 * The real `exitCli` is left in place — mocking the module wholesale disarms it
 * for every other test in the file — so `process.exit` is spied to throw instead.
 */
async function expectExit(code: number, run: () => Promise<unknown>): Promise<void> {
  const spy = vi
    .spyOn(process, 'exit')
    .mockImplementation(((c?: number) => {
      throw new Error(`process.exit(${c})`);
    }) as never);
  try {
    await expect(run()).rejects.toThrow(`process.exit(${code})`);
  } finally {
    spy.mockRestore();
  }
}
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
  let consoleErrorSpy: any;
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pan-3836-project-add-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFinishProjectSetup.mockReset();
    mockResolveProjectCreateIntent.mockClear();
    mockPerformProjectCreate.mockClear();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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
      parentDir: projectDir,
      homeDir: '/home/user',
      gitRoot: null,
      registeredKeyAtPath: null,
    });

    await projectAddCommand(projectDir, { dryRun: true });

    expect(mockResolveProjectCreateIntent).toHaveBeenCalled();
    expect(mockPerformProjectCreate).not.toHaveBeenCalled();
    // The flag exists to be piped into jq, so the output must parse as JSON.
    const printed = JSON.parse(consoleLogSpy.mock.calls.at(-1)![0] as string);
    expect(printed).toMatchObject({ mode: 'existing', key: 'test-proj', wouldClone: false });
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
      parentDir: projectDir,
      homeDir: '/home/user',
      gitRoot: null,
      registeredKeyAtPath: null,
    });

    // Nothing was created, so the command failed; exiting 0 let scripts treat a
    // rejected path as success.
    await expectExit(1, () => projectAddCommand(projectDir));

    expect(mockResolveProjectCreateIntent).toHaveBeenCalled();
    expect(mockPerformProjectCreate).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation issues'));
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
      parentDir: projectDir,
      homeDir: '/home/user',
      gitRoot: null,
      registeredKeyAtPath: null,
    });

    mockPerformProjectCreate.mockResolvedValue({
      key: 'test-proj',
      name: 'Test Project',
      path: projectDir,
      mainWorkspaceId: 'ws-123',
      seededContextLayer: true,
      hooksInstalled: 2,
    });

    await projectAddCommand(projectDir);

    expect(mockResolveProjectCreateIntent).toHaveBeenCalled();
    expect(mockPerformProjectCreate).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Added project'));
  });
});

describe('pan project clone (PAN-3836: clone support)', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFinishProjectSetup.mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => 0);
    mockResolveProjectCreateIntent.mockClear();
    mockPerformProjectCreate.mockClear();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('WI-3.1: --dry-run validates URL without cloning', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue({
      mode: 'clone',
      key: 'orca',
      name: 'Orca',
      path: null,
      findings: [],
      isGitRepository: true,
      wouldClone: true,
      wouldGitInit: false,
      willCreateMainWorkspace: false,
      cloneUrl: 'https://github.com/stablyai/orca.git',
      provider: 'github',
      repoSlug: 'stablyai/orca',
      defaultBranch: 'main',
      remoteChecked: true,
      proposedIssuePrefix: 'ORCA',
      parentDir: '/home/user/Projects',
      homeDir: '/home/user',
      gitRoot: null,
      registeredKeyAtPath: null,
    });

    await projectCloneCommand('stablyai/orca', { dryRun: true });

    expect(mockResolveProjectCreateIntent).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'clone',
      url: 'stablyai/orca',
      refreshRemote: true,
    }));
    expect(mockPerformProjectCreate).not.toHaveBeenCalled();
    const printed = JSON.parse(consoleLogSpy.mock.calls.at(-1)![0] as string);
    expect(printed).toMatchObject({ wouldClone: true, key: 'orca', repoSlug: 'stablyai/orca' });
  });

  it('WI-3.2: shows findings if validation fails', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue({
      mode: 'clone',
      key: null,
      name: '',
      path: null,
      findings: [
        {
          field: 'url',
          code: 'url-invalid',
          message: 'Invalid URL format',
        },
      ],
      isGitRepository: true,
      wouldClone: false,
      wouldGitInit: false,
      willCreateMainWorkspace: false,
      cloneUrl: null,
      provider: null,
      repoSlug: null,
      defaultBranch: null,
      remoteChecked: false,
      proposedIssuePrefix: null,
      parentDir: '/home/user/Projects',
      homeDir: '/home/user',
      gitRoot: null,
      registeredKeyAtPath: null,
    });

    await expectExit(1, () => projectCloneCommand('not-a-url'));

    expect(mockPerformProjectCreate).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Validation issues'));
  });

  it('WI-3.3: clones and registers with progress updates', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue({
      mode: 'clone',
      key: 'orca',
      name: 'Orca',
      path: '/home/test/Projects/orca',
      findings: [],
      isGitRepository: true,
      wouldClone: true,
      wouldGitInit: false,
      willCreateMainWorkspace: false,
      cloneUrl: 'https://github.com/stablyai/orca.git',
      provider: 'github',
      repoSlug: 'stablyai/orca',
      defaultBranch: 'main',
      remoteChecked: true,
      proposedIssuePrefix: 'ORCA',
      parentDir: '/home/user/Projects',
      homeDir: '/home/user',
      gitRoot: null,
      registeredKeyAtPath: null,
    });

    mockPerformProjectCreate.mockResolvedValue({
      key: 'orca',
      name: 'Orca',
      path: '/home/test/Projects/orca',
      mainWorkspaceId: 'ws-123',
    });

    await projectCloneCommand('stablyai/orca');

    expect(mockResolveProjectCreateIntent).toHaveBeenCalled();
    expect(mockPerformProjectCreate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Cloned and registered'));
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

describe('pan project finish-setup (PAN-3836 WI-3)', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFinishProjectSetup.mockReset();
    mockPerformProjectCreate.mockReset();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('repairs a registered project without cloning again', async () => {
    mockGetProjectSync.mockReturnValue({ name: 'Widget', path: '/home/user/Projects/widget' });
    mockFinishProjectSetup.mockResolvedValue({
      key: 'widget',
      name: 'Widget',
      path: '/home/user/Projects/widget',
      mainWorkspaceId: 'ws-1',
      seededContextLayer: false,
      hooksInstalled: 1,
    });

    await projectFinishSetupCommand('widget');

    expect(mockFinishProjectSetup).toHaveBeenCalledWith({
      key: 'widget',
      expectedPath: '/home/user/Projects/widget',
    });
    // Repair must never reach the clone path.
    expect(mockPerformProjectCreate).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Setup complete'));
  });

  it('exits 1 for a key that is not registered', async () => {
    mockGetProjectSync.mockReturnValue(undefined);

    await expectExit(1, () => projectFinishSetupCommand('nope'));

    expect(mockFinishProjectSetup).not.toHaveBeenCalled();
  });

  it('passes an explicit --path through as a consistency check', async () => {
    mockGetProjectSync.mockReturnValue({ name: 'Widget', path: '/home/user/Projects/widget' });
    mockFinishProjectSetup.mockRejectedValue(
      new ProjectCreateFailureError({
        code: 'destination-conflict',
        message: "Project 'widget' is registered elsewhere.",
        retrySafe: false,
      }),
    );

    await expectExit(1, () => projectFinishSetupCommand('widget', { path: '/somewhere/else' }));

    // --path relocates nothing; a mismatch refuses rather than repairing the
    // wrong project.
    expect(mockFinishProjectSetup).toHaveBeenCalledWith(
      expect.objectContaining({ expectedPath: '/somewhere/else' }),
    );
  });
});

describe('pan project clone — transport and failure reporting (PAN-3836 WI-3)', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockResolveProjectCreateIntent.mockReset();
    mockPerformProjectCreate.mockReset();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function sshIntent() {
    return {
      mode: 'clone' as const,
      key: 'private',
      name: 'private',
      path: '/home/user/Projects/private',
      findings: [],
      isGitRepository: true,
      wouldClone: true,
      wouldGitInit: false,
      willCreateMainWorkspace: true,
      cloneUrl: 'git@github.com:acme/private.git',
      provider: 'github' as const,
      repoSlug: 'acme/private',
      defaultBranch: 'main',
      remoteChecked: true,
      proposedIssuePrefix: 'PRIVATE',
      parentDir: '/home/user/Projects',
      homeDir: '/home/user',
      gitRoot: null,
      registeredKeyAtPath: null,
    };
  }

  it('hands the SSH transport URL to the core unchanged', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue(sshIntent());
    mockPerformProjectCreate.mockResolvedValue({
      key: 'private',
      name: 'private',
      path: '/home/user/Projects/private',
      mainWorkspaceId: 'ws-1',
      seededContextLayer: true,
      hooksInstalled: 1,
    });

    await projectCloneCommand('git@github.com:acme/private.git');

    const passed = mockPerformProjectCreate.mock.calls[0][0];
    expect(passed.cloneUrl).toBe('git@github.com:acme/private.git');
  });

  it('redacts credentials from the dry-run document', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue({
      ...sshIntent(),
      cloneUrl: 'https://octo:ghp_SECRET@github.com/acme/private.git',
    });

    await projectCloneCommand('https://octo:ghp_SECRET@github.com/acme/private.git', {
      dryRun: true,
    });

    const printed = consoleLogSpy.mock.calls.at(-1)![0] as string;
    expect(printed).not.toContain('ghp_SECRET');
    expect(JSON.parse(printed).cloneUrl).toBe('https://github.com/acme/private.git');
  });

  it('names the repair command when setup did not finish', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue(sshIntent());
    mockPerformProjectCreate.mockRejectedValue(
      new ProjectCreateFailureError({
        code: 'setup-incomplete',
        message: 'The repository is available at /home/user/Projects/private, but project setup did not finish.',
        retrySafe: false,
        recovery: { action: 'finish-setup', key: 'private', path: '/home/user/Projects/private' },
      }),
    );

    await expectExit(1, () => projectCloneCommand('git@github.com:acme/private.git'));

    // Telling the operator to run clone again would clone a second copy.
    const printed = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(printed).toContain('pan project finish-setup private');
  });

  it('exits 130 when the clone was cancelled', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue(sshIntent());
    mockPerformProjectCreate.mockRejectedValue(
      new ProjectCreateFailureError({
        code: 'cancelled',
        message: 'The clone was cancelled.',
        retrySafe: true,
      }),
    );

    // 130 is the conventional "terminated by SIGINT" status.
    await expectExit(130, () => projectCloneCommand('git@github.com:acme/private.git'));
  });

  it('wires a real abort signal into the clone', async () => {
    mockResolveProjectCreateIntent.mockResolvedValue(sshIntent());
    mockPerformProjectCreate.mockResolvedValue({
      key: 'private',
      name: 'private',
      path: '/home/user/Projects/private',
      mainWorkspaceId: 'ws-1',
      seededContextLayer: false,
      hooksInstalled: 0,
    });

    await projectCloneCommand('git@github.com:acme/private.git');

    const hooks = mockPerformProjectCreate.mock.calls[0][1];
    expect(hooks.signal).toBeInstanceOf(AbortSignal);
    // Ctrl-C must not leave a handler behind for the next command in-process.
    expect(process.listeners('SIGINT').length).toBeLessThanOrEqual(1);
  });
});

