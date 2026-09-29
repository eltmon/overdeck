/**
 * PAN-3942 WI-2: skill overrides persist at global, project, and issue level.
 *
 * Real files under a temp OVERDECK_HOME and a real temp git repo as the plan
 * home. `commitPlanArtifacts` stays real; `pushPlanArtifacts` is mocked (no
 * remote). The skill catalog is mocked so validation does not depend on the
 * machine's installed skills.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-store-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

vi.mock('../catalog.js', () => ({
  listSkillCatalog: vi.fn(async () => [
    { name: 'grilling', description: '' },
    { name: 'codebase-design', description: '' },
  ]),
  listPackCatalog: vi.fn(async () => [
    {
      id: 'mattpocock',
      url: 'https://github.com/mattpocock/skills',
      ref: 'v1.2.3',
      commit: 'c'.repeat(40),
      adapter: 'claude-plugin',
      cached: true,
      manifest: {
        skills: [
          { name: 'grilling', dir: 'skills/productivity/grilling', description: 'Grill.', optIn: false },
          { name: 'tdd', dir: 'skills/engineering/tdd', description: 'Test first.', optIn: false },
          { name: 'setup-matt-pocock-skills', dir: 'skills/engineering/setup-matt-pocock-skills', description: 'Setup.', optIn: true },
        ],
        capabilities: {
          hooks: false, mcpServers: false, commands: false, agents: false, contextInjection: false, gitHooks: false,
          executables: [], projectMutatingSkills: ['setup-matt-pocock-skills'], requiresCli: [],
        },
        license: 'MIT',
        pluginName: 'mattpocock-skills',
      },
    },
  ]),
  readInstalledClaudePluginNames: vi.fn(async () => new Set<string>()),
}));

vi.mock('../../overdeck/plan-artifact-commit.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../overdeck/plan-artifact-commit.js')>()),
  pushPlanArtifacts: vi.fn(async () => ({ pushed: false, skipped: true, reason: 'main has no upstream' })),
}));

import { invalidateProjectsConfigCache } from '../../projects.js';
import {
  issueSkillOverridesPath,
  listLowerLevelOverrides,
  listLowerLevelPackOverrides,
  listSkillStates,
  loadSkillOverrideLayers,
  parseSkillOverrideUpdate,
  readGlobalSkillOverrides,
  readProjectSkillOverrides,
  setSkillOverride,
  SkillOverrideError,
} from '../store.js';

const configPath = join(overdeckHome, 'config.yaml');
const projectsPath = join(overdeckHome, 'projects.yaml');
let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

beforeEach(() => {
  rmSync(configPath, { force: true });
  repo = mkdtempSync(join(tmpdir(), 'skill-store-repo-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@overdeck.local');
  git('config', 'user.name', 'Overdeck Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: seed');
  writeFileSync(projectsPath, `projects:\n  tst:\n    name: Test\n    path: ${repo}\n    issue_prefix: TST\n`);
  invalidateProjectsConfigCache();
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(SkillOverrideError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('global overrides', () => {
  it('sets a skill off while preserving comments and unrelated keys', async () => {
    writeFileSync(configPath, '# my settings\ntheme: dark # keep me\n');

    await setSkillOverride({ level: 'global', skill: 'grilling', enabled: false });

    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('# my settings');
    expect(text).toContain('theme: dark # keep me');
    expect(await readGlobalSkillOverrides()).toEqual({ grilling: false });
  });

  it('creates config.yaml when it does not exist', async () => {
    await setSkillOverride({ level: 'global', skill: 'grilling', enabled: false });
    expect(await readGlobalSkillOverrides()).toEqual({ grilling: false });
  });

  it('clears the key and prunes empty maps on inherit', async () => {
    writeFileSync(configPath, 'theme: dark\n');
    await setSkillOverride({ level: 'global', skill: 'grilling', enabled: false });

    await setSkillOverride({ level: 'global', skill: 'grilling', enabled: null });

    expect(await readGlobalSkillOverrides()).toEqual({});
    expect(readFileSync(configPath, 'utf8')).not.toContain('skills');
  });

  it('treats "on" as clearing the key, because global is two-state', async () => {
    await setSkillOverride({ level: 'global', skill: 'grilling', enabled: false });
    await setSkillOverride({ level: 'global', skill: 'codebase-design', enabled: false });

    await setSkillOverride({ level: 'global', skill: 'grilling', enabled: true });

    expect(await readGlobalSkillOverrides()).toEqual({ 'codebase-design': false });
  });

  it('ignores non-boolean entries on read', async () => {
    writeFileSync(configPath, 'skills:\n  overrides:\n    grilling: false\n    bogus: maybe\n');
    expect(await readGlobalSkillOverrides()).toEqual({ grilling: false });
  });
});

describe('project overrides', () => {
  it('round-trips set and clear', async () => {
    await setSkillOverride({ level: 'project', projectKey: 'tst', skill: 'grilling', enabled: true });
    expect(await readProjectSkillOverrides('tst')).toEqual({ grilling: true });
    expect(readFileSync(projectsPath, 'utf8')).toContain('skill_overrides');

    await setSkillOverride({ level: 'project', projectKey: 'tst', skill: 'grilling', enabled: null });
    expect(await readProjectSkillOverrides('tst')).toEqual({});
    expect(readFileSync(projectsPath, 'utf8')).not.toContain('skill_overrides');
  });

  it('rejects an unknown project', async () => {
    await expectCode(setSkillOverride({ level: 'project', projectKey: 'nope', skill: 'grilling', enabled: false }), 'unknown-project');
  });
});

describe('issue overrides', () => {
  const issuePath = () => issueSkillOverridesPath(repo, 'TST-1');

  it('writes the YAML file and commits it with the expected subject', async () => {
    const result = await setSkillOverride({ level: 'issue', issueId: 'tst-1', skill: 'grilling', enabled: false });

    expect(result).toMatchObject({ committed: true, pushed: false, reason: 'main has no upstream' });
    expect(readFileSync(issuePath(), 'utf8')).toContain('issue: TST-1');
    expect(git('log', '-1', '--format=%s')).toBe('chore(workspace): skill overrides for TST-1\n');
    expect(git('show', '--name-only', '--format=', 'HEAD')).toContain('.pan/skill-overrides/TST-1.yaml');

    const layers = await loadSkillOverrideLayers({ issueId: 'TST-1' });
    expect(layers).toEqual({
      global: {}, project: {}, issue: { grilling: false }, packs: { global: {}, project: {}, issue: {} },
    });
  });

  it('deletes the file and commits the deletion when the last key is cleared', async () => {
    await setSkillOverride({ level: 'issue', issueId: 'TST-1', skill: 'grilling', enabled: false });

    const result = await setSkillOverride({ level: 'issue', issueId: 'TST-1', skill: 'grilling', enabled: null });

    expect(result).toMatchObject({ committed: true });
    expect(existsSync(issuePath())).toBe(false);
    expect(git('show', '--name-status', '--format=', 'HEAD')).toContain('D\t.pan/skill-overrides/TST-1.yaml');
  });

  it('treats deleting a never-committed file as nothing to commit', async () => {
    mkdirSync(join(repo, '.pan', 'skill-overrides'), { recursive: true });
    writeFileSync(issuePath(), 'issue: TST-1\nskills:\n  grilling: false\n');

    await expect(setSkillOverride({ level: 'issue', issueId: 'TST-1', skill: 'grilling', enabled: null }))
      .resolves.toMatchObject({ committed: false });
    expect(existsSync(issuePath())).toBe(false);
  });

  it('rejects an issue no project owns', async () => {
    await expectCode(setSkillOverride({ level: 'issue', issueId: 'ZZZ-1', skill: 'grilling', enabled: false }), 'unknown-issue');
  });
});

describe('listLowerLevelOverrides', () => {
  it('reports the projects and issues that override each skill', async () => {
    await setSkillOverride({ level: 'project', projectKey: 'tst', skill: 'grilling', enabled: true });
    await setSkillOverride({ level: 'issue', issueId: 'TST-2', skill: 'grilling', enabled: false });
    await setSkillOverride({ level: 'issue', issueId: 'TST-1', skill: 'codebase-design', enabled: false });

    expect(await listLowerLevelOverrides()).toEqual({
      grilling: { projects: ['tst'], issues: ['TST-2'] },
      'codebase-design': { projects: [], issues: ['TST-1'] },
    });
  });
});

describe('validation', () => {
  it('rejects core skills at every level', async () => {
    await expectCode(setSkillOverride({ level: 'global', skill: 'pan-done', enabled: false }), 'core-skill');
    await expectCode(setSkillOverride({ level: 'issue', issueId: 'TST-1', skill: 'pan-done', enabled: null }), 'core-skill');
  });

  it('rejects a skill outside the catalog', async () => {
    await expectCode(setSkillOverride({ level: 'global', skill: 'no-such-skill', enabled: false }), 'unknown-skill');
  });

  it('lets inherit clear a stale name that is no longer in the catalog', async () => {
    writeFileSync(configPath, 'skills:\n  overrides:\n    retired-skill: false\n');
    await setSkillOverride({ level: 'global', skill: 'retired-skill', enabled: null });
    expect(await readGlobalSkillOverrides()).toEqual({});
  });
});

describe('parseSkillOverrideUpdate', () => {
  it('requires projectKey for level project', () => {
    expect(() => parseSkillOverrideUpdate({ level: 'project', skill: 'grilling', enabled: false }))
      .toThrow(expect.objectContaining({ code: 'bad-request' }));
  });

  it('rejects a missing enabled field and an unknown level', () => {
    expect(() => parseSkillOverrideUpdate({ level: 'global', skill: 'grilling' })).toThrow(SkillOverrideError);
    expect(() => parseSkillOverrideUpdate({ level: 'team', skill: 'grilling', enabled: false })).toThrow(SkillOverrideError);
  });

  it('normalizes an issue id to upper case', () => {
    expect(parseSkillOverrideUpdate({ level: 'issue', issueId: 'tst-9', skill: 'grilling', enabled: null }))
      .toEqual({ level: 'issue', issueId: 'TST-9', skill: 'grilling', enabled: null });
  });
});

describe('pack states (PAN-4334)', () => {
  const packSkill = (list: Awaited<ReturnType<typeof listSkillStates>>, name: string) => {
    const skill = list.packs[0]?.skills.find(entry => entry.name === name);
    if (!skill) throw new Error(`missing pack skill ${name}`);
    return skill;
  };

  it('lists every pack skill off by default', async () => {
    const list = await listSkillStates({});
    expect(list.packs).toHaveLength(1);
    expect(list.packs[0]).toMatchObject({
      id: 'mattpocock', license: 'MIT', cached: true, notApplied: ['project-mutating skills (1)'],
      duplicatePluginInstall: false, global: null, enabled: false, source: 'default',
    });
    expect(list.packs[0]?.updateAvailable).toBeUndefined();
    expect(list.packs[0]?.skills.map(skill => [skill.name, skill.enabled, skill.source])).toEqual([
      ['grilling', false, 'default'],
      ['setup-matt-pocock-skills', false, 'default'],
      ['tdd', false, 'default'],
    ]);
  });

  it('turns the pack on at global but leaves the opt-in skill off', async () => {
    writeFileSync(configPath, 'skills:\n  pack_overrides:\n    mattpocock: true\n');
    const list = await listSkillStates({});
    expect(list.packs[0]).toMatchObject({ global: true, enabled: true, source: 'global' });
    expect(packSkill(list, 'tdd')).toMatchObject({ id: 'mattpocock/tdd', enabled: true, source: 'global-pack' });
    expect(packSkill(list, 'setup-matt-pocock-skills')).toMatchObject({ optIn: true, enabled: false, source: 'default' });
  });

  it('flags a pack skill whose name a native skill also uses', async () => {
    const list = await listSkillStates({});
    expect(packSkill(list, 'grilling').bundledOverlap).toBe(true);
    expect(packSkill(list, 'tdd').bundledOverlap).toBe(false);
  });

  it('keeps the native skills unchanged and reads issue-file pack toggles', async () => {
    const path = issueSkillOverridesPath(repo, 'TST-1');
    mkdirSync(join(repo, '.pan', 'skill-overrides'), { recursive: true });
    writeFileSync(path, 'issue: TST-1\nskills:\n  grilling: false\n  mattpocock/tdd: false\npacks:\n  mattpocock: true\n');
    const list = await listSkillStates({ issueId: 'tst-1' });
    expect(list.skills.map(skill => Object.keys(skill).sort())).toEqual(
      list.skills.map(() => ['core', 'description', 'enabled', 'global', 'issue', 'name', 'project', 'projectSkill', 'source']),
    );
    expect(list.skills.find(skill => skill.name === 'grilling')).toMatchObject({ enabled: false, source: 'issue' });
    expect(list.packs[0]).toMatchObject({ issue: true, enabled: true, source: 'issue', inherited: { enabled: false, source: 'default' } });
    expect(packSkill(list, 'tdd')).toMatchObject({
      issue: false, enabled: false, source: 'issue', inherited: { enabled: true, source: 'issue-pack' },
    });
    expect(packSkill(list, 'grilling')).toMatchObject({ enabled: true, source: 'issue-pack' });
    const layers = await loadSkillOverrideLayers({ issueId: 'TST-1' });
    expect(layers.packs).toEqual({ global: {}, project: {}, issue: { mattpocock: true } });
    expect(await listLowerLevelPackOverrides()).toEqual({ mattpocock: { projects: [], issues: ['TST-1'] } });
  });

  it('reports project pack toggles below global', async () => {
    writeFileSync(projectsPath, `projects:\n  tst:\n    name: Test\n    path: ${repo}\n    issue_prefix: TST\n    skill_pack_overrides:\n      mattpocock: false\n`);
    invalidateProjectsConfigCache();
    const list = await listSkillStates({ projectKey: 'tst' });
    expect(list.packs[0]).toMatchObject({ project: false, enabled: false, source: 'project' });
    expect(await listLowerLevelPackOverrides()).toEqual({ mattpocock: { projects: ['tst'], issues: [] } });
  });
});
