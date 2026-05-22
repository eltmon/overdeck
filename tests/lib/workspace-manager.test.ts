import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
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
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => mockHomedir,
  };
});

describe('copyPanopticonSettingsToWorkspace', () => {
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
    mkdirSync(join(homeDir, '.panopticon'), { recursive: true });

    mockExecAsync.mockReset();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should remove hooks whose absolute path does not exist', async () => {
    const { copyPanopticonSettingsToWorkspaceSync } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: '/nonexistent/hook.py' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspaceSync(workspaceDir);

    expect(result.copied).toContain(join(workspaceDir, '.claude', 'settings.json'));
    expect(result.errors.some((e) => e.includes('Removed broken hook'))).toBe(true);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });

  it('should preserve hooks whose absolute path exists', async () => {
    const { copyPanopticonSettingsToWorkspaceSync } = await import('../../src/lib/workspace-manager.js');

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

    const result = copyPanopticonSettingsToWorkspaceSync(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe(hookPath);
  });

  it('should not validate relative hook paths', async () => {
    const { copyPanopticonSettingsToWorkspaceSync } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: './local-hook.sh' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspaceSync(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe('./local-hook.sh');
  });

  it('should not validate shell commands with pipes', async () => {
    const { copyPanopticonSettingsToWorkspaceSync } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: 'cat /dev/null | grep foo' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspaceSync(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe('cat /dev/null | grep foo');
  });

  it('should handle mixed valid and invalid hooks', async () => {
    const { copyPanopticonSettingsToWorkspaceSync } = await import('../../src/lib/workspace-manager.js');

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

    const result = copyPanopticonSettingsToWorkspaceSync(workspaceDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Removed broken hook');

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(2);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe(validHookPath);
    expect(workspaceSettings.hooks.PostToolUse[1].command).toBe('echo hello');
  });

  it('should remove empty hook categories after filtering', async () => {
    const { copyPanopticonSettingsToWorkspaceSync } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [{ command: '/nonexistent/hook.py' }],
        PreToolUse: [{ command: '/another/missing.py' }],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspaceSync(workspaceDir);

    expect(result.errors).toHaveLength(2);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });

  it('should detect broken script path inside wrapper command', async () => {
    const { copyPanopticonSettingsToWorkspaceSync } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: 'uv run /nonexistent/damage-control/script.py' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspaceSync(workspaceDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Removed broken hook');

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
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
      'FEATURE_FOLDER="feature-pan-1140"\nexport COMPOSE_PROJECT_NAME="panopticon-${FEATURE_FOLDER}"\n',
      'utf8',
    );

    const { stopWorkspaceDocker } = await import('../../src/lib/workspace-manager.js');
    await Effect.runPromise(stopWorkspaceDocker(workspaceDir, 'pan-1140'));

    const composeCall = mockExecAsync.mock.calls.find(([command]) => String(command).startsWith('docker compose'));
    expect(composeCall?.[0]).toContain('-p "panopticon-feature-pan-1140" down -v --remove-orphans');
  });

  it('rejects workspace-controlled compose project name mismatches before teardown', async () => {
    writeFileSync(
      join(workspaceDir, '.devcontainer', 'dev'),
      'FEATURE_FOLDER="feature-pan-1140"\nexport COMPOSE_PROJECT_NAME="victim-project"\n',
      'utf8',
    );

    const { stopWorkspaceDocker } = await import('../../src/lib/workspace-manager.js');
    await (await Effect.runPromise(expect(stopWorkspaceDocker(workspaceDir, 'pan-1140'))))orkspaceDir, 'pan-1140')))).rejects.toThrow(
      'declares COMPOSE_PROJECT_NAME=victim-project, expected panopticon-feature-pan-1140',
    );
    expect(mockExecAsync).not.toHaveBeenCalledWith(expect.stringContaining('docker compose'), expect.anything());
  });
});
