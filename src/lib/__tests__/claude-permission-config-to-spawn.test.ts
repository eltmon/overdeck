import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end guard for the config→spawn path: whatever `claude.permissionMode`
 * says in ~/.overdeck/config.yaml must show up in the `claude` command Overdeck
 * builds for agents and dashboard-launched conversations.
 *
 * The 2026-08-18 report — "config says auto but the conversation launched with
 * --permission-mode default" — was this path working as designed: `auto` is
 * Overdeck's internal mode name and maps to Claude Code's `default`. `bypass` is
 * the value that yields prompt-free spawns. These tests pin both directions so
 * the mapping cannot drift without a failing test.
 */

const ORIGINAL_YOLO = process.env.PAN_YOLO;

let permissionMode: 'auto' | 'bypass' = 'bypass';

vi.mock('../config-yaml.js', async () => {
  const actual = await vi.importActual<typeof import('../config-yaml.js')>('../config-yaml.js');
  return {
    ...actual,
    loadConfigSync: (...args: Parameters<typeof actual.loadConfigSync>) => {
      const loaded = actual.loadConfigSync(...args);
      return {
        ...loaded,
        config: { ...loaded.config, claude: { permissionMode } },
      };
    },
  };
});

describe('claude.permissionMode reaches the spawned command', () => {
  beforeEach(() => {
    // PAN_YOLO outranks config; clear it so the config value is what is measured.
    delete process.env.PAN_YOLO;
  });

  afterEach(() => {
    if (ORIGINAL_YOLO === undefined) delete process.env.PAN_YOLO;
    else process.env.PAN_YOLO = ORIGINAL_YOLO;
  });

  it('bypass in config yields --permission-mode bypassPermissions on an agent/conversation spawn', async () => {
    permissionMode = 'bypass';
    const { resolvePermissionModeSync, getClaudePermissionFlagsStringSync } =
      await import('../claude-permissions.js');
    const { getAgentRuntimeBaseCommand } = await import('../agents.js');

    expect(resolvePermissionModeSync()).toBe('bypass');
    expect(getClaudePermissionFlagsStringSync()).toBe('--permission-mode bypassPermissions');

    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6');
    expect(cmd).toMatch(/--permission-mode bypassPermissions/);
  });

  it('auto in config yields --permission-mode default (auto is not a Claude Code flag value)', async () => {
    permissionMode = 'auto';
    const { resolvePermissionModeSync, getClaudePermissionFlagsStringSync } =
      await import('../claude-permissions.js');
    const { getAgentRuntimeBaseCommand } = await import('../agents.js');

    expect(resolvePermissionModeSync()).toBe('auto');
    expect(getClaudePermissionFlagsStringSync()).toBe('--permission-mode default');

    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6');
    expect(cmd).toMatch(/--permission-mode default/);
    expect(cmd).not.toMatch(/--permission-mode auto\b/);
    expect(cmd).not.toMatch(/bypassPermissions/);
  });
});
