/**
 * PAN-3942 WI-4: `pan skills` list / set / launch-settings through Commander.
 * The store and launch library are mocked; their own tests cover persistence.
 */
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class SkillOverrideError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    SkillOverrideError,
    listSkillStates: vi.fn(),
    setSkillOverride: vi.fn(),
    resolveLaunchDisabledSkills: vi.fn(),
    writeCodexSkillOverrides: vi.fn(),
    applyClaudePacks: vi.fn(),
    applyCodexPacks: vi.fn(),
    writeCodexPackBlock: vi.fn(),
  };
});

vi.mock('../../../lib/skill-overrides/store.js', () => ({
  SkillOverrideError: mocks.SkillOverrideError,
  listSkillStates: mocks.listSkillStates,
  setSkillOverride: mocks.setSkillOverride,
}));

vi.mock('../../../lib/skill-overrides/launch.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/skill-overrides/launch.js')>()),
  resolveLaunchDisabledSkills: mocks.resolveLaunchDisabledSkills,
  writeCodexSkillOverrides: mocks.writeCodexSkillOverrides,
  applyClaudePacks: mocks.applyClaudePacks,
  applyCodexPacks: mocks.applyCodexPacks,
}));

vi.mock('../../../lib/skill-packs/mount.js', () => ({ writeCodexPackBlock: mocks.writeCodexPackBlock }));

import { registerSkillsCommands } from '../skills.js';

const grilling = {
  name: 'grilling', description: 'Grill', core: false, projectSkill: false,
  global: false, project: null, issue: null, enabled: false, source: 'global',
};

let logs: string[];
let errors: string[];
let stdout: string[];

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerSkillsCommands(program);
  await program.parseAsync(['node', 'pan', 'skills', ...args]);
}

beforeEach(() => {
  logs = [];
  errors = [];
  stdout = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
  mocks.listSkillStates.mockResolvedValue({ project: null, issue: null, skills: [grilling] });
  mocks.setSkillOverride.mockResolvedValue({});
  mocks.applyClaudePacks.mockResolvedValue([]);
  mocks.applyCodexPacks.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('pan skills list', () => {
  it('bare `pan skills --json` routes to list', async () => {
    await run('--json');
    expect(mocks.listSkillStates).toHaveBeenCalledWith({ projectKey: undefined, issueId: undefined });
    expect(JSON.parse(logs.join('\n'))).toEqual([grilling]);
  });

  it('passes --project and --issue and prints a table', async () => {
    await run('list', '--project', 'tst', '--issue', 'TST-1');
    expect(mocks.listSkillStates).toHaveBeenCalledWith({ projectKey: 'tst', issueId: 'TST-1' });
    expect(logs.join('\n')).toMatch(/grilling\s+off\s+global/);
  });

  it('prints an override error and exits 1', async () => {
    mocks.listSkillStates.mockRejectedValue(new mocks.SkillOverrideError('unknown-project', 'unknown project: nope'));
    await expect(run('list', '--project', 'nope')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('unknown project: nope');
  });
});

describe('pan skills set', () => {
  it('sets a global override off', async () => {
    await run('set', 'grilling', 'off');
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'global', skill: 'grilling', enabled: false });
    expect(logs).toContain('grilling: off at global');
  });

  it('maps inherit to enabled null at issue level and reports the commit', async () => {
    mocks.setSkillOverride.mockResolvedValue({ committed: true, sha: 'abc1234def', pushed: false, reason: 'no upstream' });
    await run('set', 'grilling', 'inherit', '--issue', 'tst-1');
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'issue', skill: 'grilling', enabled: null, issueId: 'TST-1' });
    expect(logs).toContain('grilling: inherit at issue TST-1 (committed abc1234, push pending: no upstream)');
  });

  it('sets a project override on', async () => {
    await run('set', 'grilling', 'on', '--project', 'tst');
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'project', skill: 'grilling', enabled: true, projectKey: 'tst' });
  });

  it('rejects an invalid state with exit 1', async () => {
    await expect(run('set', 'grilling', 'maybe')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('state must be on, off, or inherit');
    expect(mocks.setSkillOverride).not.toHaveBeenCalled();
  });

  it('rejects --project with --issue', async () => {
    await expect(run('set', 'grilling', 'off', '--project', 'tst', '--issue', 'TST-1')).rejects.toThrow('exit 1');
  });

  it('reports a core-skill rejection with exit 1', async () => {
    mocks.setSkillOverride.mockRejectedValue(new mocks.SkillOverrideError('core-skill', 'core skill cannot be overridden: pan-done'));
    await expect(run('set', 'pan-done', 'off')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('core skill');
  });
});

describe('pan skills launch-settings', () => {
  it('prints the Claude Code settings JSON', async () => {
    mocks.resolveLaunchDisabledSkills.mockResolvedValue(['grilling']);
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w', '--issue', 'PAN-1');
    expect(mocks.resolveLaunchDisabledSkills).toHaveBeenCalledWith({ cwd: '/w', issueId: 'PAN-1' });
    expect(stdout.join('')).toBe('{"skillOverrides":{"grilling":"off"}}\n');
  });

  it('prints nothing when no skill is disabled', async () => {
    mocks.resolveLaunchDisabledSkills.mockResolvedValue([]);
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w');
    expect(stdout.join('')).toBe('');
  });

  it('writes the Codex config for --harness codex', async () => {
    mocks.resolveLaunchDisabledSkills.mockResolvedValue(['grilling']);
    await run('launch-settings', '--harness', 'codex', '--cwd', '/w', '--codex-home', '/ch');
    expect(mocks.writeCodexSkillOverrides).toHaveBeenCalledWith('/ch', ['grilling']);
  });

  it('exits non-zero for codex without --codex-home', async () => {
    await expect(run('launch-settings', '--harness', 'codex', '--cwd', '/w')).rejects.toThrow('exit 1');
  });

  it('exits 2 for an unsupported harness', async () => {
    await expect(run('launch-settings', '--harness', 'ohmypi', '--cwd', '/w')).rejects.toThrow('exit 2');
  });

  it('applies Claude packs to --plugin-link and keeps stdout to the settings JSON', async () => {
    mocks.resolveLaunchDisabledSkills.mockResolvedValue(['grilling']);
    mocks.applyClaudePacks.mockResolvedValue(['[launcher] WARNING: skill pack x not cached; run pan skills pack sync x']);
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w', '--issue', 'PAN-1', '--plugin-link', '/tmp/none/skill-packs');
    expect(mocks.applyClaudePacks).toHaveBeenCalledWith({ cwd: '/w', issueId: 'PAN-1' }, '/tmp/none/skill-packs');
    expect(stdout.join('')).toBe('{"skillOverrides":{"grilling":"off"}}\n');
    expect(errors).toEqual(['[launcher] WARNING: skill pack x not cached; run pan skills pack sync x']);
  });

  it('skips packs without --plugin-link', async () => {
    mocks.resolveLaunchDisabledSkills.mockResolvedValue([]);
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w');
    expect(mocks.applyClaudePacks).not.toHaveBeenCalled();
  });

  it('fails open when applying Claude packs throws', async () => {
    mocks.resolveLaunchDisabledSkills.mockResolvedValue(['grilling']);
    mocks.applyClaudePacks.mockRejectedValue(new Error('disk full'));
    await run('launch-settings', '--harness', 'claude-code', '--cwd', '/w', '--plugin-link', '/tmp/none/skill-packs');
    expect(stdout.join('')).toBe('{"skillOverrides":{"grilling":"off"}}\n');
    expect(errors).toEqual(['[launcher] WARNING: skill packs not applied: disk full']);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('applies Codex packs after the skill-override block and clears them on failure', async () => {
    mocks.resolveLaunchDisabledSkills.mockResolvedValue([]);
    await run('launch-settings', '--harness', 'codex', '--cwd', '/w', '--codex-home', '/ch');
    expect(mocks.applyCodexPacks).toHaveBeenCalledWith({ cwd: '/w', issueId: undefined }, '/ch');
    expect(mocks.writeCodexSkillOverrides.mock.invocationCallOrder[0]).toBeLessThan(mocks.applyCodexPacks.mock.invocationCallOrder[0] ?? 0);

    mocks.applyCodexPacks.mockRejectedValue(new Error('boom'));
    await run('launch-settings', '--harness', 'codex', '--cwd', '/w', '--codex-home', '/ch');
    expect(errors).toEqual(['[launcher] WARNING: skill packs not applied: boom']);
    expect(mocks.writeCodexPackBlock).toHaveBeenCalledWith('/ch', null);
  });
});
