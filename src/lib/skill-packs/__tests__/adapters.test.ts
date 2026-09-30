/**
 * PAN-4334 WI-1: pack adapters read skill lists and capabilities from real
 * fixture trees in temp dirs.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KNOWN_PACKS,
  detectAdapter,
  notAppliedLabels,
  readPackManifest,
  readSkillFrontmatter,
  type PackCapabilities,
} from '../adapters.js';
import { SAGEOX_DISCLOSURE } from '../../sageox/disclosure.js';

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-pack-adapter-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function skillMd(name: string | null, description: string): string {
  return `---\n${name ? `name: ${name}\n` : ''}description: ${description}\n---\n\nBody.\n`;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('readSkillFrontmatter', () => {
  it('returns the name and the first description line', () => {
    expect(readSkillFrontmatter('---\nname: tdd\ndescription: |\n  Test first.\n  More.\n---\n')).toEqual({
      name: 'tdd',
      description: 'Test first.',
    });
  });

  it('returns null name and empty description without frontmatter', () => {
    expect(readSkillFrontmatter('# no frontmatter')).toEqual({ name: null, description: '' });
    expect(readSkillFrontmatter('---\n: : bad\n---\n')).toEqual({ name: null, description: '' });
  });
});

describe('claude-plugin adapter', () => {
  const pluginFiles = (): Record<string, string> => ({
    '.claude-plugin/plugin.json': JSON.stringify({
      name: 'mattpocock-skills',
      license: 'MIT',
      skills: ['./skills/engineering/tdd', './skills/engineering/setup-matt-pocock-skills', './skills/productivity/grilling'],
    }),
    'skills/engineering/tdd/SKILL.md': skillMd('tdd', 'Test-driven development.'),
    'skills/engineering/setup-matt-pocock-skills/SKILL.md': skillMd('setup-matt-pocock-skills', 'Setup.'),
    'skills/productivity/grilling/SKILL.md': skillMd(null, 'Grill the plan.'),
    'skills/in-progress/unpublished/SKILL.md': skillMd('unpublished', 'Not listed.'),
  });

  it('returns exactly the skills plugin.json lists', async () => {
    const root = fixture(pluginFiles());
    expect(await detectAdapter(root)).toBe('claude-plugin');
    const manifest = await readPackManifest(root, 'claude-plugin');
    expect(manifest.skills.map((skill) => skill.name)).toEqual(['tdd', 'setup-matt-pocock-skills', 'grilling']);
    expect(manifest.skills.find((skill) => skill.name === 'grilling')).toEqual({
      name: 'grilling',
      dir: 'skills/productivity/grilling',
      description: 'Grill the plan.',
      optIn: false,
    });
    expect(manifest.license).toBe('MIT');
    expect(manifest.pluginName).toBe('mattpocock-skills');
  });

  it('marks only the opt-in skill optIn and lists it as project-mutating', async () => {
    const root = fixture(pluginFiles());
    const manifest = await readPackManifest(root, 'claude-plugin', { optIn: ['setup-matt-pocock-skills'] });
    expect(manifest.skills.filter((skill) => skill.optIn).map((skill) => skill.name)).toEqual([
      'setup-matt-pocock-skills',
    ]);
    expect(manifest.capabilities.projectMutatingSkills).toEqual(['setup-matt-pocock-skills']);
  });

  it('reports hooks, MCP servers and skill-local scripts', async () => {
    const root = fixture({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'loud', skills: ['./skills/a'] }),
      'hooks/hooks.json': '{}',
      '.mcp.json': '{}',
      'skills/a/SKILL.md': skillMd('a', 'A.'),
      'skills/a/scripts/run.sh': 'echo hi\n',
      'skills/b/scripts/other.sh': 'echo not included\n',
    });
    const manifest = await readPackManifest(root, 'claude-plugin');
    expect(manifest.capabilities.hooks).toBe(true);
    expect(manifest.capabilities.mcpServers).toBe(true);
    expect(manifest.capabilities.executables).toEqual(['skills/a/scripts/run.sh']);
    expect(notAppliedLabels(manifest.capabilities)).toEqual(['hooks', 'MCP servers', 'executables (1)']);
  });

  it('skips skill paths that escape the repo', async () => {
    const root = fixture({
      '.claude-plugin/plugin.json': JSON.stringify({ skills: ['../outside', '/etc', './skills/ok'] }),
      'skills/ok/SKILL.md': skillMd('ok', 'Ok.'),
    });
    const manifest = await readPackManifest(root, 'claude-plugin');
    expect(manifest.skills.map((skill) => skill.dir)).toEqual(['skills/ok']);
  });

  it('scans skills/ when plugin.json has no skills key', async () => {
    const root = fixture({
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'bare' }),
      'skills/x/SKILL.md': skillMd('x', 'X.'),
    });
    const manifest = await readPackManifest(root, 'claude-plugin');
    expect(manifest.skills.map((skill) => skill.name)).toEqual(['x']);
  });

  it('throws on an invalid plugin.json', async () => {
    const root = fixture({ '.claude-plugin/plugin.json': '{not json' });
    await expect(readPackManifest(root, 'claude-plugin')).rejects.toThrow(/invalid .*plugin\.json/);
  });
});

describe('plain adapter', () => {
  it('finds nested and flat skills', async () => {
    const root = fixture({
      'skills/a/b/SKILL.md': skillMd(null, 'B.'),
      'skills/c/SKILL.md': skillMd(null, 'C.'),
      'skills/c/nested/SKILL.md': skillMd('nested', 'Inside a skill, not a skill.'),
      'LICENSE': '\nMIT License\n\nCopyright\n',
    });
    expect(await detectAdapter(root)).toBe('plain');
    const manifest = await readPackManifest(root, 'plain');
    expect(manifest.skills.map((skill) => [skill.name, skill.dir])).toEqual([
      ['b', 'skills/a/b'],
      ['c', 'skills/c'],
    ]);
    expect(manifest.license).toBe('MIT');
    expect(manifest.pluginName).toBeNull();
    expect(notAppliedLabels(manifest.capabilities)).toEqual([]);
  });

  it('skips invalid names, duplicates and symlinked dirs', async () => {
    const root = fixture({
      'skills/one/dup/SKILL.md': skillMd(null, 'First.'),
      'skills/two/dup/SKILL.md': skillMd(null, 'Second.'),
      'skills/Bad_Name/SKILL.md': skillMd(null, 'Bad.'),
      'elsewhere/linked/SKILL.md': skillMd(null, 'Linked.'),
    });
    symlinkSync(join(root, 'elsewhere', 'linked'), join(root, 'skills', 'linked'));
    const manifest = await readPackManifest(root, 'plain');
    expect(manifest.skills.map((skill) => [skill.name, skill.description])).toEqual([['dup', 'First.']]);
  });

  it('scans skillsRoot instead of skills/ when given', async () => {
    const root = fixture({
      'extensions/skills/sageox/SKILL.md': skillMd('sageox', 'Team context.'),
      'extensions/skills/ox-cli-init/SKILL.md': skillMd('ox-cli-init', 'Init.'),
      'skills/ignored/SKILL.md': skillMd('ignored', 'Not under the root.'),
    });
    const manifest = await readPackManifest(root, 'plain', { skillsRoot: 'extensions/skills', optIn: ['ox-cli-init'] });
    expect(manifest.skills.map((skill) => [skill.name, skill.dir, skill.optIn])).toEqual([
      ['ox-cli-init', 'extensions/skills/ox-cli-init', true],
      ['sageox', 'extensions/skills/sageox', false],
    ]);
  });
});

describe('KNOWN_PACKS', () => {
  it('marks mattpocock as a claude-plugin pack with its opt-in skill', () => {
    expect(KNOWN_PACKS['mattpocock']).toMatchObject({
      url: 'https://github.com/eltmon/skills',
      adapter: 'claude-plugin',
      optIn: ['setup-matt-pocock-skills'],
    });
  });

  it('marks sageox as a plain pack from the fork with repo-writing skills opt-in', () => {
    expect(KNOWN_PACKS['sageox']).toEqual({
      id: 'sageox',
      url: 'https://github.com/eltmon/ox',
      adapter: 'plain',
      skillsRoot: 'extensions/skills',
      optIn: [
        'ox-cli-init',
        'ox-cli-attest',
        'ox-cli-skill-manager',
        'ox-cli-pr-header',
        'ox-cli-plan',
        'ox-cli-cart',
        'ox-cli-cart-start',
        'ox-cli-cart-done',
        'ox-cli-cart-drop',
      ],
      disclosure: SAGEOX_DISCLOSURE,
    });
  });
});

describe('notAppliedLabels', () => {
  it('labels every capability', () => {
    const capabilities: PackCapabilities = {
      hooks: true,
      mcpServers: true,
      commands: true,
      agents: true,
      contextInjection: true,
      gitHooks: true,
      executables: ['a.sh', 'b.sh'],
      projectMutatingSkills: ['setup'],
      requiresCli: ['ox'],
    };
    expect(notAppliedLabels(capabilities)).toEqual([
      'hooks',
      'MCP servers',
      'commands',
      'agents',
      'context injection',
      'git hooks',
      'executables (2)',
      'project-mutating skills (1)',
      'requires CLI (ox)',
    ]);
  });
});
