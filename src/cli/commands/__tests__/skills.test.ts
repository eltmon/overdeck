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
  class PackSourceError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    SkillOverrideError,
    PackSourceError,
    addPack: vi.fn(),
    updatePack: vi.fn(),
    removePack: vi.fn(),
    syncPack: vi.fn(),
    listPacks: vi.fn(),
    packUpdateAvailable: vi.fn(),
    writePackEntry: vi.fn(),
    listPackCatalog: vi.fn(),
    listLowerLevelPackOverrides: vi.fn(),
    gcMounts: vi.fn(),
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
  listLowerLevelPackOverrides: mocks.listLowerLevelPackOverrides,
}));

vi.mock('../../../lib/skill-packs/sources.js', () => ({
  PackSourceError: mocks.PackSourceError,
  addPack: mocks.addPack,
  updatePack: mocks.updatePack,
  removePack: mocks.removePack,
  syncPack: mocks.syncPack,
  listPacks: mocks.listPacks,
  packUpdateAvailable: mocks.packUpdateAvailable,
  writePackEntry: mocks.writePackEntry,
}));

vi.mock('../../../lib/skill-overrides/catalog.js', () => ({ listPackCatalog: mocks.listPackCatalog }));

vi.mock('../../../lib/skill-overrides/launch.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/skill-overrides/launch.js')>()),
  resolveLaunchDisabledSkills: mocks.resolveLaunchDisabledSkills,
  writeCodexSkillOverrides: mocks.writeCodexSkillOverrides,
  applyClaudePacks: mocks.applyClaudePacks,
  applyCodexPacks: mocks.applyCodexPacks,
}));

vi.mock('../../../lib/skill-packs/mount.js', () => ({ writeCodexPackBlock: mocks.writeCodexPackBlock, gcMounts: mocks.gcMounts }));

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

  it('sets a pack toggle at issue level (PAN-4334)', async () => {
    await run('set', '--pack', 'mattpocock', 'off', '--issue', 'PAN-1');
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'issue', pack: 'mattpocock', enabled: false, issueId: 'PAN-1' });
    expect(logs).toContain('mattpocock (pack): off at issue PAN-1');
  });

  it('reports a global pack on without the native default wording', async () => {
    await run('set', '--pack', 'mattpocock', 'on');
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'global', pack: 'mattpocock', enabled: true });
    expect(logs).toContain('mattpocock (pack): on at global');
  });

  it('sets a pack skill by its pack/skill id', async () => {
    await run('set', 'mattpocock/tdd', 'on');
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'global', skill: 'mattpocock/tdd', enabled: true });
    expect(logs).toContain('mattpocock/tdd: on at global');
  });

  it('reports an unknown pack skill with exit 1', async () => {
    mocks.setSkillOverride.mockRejectedValue(new mocks.SkillOverrideError('unknown-skill', 'unknown skill: mattpocock/unknown'));
    await expect(run('set', 'mattpocock/unknown', 'on')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('unknown skill');
  });

  it('prints the usage line for the wrong number of positionals', async () => {
    await expect(run('set', '--pack', 'mattpocock', 'grilling', 'off')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('usage: pan skills set');
    await expect(run('set', 'grilling')).rejects.toThrow('exit 1');
    expect(mocks.setSkillOverride).not.toHaveBeenCalled();
  });
});

describe('pan skills list packs (PAN-4334)', () => {
  it('prints a Skill packs block after the native skills', async () => {
    mocks.listSkillStates.mockResolvedValue({
      project: null, issue: null, skills: [grilling],
      packs: [{
        id: 'mattpocock', cached: true, enabled: true, source: 'global',
        skills: [
          { id: 'mattpocock/grilling', enabled: true, source: 'global-pack', optIn: false },
          { id: 'mattpocock/setup-matt-pocock-skills', enabled: false, source: 'default', optIn: true },
        ],
      }],
    });
    await run('list');
    const out = logs.join('\n');
    expect(out.indexOf('Skill packs (1)')).toBeGreaterThan(out.indexOf('grilling'));
    expect(out).toMatch(/mattpocock\s+on\s+global/);
    expect(out).toMatch(/ {2}mattpocock\/grilling\s+on\s+global-pack/);
    expect(out).toMatch(/ {2}mattpocock\/setup-matt-pocock-skills\s+off\s+default\s+opt-in/);
  });

  it('keeps list --json to the native skills array', async () => {
    mocks.listSkillStates.mockResolvedValue({ project: null, issue: null, skills: [grilling], packs: [{ id: 'x', skills: [] }] });
    await run('list', '--json');
    expect(JSON.parse(logs.join('\n'))).toEqual([grilling]);
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

describe('pan skills pack', () => {
  const COMMIT = 'c55ee46073ed'.padEnd(40, '0');
  const capabilities = {
    hooks: false, mcpServers: false, commands: false, agents: false, contextInjection: false, gitHooks: false,
    executables: ['skills/engineering/diagnosing-bugs/scripts/hitl-loop.template.sh'],
    projectMutatingSkills: ['setup-matt-pocock-skills'], requiresCli: [],
  };
  const preview = {
    id: 'mattpocock', url: 'https://github.com/mattpocock/skills', ref: 'v1.2.3', commit: COMMIT, adapter: 'claude-plugin',
    manifest: {
      skills: [
        { name: 'grilling', dir: 'skills/productivity/grilling', description: '', optIn: false },
        { name: 'setup-matt-pocock-skills', dir: 'skills/engineering/setup-matt-pocock-skills', description: '', optIn: true },
      ],
      capabilities, license: 'MIT', pluginName: 'mattpocock-skills',
    },
  };
  const addArgs = ['pack', 'add', 'mattpocock', 'https://github.com/mattpocock/skills', '--ref', 'v1.2.3'];
  let isTTY: boolean | undefined;

  beforeEach(() => {
    isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    mocks.addPack.mockImplementation(async (_input: unknown, confirm: (p: typeof preview) => Promise<boolean>) => {
      const written = await confirm(preview);
      if (written) mocks.writePackEntry();
      return { written, preview };
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true });
  });

  it('prints the preview and writes nothing without --yes on a non-TTY', async () => {
    await expect(run(...addArgs)).rejects.toThrow('exit 1');
    const out = logs.join('\n');
    expect(out).toContain('Pack mattpocock');
    expect(out).toContain('  Source       https://github.com/mattpocock/skills @ v1.2.3 (c55ee46)');
    expect(out).toContain('  Skills       2 (1 opt-in: setup-matt-pocock-skills)');
    expect(out).toContain('  Executables  skills/engineering/diagnosing-bugs/scripts/hitl-loop.template.sh');
    expect(out).toContain('  Not applied  executables (1), project-mutating skills (1)');
    expect(out).toContain('Not written: re-run with --yes to trust c55ee46.');
    expect(mocks.writePackEntry).not.toHaveBeenCalled();
  });

  it('trusts the commit with --yes and prints the enable hint', async () => {
    await run(...addArgs, '--yes');
    expect(mocks.addPack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mattpocock', url: 'https://github.com/mattpocock/skills', ref: 'v1.2.3', reservedIds: expect.arrayContaining(['pan-done']) }),
      expect.any(Function),
    );
    expect(mocks.writePackEntry).toHaveBeenCalledOnce();
    expect(logs.join('\n')).toContain('Turn it on with: pan skills set --pack mattpocock on');
  });

  it('refuses sageox with the integration note', async () => {
    mocks.addPack.mockRejectedValue(new mocks.PackSourceError('integration', 'SageOx is an integration, not a skill pack; see https://github.com/eltmon/overdeck/issues/2444'));
    await expect(run('pack', 'add', 'sageox', 'https://github.com/sageox/ox', '--ref', 'main', '--yes')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('issues/2444');
  });

  it('rejects an unknown adapter before any work', async () => {
    await expect(run(...addArgs, '--adapter', 'npm')).rejects.toThrow('exit 1');
    expect(mocks.addPack).not.toHaveBeenCalled();
  });

  it('lists packs as JSON offline without an update check', async () => {
    mocks.listPackCatalog.mockResolvedValue([
      { id: 'mattpocock', url: preview.url, ref: 'v1.2.3', commit: COMMIT, adapter: 'claude-plugin', cached: true, manifest: preview.manifest },
    ]);
    await run('pack', 'list', '--json', '--offline');
    expect(JSON.parse(logs.join('\n'))).toEqual([{
      id: 'mattpocock', url: preview.url, ref: 'v1.2.3', commit: COMMIT, adapter: 'claude-plugin', cached: true,
      license: 'MIT', skills: 2, notApplied: ['executables (1)', 'project-mutating skills (1)'],
    }]);
    expect(mocks.packUpdateAvailable).not.toHaveBeenCalled();
  });

  it('includes updateAvailable when online', async () => {
    mocks.listPackCatalog.mockResolvedValue([
      { id: 'mattpocock', url: preview.url, ref: 'main', commit: COMMIT, adapter: 'claude-plugin', cached: false, manifest: null },
    ]);
    mocks.packUpdateAvailable.mockResolvedValue('f'.repeat(40));
    await run('pack', 'list', '--json');
    expect(JSON.parse(logs.join('\n'))[0]).toMatchObject({ cached: false, skills: 0, updateAvailable: 'f'.repeat(40) });
  });

  it('prints the fork add hint when no packs are registered', async () => {
    mocks.listPackCatalog.mockResolvedValue([]);
    await run('pack', 'list', '--offline');
    expect(logs.join('\n')).toBe('No skill packs. Add one with: pan skills pack add mattpocock https://github.com/eltmon/skills --ref v1.2.3');
  });

  it('reports an up-to-date pack without asking', async () => {
    mocks.updatePack.mockResolvedValue({ written: false, preview });
    await run('pack', 'update', 'mattpocock');
    expect(logs.join('\n')).toContain('mattpocock is up to date at v1.2.3 (c55ee46).');
  });

  it('removes a pack and reports inert lower-level toggles', async () => {
    mocks.removePack.mockResolvedValue({ removed: true });
    mocks.listLowerLevelPackOverrides.mockResolvedValue({ mattpocock: { projects: ['tst'], issues: ['TST-1'] } });
    await run('pack', 'remove', 'mattpocock');
    expect(logs.join('\n')).toContain('2 project or issue toggle(s) for mattpocock remain');
  });

  it('syncs every registered pack and fails when one fails', async () => {
    mocks.listPacks.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    mocks.syncPack.mockImplementation(async (id: string) => {
      if (id === 'b') throw new mocks.PackSourceError('git', 'pack b: unreachable');
      return { commit: COMMIT, dir: '/x' };
    });
    await expect(run('pack', 'sync')).rejects.toThrow('exit 1');
    expect(logs).toEqual(['a: cached c55ee46']);
    expect(errors.join('\n')).toContain('pack b: unreachable');
  });

  it('collects garbage with the default age', async () => {
    mocks.gcMounts.mockResolvedValue({ removedMounts: ['/m/1'], removedLinks: [] });
    await run('pack', 'gc');
    expect(mocks.gcMounts).toHaveBeenCalledWith({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    expect(logs.join('\n')).toContain('Removed 1 mount(s) and 0 dangling launch link(s).');
  });
});
