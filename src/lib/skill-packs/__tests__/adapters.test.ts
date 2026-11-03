/**
 * PAN-4334 WI-1: pack adapters read skill lists and capabilities from real
 * fixture trees in temp dirs.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { DEFT_SKILL_MAP } from '../deft.js';
import { GSTACK_BROWSER_NEEDED, GSTACK_DISCLOSURE, GSTACK_OPT_IN_SKILLS, GSTACK_SKILL_MAP } from '../gstack.js';

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

describe('plugin root', () => {
  it('reads a claude-plugin pack from pluginRoot and returns repo-relative dirs', async () => {
    const root = fixture({
      'harness/p/claude-code/.claude-plugin/plugin.json': JSON.stringify({ name: 'p', license: 'MIT' }),
      'harness/p/claude-code/skills/alpha/SKILL.md': skillMd('alpha', 'Alpha.'),
      'harness/p/claude-code/skills/alpha/scripts/run.sh': 'echo hi\n',
      'harness/p/claude-code/skills/beta/SKILL.md': skillMd('beta', 'Beta.'),
      'harness/p/claude-code/agents/x.md': '# Agent\n',
      'skills/decoy/SKILL.md': skillMd('decoy', 'Decoy at repo root.'),
    });
    const manifest = await readPackManifest(root, 'claude-plugin', { pluginRoot: 'harness/p/claude-code' });
    expect(manifest.skills.map((skill) => [skill.name, skill.dir])).toEqual([
      ['alpha', 'harness/p/claude-code/skills/alpha'],
      ['beta', 'harness/p/claude-code/skills/beta'],
    ]);
    expect(manifest.capabilities.agents).toBe(true);
    expect(manifest.capabilities.executables).toEqual(['harness/p/claude-code/skills/alpha/scripts/run.sh']);
    expect(manifest.license).toBe('MIT');
    expect(manifest.pluginName).toBe('p');
  });

  it('rejects a plugin root that escapes the repo', async () => {
    const root = fixture({ 'skills/x/SKILL.md': skillMd('x', 'X.') });
    for (const pluginRoot of ['../x', '/abs', '..', '']) {
      await expect(readPackManifest(root, 'plain', { pluginRoot })).rejects.toThrow(/invalid pack plugin root/);
    }
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

describe('deft-readonly adapter', () => {
  const deftFiles = (omit: readonly string[] = []): Record<string, string> => {
    const files: Record<string, string> = { LICENSE: 'MIT License\n\nCopyright (c) Deft\n' };
    for (const name of Object.keys(DEFT_SKILL_MAP)) {
      if (omit.includes(name)) continue;
      files[`content/skills/deft-directive-${name}/SKILL.md`] = skillMd(`deft-directive-${name}`, `Deft ${name}.`);
    }
    return files;
  };

  it('returns only the read-only allowlist, named by the stripped dir name', async () => {
    const manifest = await readPackManifest(fixture(deftFiles()), 'deft-readonly');
    expect(manifest.skills.map((skill) => skill.name)).toEqual([
      'cost',
      'debug',
      'design-critique',
      'gh-arch',
      'glossary',
      'probe',
      'write-skill',
    ]);
    for (const skill of manifest.skills) expect(skill.dir).toBe(`content/skills/deft-directive-${skill.name}`);
    expect(manifest.license).toBe('MIT');
  });

  it('reports the Deft capabilities a mount leaves out', async () => {
    const manifest = await readPackManifest(fixture(deftFiles()), 'deft-readonly');
    expect(notAppliedLabels(manifest.capabilities)).toEqual(
      expect.arrayContaining(['hooks', 'context injection', 'git hooks', 'requires CLI (directive)']),
    );
  });

  it('skips an allowlisted skill that is missing at the commit', async () => {
    const manifest = await readPackManifest(fixture(deftFiles(['probe'])), 'deft-readonly');
    expect(manifest.skills.map((skill) => skill.name)).toHaveLength(6);
    expect(manifest.skills.map((skill) => skill.name)).not.toContain('probe');
  });
});

describe('gstack-runtime adapter', () => {
  function gstackFixture(): string {
    const root = fixture({
      'bin/gstack-x': '#!/usr/bin/env bash\n',
      'bin/notes.txt': 'not executable',
      'scripts/pack-render.sh': '#!/usr/bin/env bash\n',
      'test/t.sh': '#!/usr/bin/env bash\n',
      'node_modules/dep/run.sh': '#!/usr/bin/env bash\n',
      '.git/hooks/pre-commit.sh': '#!/usr/bin/env bash\n',
      'review/SKILL.md': skillMd('review', 'Pre-landing review.'),
      'review/bin/helper.sh': '#!/usr/bin/env bash\n',
      'codex/SKILL.md': skillMd('codex', 'Second opinion from Codex.'),
      'qa/SKILL.md': skillMd('qa', 'QA with the browser.'),
      'ship/SKILL.md': skillMd('ship', 'Ship a release.'),
      'pair-agent/SKILL.md': skillMd('pair-agent', 'Pair over a tunnel.'),
      'newskill/SKILL.md': skillMd('newskill', 'Added upstream later.'),
    });
    chmodSync(join(root, 'bin/gstack-x'), 0o755);
    symlinkSync('review', join(root, 'connect-chrome'));
    return root;
  }

  it('mounts default and opt-in skills from the map and lists every other skill dir as not mounted', async () => {
    const manifest = await readPackManifest(gstackFixture(), 'gstack-runtime');
    expect(manifest.skills).toEqual([
      { name: 'codex', dir: 'codex', description: 'Second opinion from Codex.', optIn: true },
      { name: 'review', dir: 'review', description: 'Pre-landing review.', optIn: false },
    ]);
    expect(manifest.excluded).toEqual([
      { name: 'connect-chrome', reason: GSTACK_SKILL_MAP['connect-chrome']!.reason },
      { name: 'newskill', reason: 'unreviewed' },
      { name: 'pair-agent', reason: GSTACK_SKILL_MAP['pair-agent']!.reason },
      { name: 'qa', reason: GSTACK_BROWSER_NEEDED },
      { name: 'ship', reason: GSTACK_BROWSER_NEEDED },
    ]);
  });

  it('mounts browser skills only with browser: true, browser-opt-in ones as opt-in (PAN-4730)', async () => {
    const without = await readPackManifest(gstackFixture(), 'gstack-runtime', { browser: false });
    expect(without.skills.map((s) => s.name)).toEqual(['codex', 'review']);
    expect(without.capabilities.projectMutatingSkills).toEqual(['codex']);

    const manifest = await readPackManifest(gstackFixture(), 'gstack-runtime', { browser: true });
    expect(manifest.skills).toEqual([
      { name: 'codex', dir: 'codex', description: 'Second opinion from Codex.', optIn: true },
      { name: 'qa', dir: 'qa', description: 'QA with the browser.', optIn: false },
      { name: 'review', dir: 'review', description: 'Pre-landing review.', optIn: false },
      { name: 'ship', dir: 'ship', description: 'Ship a release.', optIn: true },
    ]);
    expect(manifest.excluded).toEqual([
      { name: 'connect-chrome', reason: GSTACK_SKILL_MAP['connect-chrome']!.reason },
      { name: 'newskill', reason: 'unreviewed' },
      { name: 'pair-agent', reason: GSTACK_SKILL_MAP['pair-agent']!.reason },
    ]);
    expect(manifest.capabilities.projectMutatingSkills).toEqual(['codex', 'ship']);
  });

  it('lists every runtime executable outside .git, test and node_modules, and requires bun', async () => {
    const { capabilities } = await readPackManifest(gstackFixture(), 'gstack-runtime');
    expect(capabilities.executables).toEqual(['bin/gstack-x', 'review/bin/helper.sh', 'scripts/pack-render.sh']);
    expect(capabilities).toMatchObject({ hooks: true, runtime: true, requiresCli: ['bun'], projectMutatingSkills: ['codex'] });
  });

  it('does not label runtime executables as not applied', async () => {
    const { capabilities } = await readPackManifest(gstackFixture(), 'gstack-runtime');
    const labels = notAppliedLabels(capabilities);
    expect(labels.some((label) => label.startsWith('executables'))).toBe(false);
    expect(labels).toContain('requires CLI (bun)');
  });
});

describe('KNOWN_PACKS', () => {
  it('registers gstack as the eltmon fork with the runtime adapter', () => {
    expect(KNOWN_PACKS['gstack']).toEqual({
      id: 'gstack',
      url: 'https://github.com/eltmon/gstack',
      adapter: 'gstack-runtime',
      optIn: GSTACK_OPT_IN_SKILLS,
      disclosure: GSTACK_DISCLOSURE,
    });
  });

  it('points deft at the eltmon/directive fork with the deft-readonly adapter', () => {
    expect(KNOWN_PACKS['deft']).toEqual({
      id: 'deft',
      url: 'https://github.com/eltmon/directive',
      adapter: 'deft-readonly',
    });
  });

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
      ref: '0e6c7e2df8fd89638a2d40db08cc45d4cff05fdc',
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
    expect(KNOWN_PACKS['sageox']?.ref).toMatch(/^[0-9a-f]{40}$/);
  });

  it('points pstack at the eltmon/plugins fork, pinned, with the Claude Code build as plugin root', () => {
    expect(KNOWN_PACKS['pstack']).toEqual({
      id: 'pstack',
      url: 'https://github.com/eltmon/plugins',
      ref: 'ae5650febf4320793844c12c4adaa937f417f8da',
      adapter: 'claude-plugin',
      pluginRoot: 'harness/pstack/claude-code',
      mountExtras: ['docs', 'README.md'],
      optIn: [
        'automate-me',
        'create-formal-verification-skill',
        'create-verification-skill',
        'maintain-verification-skill',
        'make-bot-ui',
        'reflect',
        'setup-pstack',
      ],
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
