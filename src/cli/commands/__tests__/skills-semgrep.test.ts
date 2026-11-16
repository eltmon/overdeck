/**
 * PAN-4591 WI-5: `pan skills launch-settings` wires the real
 * resolveSemgrepLaunchSettings/mergeClaudeHookMaps into the Claude settings
 * JSON. Everything except in-session.js and config-yaml.js is mocked the
 * same way src/cli/commands/__tests__/skills.test.ts does it.
 */
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveLaunchDisabledSkills: vi.fn(),
  applyDeftForLaunch: vi.fn(),
  launchMountsDeft: vi.fn(),
  applyClaudePacks: vi.fn(),
  writeCodexSkillOverrides: vi.fn(),
  applyCodexPacks: vi.fn(),
  resolveSageoxLaunch: vi.fn(),
  loadConfigNoMigration: vi.fn(),
}));

vi.mock('../../../lib/skill-overrides/launch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/skill-overrides/launch.js')>()),
  resolveLaunchDisabledSkills: mocks.resolveLaunchDisabledSkills,
  writeCodexSkillOverrides: mocks.writeCodexSkillOverrides,
  applyClaudePacks: mocks.applyClaudePacks,
  applyCodexPacks: mocks.applyCodexPacks,
  applyDeftForLaunch: mocks.applyDeftForLaunch,
  launchMountsDeft: mocks.launchMountsDeft,
}));

vi.mock('../../../lib/sageox/launch.js', () => ({ SAGEOX_PACK_ID: 'sageox', resolveSageoxLaunch: mocks.resolveSageoxLaunch }));

vi.mock('../../../lib/config-yaml.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/config-yaml.js')>()),
  loadConfigNoMigration: mocks.loadConfigNoMigration,
}));

import { registerSkillsCommands } from '../skills.js';

let stdout: string[];
let errors: string[];
const originalHome = process.env.OVERDECK_HOME;

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerSkillsCommands(program);
  await program.parseAsync(['node', 'pan', 'skills', ...args]);
}

beforeEach(() => {
  stdout = [];
  errors = [];
  process.env.OVERDECK_HOME = '/h';
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
  mocks.resolveLaunchDisabledSkills.mockResolvedValue([]);
  mocks.applyDeftForLaunch.mockResolvedValue({ hideSkills: [], deny: [], provenance: '', warnings: [] });
  mocks.launchMountsDeft.mockResolvedValue(false);
  mocks.resolveSageoxLaunch.mockResolvedValue({ active: false, warnings: [] });
  mocks.loadConfigNoMigration.mockResolvedValue({ config: { security: { semgrep: { enabled: true, mcp: false, edit_hook: true } } } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
});

describe('pan skills launch-settings — semgrep edit hook (PAN-4591 WI-5 ac1)', () => {
  it('writes hooks.PostToolUse with the Edit|Write|MultiEdit matcher and a command naming the hook', async () => {
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w');
    const settings = JSON.parse(stdout.join('')) as { hooks: { PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> } };
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0]!.matcher).toBe('Edit|Write|MultiEdit');
    expect(settings.hooks.PostToolUse[0]!.hooks[0]!.command).toContain('semgrep-edit-hook');
  });

  it('adds no hooks key when edit_hook is off', async () => {
    mocks.loadConfigNoMigration.mockResolvedValue({ config: { security: { semgrep: { enabled: true, mcp: false, edit_hook: false } } } });
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w');
    const printed = stdout.join('');
    expect(printed).toBe('');
  });
});

describe('pan skills launch-settings — semgrep + SageOx hook merge (PAN-4591 WI-5 ac2)', () => {
  it('keeps SageOx first and appends semgrep as the second PostToolUse entry', async () => {
    mocks.resolveSageoxLaunch.mockResolvedValue({
      active: true,
      settings: { env: { OX_HOST_MANAGED: '1' }, hooks: { PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'ox agent hook PostToolUse' }] }] } },
      warnings: [],
    });
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w');
    const settings = JSON.parse(stdout.join('')) as { hooks: { PostToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(settings.hooks.PostToolUse[0]!.hooks[0]!.command).toBe('ox agent hook PostToolUse');
    expect(settings.hooks.PostToolUse[1]!.hooks[0]!.command).toContain('semgrep-edit-hook');
  });
});
