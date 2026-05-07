import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should remove hooks whose absolute path does not exist', async () => {
    const { copyPanopticonSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: '/nonexistent/hook.py' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspace(workspaceDir);

    expect(result.copied).toContain(join(workspaceDir, '.claude', 'settings.json'));
    expect(result.errors.some((e) => e.includes('Removed broken hook'))).toBe(true);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });

  it('should preserve hooks whose absolute path exists', async () => {
    const { copyPanopticonSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

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

    const result = copyPanopticonSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe(hookPath);
  });

  it('should not validate relative hook paths', async () => {
    const { copyPanopticonSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: './local-hook.sh' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe('./local-hook.sh');
  });

  it('should not validate shell commands with pipes', async () => {
    const { copyPanopticonSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: 'cat /dev/null | grep foo' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(0);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(1);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe('cat /dev/null | grep foo');
  });

  it('should handle mixed valid and invalid hooks', async () => {
    const { copyPanopticonSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

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

    const result = copyPanopticonSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Removed broken hook');

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks?.PostToolUse).toHaveLength(2);
    expect(workspaceSettings.hooks.PostToolUse[0].command).toBe(validHookPath);
    expect(workspaceSettings.hooks.PostToolUse[1].command).toBe('echo hello');
  });

  it('should remove empty hook categories after filtering', async () => {
    const { copyPanopticonSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [{ command: '/nonexistent/hook.py' }],
        PreToolUse: [{ command: '/another/missing.py' }],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(2);

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });

  it('should detect broken script path inside wrapper command', async () => {
    const { copyPanopticonSettingsToWorkspace } = await import('../../src/lib/workspace-manager.js');

    const globalSettings = {
      hooks: {
        PostToolUse: [
          { command: 'uv run /nonexistent/damage-control/script.py' },
        ],
      },
    };
    writeFileSync(join(homeDir, '.claude', 'settings.json'), JSON.stringify(globalSettings), 'utf8');

    const result = copyPanopticonSettingsToWorkspace(workspaceDir);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Removed broken hook');

    const workspaceSettings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf8'));
    expect(workspaceSettings.hooks).toBeUndefined();
  });
});
