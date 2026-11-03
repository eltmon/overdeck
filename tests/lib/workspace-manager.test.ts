import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const { mockExecAsync, mockCheckDiskFloor } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockCheckDiskFloor: vi.fn(),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
  };
});

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

let mockHomedir = '';

/** Matches both exec shell strings and execFile argv vectors for `git worktree add`. */
const isWorktreeAddCall = (command: unknown, args?: unknown): boolean =>
  (typeof command === 'string' && command.includes('git worktree add'))
  || (command === 'git' && Array.isArray(args) && args[0] === 'worktree' && args[1] === 'add');

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => mockHomedir,
  };
});

// checkDiskFloor reads real free space via statfs (PAN-4723): mock it so tests
// don't fail on CI runners whose /tmp has less than the 10 GiB floor.
vi.mock('../../src/lib/disk-floor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/disk-floor.js')>()),
  checkDiskFloor: mockCheckDiskFloor,
}));

describe('copyOverdeckSettingsToWorkspace', () => {
  let tempDir: string;
  let homeDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-wm-test-'));
    homeDir = join(tempDir, 'home');
    workspaceDir = join(tempDir, 'workspace');;
    mockHomedir = homeDir;

    mkdirSync(homeDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    mkdirSync(join(homeDir, '.overdeck'), { recursive: true });

    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should remove hooks whose absolute path does not exist', async () => {
    const { copyOverdeckSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: '/nonexistent/hook.py' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyOverdeckSettingsToWorkspace(workspaceDir);

    expect(result.copied).toContain(join(workspaceDir, '.claude', 'settings.json'));
    expect(result.errors.some((e) => e.includes('Removed broken hook'))).toBe(true);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });

  it('should preserve hooks whose absolute path exists', async () => {
    const { copyOverdeckSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const hookPath = join(homeDir, '.claude', 'hooks', 'valid-hook.py');
    mkdirSync(join(homeDir, '.claude', 'hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/usr/bin/env python3\n', 'utf8');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: hookPath },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyOverdeckSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe(hookPath);
  });

  it('should not validate relative hook paths', async () => {
    const { copyOverdeckSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: './local-hook.sh' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyOverdeckSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe('./local-hook.sh');
  });

  it('should not validate shell commands with pipes', async () => {
    const { copyOverdeckSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: 'cat /dev/null | grep foo' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyOverdeckSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe('cat /dev/null | grep foo');
  });

  it('should handle mixed valid and invalid hooks', async () => {
    const { copyOverdeckSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const validHookPath = join(homeDir, '.claude', 'hooks', 'valid-hook.py');
    mkdirSync(join(homeDir, '.claude', 'hooks'), { recursive: true });
    writeFileSync(validHookPath, '#!/usr/bin/env python3\n', 'utf8');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: '/nonexistent/broken.py' },
          { command: validHookPath },
          { command: 'echo hello' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyOverdeckSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Removed broken hook');

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(2);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe(validHookPath);
    expect(workspaceSettings.hooks.PostToolUse[1].command).toBe('echo hello');
  });

  it('should remove empty hook categories after filtering', async () => {
    const { copyOverdeckSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [{ command: '/nonexistent/hook.py' }],
        PreToolUse: [{ command: '/another/missing.py' }],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyOverdeckSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(2);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });

  it('should detect broken script path inside wrapper command', async () => {
    const { copyOverdeckSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: 'uv run /nonexistent/damage-control/script.py' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyOverdeckSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Removed broken hook');

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });
});

describe('createWorkspace', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-wm-create-test-'));
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockCheckDiskFloor.mockReset();
    mockCheckDiskFloor.mockResolvedValue(null);
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stages metadata-only workspace directories before git worktree add and restores records', async () => {
    const workspacePath = join(tempDir, 'workspaces', 'feature-pan-2050');
    const recordPath = join(workspacePath, '.pan', 'records', 'pan-2050.json');
    mkdirSync(join(workspacePath, '.pan', 'records'), { recursive: true });
    writeFileSync(recordPath, '{"issueId":"PAN-2050"}\n', 'utf8');

    mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
      if (isWorktreeAddCall(command, args)) {
        expect(existsSync(workspacePath)).toBe(false);
        mkdirSync(workspacePath, { recursive: true });
      }
      return { stdout: '', stderr: '' };
    });

    // PAN-1990 FR-6/AC-4: create.ts now guarantees the workspace row exists
    // before the worktree — it must resolve this project's projects.yaml
    // entry to seed the row rather than skipping silently when unseeded.
    const { registerProject, unregisterProject } = await import('../../src/lib/projects.js');
    registerProject('workspace-manager-test-project', { name: 'Test', path: tempDir });

    try {
      const { createWorkspace } = await import('../../src/lib/workspace-manager.js');
      const result = await createWorkspace({
        projectConfig: {
          name: 'Test',
          path: tempDir,
          package_manager: 'npm',
        },
        featureName: 'pan-2050',
      });

      expect(result.success).toBe(true);
      expect(result.steps).toContain('Staged pre-worktree .pan metadata');
      // execFile argv form (CWE-78 fix, PR #3872 finding 8): the branch is
      // cut from origin/main after a fetch, never interpolated into a shell.
      expect(mockExecAsync).toHaveBeenCalledWith(
        'git',
        ['worktree', 'add', '-b', 'feature/pan-2050', workspacePath, 'origin/main'],
        expect.objectContaining({ cwd: tempDir }),
      );
      expect(readFileSync(recordPath, 'utf8')).toBe('{"issueId":"PAN-2050"}\n');
    } finally {
      unregisterProject('workspace-manager-test-project');
    }
  });

  it('skips the root install when a polyrepo workspace root has no package.json', async () => {
    const workspacePath = join(tempDir, 'workspaces', 'feature-min-1135');

    mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
      if (isWorktreeAddCall(command, args)) {
        const targetPath = Array.isArray(args) ? args[args.length - 2] : workspacePath;
        mkdirSync(targetPath, { recursive: true });
      }
      return { stdout: '', stderr: '' };
    });

    const workspace = {
      type: 'polyrepo' as const,
      repos: [
        { name: 'fe', path: 'frontend' },
        { name: 'api', path: 'api' },
      ],
    };

    const { registerProject, unregisterProject } = await import('../../src/lib/projects.js');
    registerProject('wm-test-polyrepo-skip', { name: 'Test', path: tempDir, package_manager: 'npm', workspace });

    try {
      const { createWorkspace } = await import('../../src/lib/workspace-manager.js');
      const result = await createWorkspace({
        projectConfig: { name: 'Test', path: tempDir, package_manager: 'npm', workspace },
        featureName: 'min-1135',
      });

      expect(result.success).toBe(true);
      expect(result.steps).toContain('No root package.json; skipped root install');
      for (const call of mockExecAsync.mock.calls) {
        const cmd = call[0];
        if (typeof cmd === 'string') {
          expect(cmd.trim().endsWith(' install')).toBe(false);
        }
      }
    } finally {
      unregisterProject('wm-test-polyrepo-skip');
    }
  });

  it('runs the root install when a monorepo workspace root has a package.json', async () => {
    const workspacePath = join(tempDir, 'workspaces', 'feature-pan-9001');

    mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
      if (isWorktreeAddCall(command, args)) {
        const targetPath = Array.isArray(args) ? args[args.length - 2] : workspacePath;
        mkdirSync(targetPath, { recursive: true });
        writeFileSync(join(targetPath, 'package.json'), JSON.stringify({ name: 'x', private: true }), 'utf8');
      }
      return { stdout: '', stderr: '' };
    });

    const { registerProject, unregisterProject } = await import('../../src/lib/projects.js');
    registerProject('wm-test-monorepo-install', { name: 'Test', path: tempDir, package_manager: 'npm' });

    try {
      const { createWorkspace } = await import('../../src/lib/workspace-manager.js');
      const result = await createWorkspace({
        projectConfig: { name: 'Test', path: tempDir, package_manager: 'npm' },
        featureName: 'pan-9001',
      });

      expect(result.steps).toContain('Installed dependencies (npm)');
      expect(mockExecAsync).toHaveBeenCalledWith('npm install', expect.objectContaining({ cwd: workspacePath }));
    } finally {
      unregisterProject('wm-test-monorepo-install');
    }
  });

  it('fails creation when the root install fails', async () => {
    const workspacePath = join(tempDir, 'workspaces', 'feature-pan-9002');

    mockExecAsync.mockImplementation(async (command: string, args?: string[]) => {
      if (isWorktreeAddCall(command, args)) {
        const targetPath = Array.isArray(args) ? args[args.length - 2] : workspacePath;
        mkdirSync(targetPath, { recursive: true });
        writeFileSync(join(targetPath, 'package.json'), JSON.stringify({ name: 'x', private: true }), 'utf8');
        return { stdout: '', stderr: '' };
      }
      if (command === 'npm install') {
        throw new Error('npm boom');
      }
      return { stdout: '', stderr: '' };
    });

    const { registerProject, unregisterProject } = await import('../../src/lib/projects.js');
    registerProject('wm-test-monorepo-install-fail', { name: 'Test', path: tempDir, package_manager: 'npm' });

    try {
      const { createWorkspace } = await import('../../src/lib/workspace-manager.js');
      const result = await createWorkspace({
        projectConfig: { name: 'Test', path: tempDir, package_manager: 'npm' },
        featureName: 'pan-9002',
      });

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.startsWith('Dependency install failed (npm): npm boom'))).toBe(true);
    } finally {
      unregisterProject('wm-test-monorepo-install-fail');
    }
  });
});

describe('stopWorkspaceDocker', () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-wm-docker-test-'));
    workspaceDir = join(tempDir, 'workspace');
    mkdirSync(join(workspaceDir, '.devcontainer'), { recursive: true });
    writeFileSync(join(workspaceDir, '.devcontainer', 'docker-compose.devcontainer.yml'), 'services: {}\n', 'utf8');
    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses the canonical rendered compose project name for teardown', async () => {
    writeFileSync(
      join(workspaceDir, '.devcontainer', 'dev'),
      'FEATURE_FOLDER="feature-pan-1140"\nexport COMPOSE_PROJECT_NAME="overdeck-${FEATURE_FOLDER}"\n',
      'utf8',
    );

    const { stopWorkspaceDocker } = await import('../../src/lib/workspace-manager.js');
    await stopWorkspaceDocker(workspaceDir, 'pan-1140');

    // PAN-3049 security fix: the compose project name is now passed via
    // execFile's argv array (cmd='docker', args=[...]), never interpolated
    // into a shell string, so no declared value can reach a shell.
    const composeCall = mockExecAsync.mock.calls.find(
      ([cmd, args]) => cmd === 'docker' && Array.isArray(args) && args.includes('compose'),
    );
    expect(composeCall).toBeDefined();
    const [, args] = composeCall!;
    expect(args).toEqual(expect.arrayContaining(['-p', 'overdeck-feature-pan-1140', 'down', '-v', '--remove-orphans']));
  });

  it('rejects workspace-controlled compose project name mismatches before teardown', async () => {
    writeFileSync(
      join(workspaceDir, '.devcontainer', 'dev'),
      'FEATURE_FOLDER="feature-pan-1140"\nexport COMPOSE_PROJECT_NAME="victim-project"\n',
      'utf8',
    );

    const { stopWorkspaceDocker } = await import('../../src/lib/workspace-manager.js');
    // PAN-3049: the message now comes from the canonical resolver
    // (composeProjectNameForWorkspace), which reports "a name ending in
    // <feature folder>" rather than one exact expected literal.
    await expect(stopWorkspaceDocker(workspaceDir, 'pan-1140')).rejects.toThrow(
      'declares COMPOSE_PROJECT_NAME=victim-project, expected a name ending in feature-pan-1140',
    );
    // The resolver throws before any Docker command is issued at all.
    expect(mockExecAsync).not.toHaveBeenCalled();
  });
});
