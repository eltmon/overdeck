import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listSkillCatalog, parseSkillDescription } from '../catalog.js';
import {
  CORE_SKILLS,
  disabledSkillNames,
  isCoreSkill,
  isPackSkillId,
  resolvePackSkill,
  resolvePackToggle,
  resolveSkillStates,
} from '../resolve.js';

const catalog = [
  { name: 'grilling', description: 'Grill the plan' },
  { name: 'codebase-design', description: 'Design modules' },
  { name: 'pan-done', description: 'Finish work' },
];

function stateOf(states: ReturnType<typeof resolveSkillStates>, name: string) {
  const state = states.find(s => s.name === name);
  if (!state) throw new Error(`missing ${name}`);
  return state;
}

describe('resolveSkillStates', () => {
  it('lets a project override beat the global default', () => {
    const states = resolveSkillStates(catalog, { global: { grilling: false }, project: { grilling: true } });
    expect(stateOf(states, 'grilling')).toMatchObject({
      enabled: true, source: 'project', global: false, project: true, issue: null,
    });
  });

  it('lets an issue override beat the project override', () => {
    const states = resolveSkillStates(catalog, { global: {}, project: { grilling: true }, issue: { grilling: false } });
    expect(stateOf(states, 'grilling')).toMatchObject({ enabled: false, source: 'issue' });
  });

  it('uses the global value when narrower levels inherit', () => {
    const states = resolveSkillStates(catalog, { global: { grilling: false }, project: {}, issue: {} });
    expect(stateOf(states, 'grilling')).toMatchObject({ enabled: false, source: 'global' });
  });

  it('defaults to on when no level has a value', () => {
    const states = resolveSkillStates(catalog, { global: {} });
    expect(stateOf(states, 'codebase-design')).toMatchObject({
      enabled: true, source: 'default', global: null, project: null, issue: null, core: false, projectSkill: false,
    });
  });

  it('carries the project-skill tag from the catalog', () => {
    const states = resolveSkillStates([{ name: 'local', description: '', projectSkill: true }], { global: {} });
    expect(states[0]).toMatchObject({ name: 'local', projectSkill: true, enabled: true, source: 'default' });
  });

  it('keeps core skills on regardless of overrides', () => {
    const layers = { global: { 'pan-done': false }, project: { 'pan-done': false }, issue: { 'pan-done': false } };
    const states = resolveSkillStates(catalog, layers);
    expect(stateOf(states, 'pan-done')).toMatchObject({ enabled: true, core: true, source: 'core' });
    expect(disabledSkillNames(layers)).not.toContain('pan-done');
  });

  it('sorts output by name', () => {
    expect(resolveSkillStates(catalog, { global: {} }).map(s => s.name))
      .toEqual(['codebase-design', 'grilling', 'pan-done']);
  });
});

describe('disabledSkillNames', () => {
  it('returns sorted non-core names resolved off, including names outside any catalog', () => {
    expect(disabledSkillNames({
      global: { zeta: false, grilling: false, alpha: true },
      project: { grilling: true, 'workspace-only': false },
      issue: { alpha: false, 'pan-task': false },
    })).toEqual(['alpha', 'workspace-only', 'zeta']);
  });
});

describe('CORE_SKILLS', () => {
  it('contains exactly the eleven lifecycle skills', () => {
    expect([...CORE_SKILLS].sort()).toEqual([
      'pan', 'pan-done', 'pan-flywheel', 'pan-foreman', 'pan-plan', 'pan-start',
      'pan-task', 'pan-tell', 'pan-worker', 'work-complete', 'write-xbrief',
    ]);
    expect(isCoreSkill('pan-start')).toBe(true);
    expect(isCoreSkill('grilling')).toBe(false);
  });
});

describe('listSkillCatalog', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'skill-catalog-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function addSkill(root: string, name: string, frontmatter: string): Promise<void> {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, 'SKILL.md'), `---\n${frontmatter}\n---\n\nBody\n`);
  }

  it('dedupes by name across roots, first root wins, and skips a missing root', async () => {
    const overdeck = join(home, '.overdeck', 'skills');
    const claude = join(home, '.claude', 'skills');
    await addSkill(overdeck, 'grilling', 'name: grilling\ndescription: From overdeck');
    await addSkill(claude, 'grilling', 'name: grilling\ndescription: From claude');
    await addSkill(claude, 'codebase-design', 'name: codebase-design\ndescription: Design');
    await mkdir(join(claude, 'not-a-skill'), { recursive: true });
    // ~/.agents/skills is intentionally missing.

    const projectRoot = join(home, 'project');
    await addSkill(join(projectRoot, '.pan', 'skills'), 'project-skill', 'name: project-skill');

    const entries = await listSkillCatalog({ home, projectRoot });
    expect(entries).toEqual([
      { name: 'codebase-design', description: 'Design' },
      { name: 'grilling', description: 'From overdeck' },
      { name: 'project-skill', description: '', projectSkill: true },
    ]);
  });

  it('returns an empty list when no roots exist', async () => {
    await expect(listSkillCatalog({ home })).resolves.toEqual([]);
  });
});

describe('parseSkillDescription', () => {
  it('takes the first line of a block-scalar description', () => {
    expect(parseSkillDescription('---\nname: x\ndescription: |\n  First line\n  Second line\n---\n')).toBe('First line');
  });

  it('returns empty for missing frontmatter or description', () => {
    expect(parseSkillDescription('# no frontmatter')).toBe('');
    expect(parseSkillDescription('---\nname: x\n---\n')).toBe('');
  });
});

describe('resolvePackSkill (PAN-4334 §4.3)', () => {
  it('lets a project per-skill off beat a global pack on', () => {
    const layers = { global: {}, project: { 'mattpocock/tdd': false }, packs: { global: { mattpocock: true } } };
    expect(resolvePackSkill('mattpocock/tdd', false, layers)).toEqual({ enabled: false, source: 'project' });
    expect(resolvePackSkill('mattpocock/grilling', false, layers)).toEqual({ enabled: true, source: 'global-pack' });
  });

  it('lets an issue pack off turn every skill off', () => {
    const layers = { global: {}, packs: { global: { mattpocock: true }, issue: { mattpocock: false } } };
    expect(resolvePackSkill('mattpocock/tdd', false, layers)).toEqual({ enabled: false, source: 'issue-pack' });
  });

  it('decides at the issue pack toggle before a project per-skill on', () => {
    const layers = { global: {}, project: { 'mattpocock/grilling': true }, packs: { issue: { mattpocock: false } } };
    expect(resolvePackSkill('mattpocock/grilling', false, layers)).toEqual({ enabled: false, source: 'issue-pack' });
  });

  it('turns on a single skill at global without the pack', () => {
    const layers = { global: { 'mattpocock/grilling': true } };
    expect(resolvePackSkill('mattpocock/grilling', false, layers)).toEqual({ enabled: true, source: 'global' });
    expect(resolvePackSkill('mattpocock/tdd', false, layers)).toEqual({ enabled: false, source: 'default' });
  });

  it('keeps an opt-in skill off when only the pack is on', () => {
    const layers = { global: {}, packs: { global: { mattpocock: true } } };
    expect(resolvePackSkill('mattpocock/setup-matt-pocock-skills', true, layers)).toEqual({ enabled: false, source: 'default' });
  });

  it('turns an opt-in skill on through its own global value', () => {
    const layers = { global: { 'mattpocock/setup-matt-pocock-skills': true }, packs: { global: { mattpocock: false } } };
    expect(resolvePackSkill('mattpocock/setup-matt-pocock-skills', true, layers)).toEqual({ enabled: true, source: 'global' });
  });

  it('skips only the skipped level per-skill value', () => {
    const layers = {
      global: { 'mattpocock/tdd': true },
      project: { 'mattpocock/tdd': false },
      issue: { 'mattpocock/tdd': true },
    };
    expect(resolvePackSkill('mattpocock/tdd', false, layers, 'issue')).toEqual({ enabled: false, source: 'project' });
    expect(resolvePackSkill('mattpocock/tdd', false, { global: { 'mattpocock/tdd': true }, issue: { 'mattpocock/tdd': false } }, 'issue'))
      .toEqual({ enabled: true, source: 'global' });
    const withToggle = { global: {}, issue: { 'mattpocock/tdd': true }, packs: { issue: { mattpocock: false } } };
    expect(resolvePackSkill('mattpocock/tdd', false, withToggle, 'issue')).toEqual({ enabled: false, source: 'issue-pack' });
  });
});

describe('resolvePackToggle', () => {
  it('returns the narrowest defined toggle, honoring skip, else off', () => {
    const layers = { global: {}, packs: { global: { mattpocock: true }, project: { mattpocock: false } } };
    expect(resolvePackToggle('mattpocock', layers)).toEqual({ enabled: false, source: 'project' });
    expect(resolvePackToggle('mattpocock', layers, 'project')).toEqual({ enabled: true, source: 'global' });
    expect(resolvePackToggle('other', layers)).toEqual({ enabled: false, source: 'default' });
  });
});

describe('pack skill ids and disabledSkillNames', () => {
  it('never hides a pack skill id by name', () => {
    expect(isPackSkillId('mattpocock/tdd')).toBe(true);
    expect(isPackSkillId('grilling')).toBe(false);
    expect(disabledSkillNames({ global: { 'mattpocock/tdd': false, grilling: false } })).toEqual(['grilling']);
  });
});
