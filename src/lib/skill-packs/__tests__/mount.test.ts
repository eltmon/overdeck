/**
 * PAN-4334 WI-5/6/7: content-addressed pack mounts, the Claude plugin link,
 * the Codex config block and plugin cache, and mount garbage collection, against real files under a temp
 * OVERDECK_HOME.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pack-mount-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import {
  buildMount,
  CODEX_PACK_BLOCK_BEGIN,
  CODEX_PACK_MARKETPLACE,
  gcMounts,
  linkClaudeMount,
  mountHash,
  mountsDir,
  MOUNT_RENDER_ROOT_FILE,
  removePackFromMounts,
  renderRootsUsedBy,
  writeCodexPackBlock,
  type MountPack,
} from '../mount.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const scratch = mkdtempSync(join(tmpdir(), 'skill-pack-mount-src-'));

function packRoot(id: string, skills: string[]): string {
  const root = join(scratch, id);
  for (const name of skills) {
    mkdirSync(join(root, 'skills', name, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}.\n---\n`);
    writeFileSync(join(root, 'skills', name, 'scripts', 'run.sh'), 'echo hi\n');
  }
  return root;
}

const rootA = packRoot('alpha', ['one', 'two']);
const rootB = packRoot('beta', ['three']);
writeFileSync(join(scratch, 'secret.txt'), 'host file\n');
symlinkSync(join(scratch, 'secret.txt'), join(rootA, 'skills', 'one', 'leak.txt'));

const alpha = (skills = ['one', 'two']): MountPack => ({
  id: 'alpha',
  commit: COMMIT_A,
  root: rootA,
  skills: skills.map((name) => ({ name, dir: `skills/${name}` })),
});
const COMMIT_D = 'd'.repeat(40);
const rootDeft = join(scratch, 'deft');
mkdirSync(join(rootDeft, 'content', 'skills', 'deft-directive-glossary'), { recursive: true });
writeFileSync(
  join(rootDeft, 'content', 'skills', 'deft-directive-glossary', 'SKILL.md'),
  '---\nname: deft-directive-glossary\ndescription: >-\n  Build a glossary.\ntriggers:\n  - glossary\n---\n# Deft Glossary\n',
);
const deft = (): MountPack => ({
  id: 'deft',
  commit: COMMIT_D,
  root: rootDeft,
  transform: 'deft-readonly',
  skills: [{ name: 'glossary', dir: 'content/skills/deft-directive-glossary' }],
});
const beta = (): MountPack => ({ id: 'beta', commit: COMMIT_B, root: rootB, skills: [{ name: 'three', dir: 'skills/three' }] });
const COMMIT_G = 'c'.repeat(40);
const rootGstack = join(scratch, 'gstack-render');
mkdirSync(join(rootGstack, 'review'), { recursive: true });
const GSTACK_REVIEW_MD = `---\nname: review\ndescription: Review.\n---\nRun ${rootGstack}/bin/gstack-skill-start --skill "review"\n`;
writeFileSync(join(rootGstack, 'review', 'SKILL.md'), GSTACK_REVIEW_MD);
const gstack = (): MountPack => ({
  id: 'gstack',
  commit: COMMIT_G,
  root: rootGstack,
  transform: 'gstack-runtime',
  skills: [{ name: 'review', dir: 'review' }],
});

const COMMIT_P = 'c'.repeat(40);
const rootP = join(scratch, 'p');
mkdirSync(join(rootP, 'harness', 'p', 'claude-code', 'skills', 'a'), { recursive: true });
writeFileSync(join(rootP, 'harness', 'p', 'claude-code', 'skills', 'a', 'SKILL.md'), '---\nname: a\ndescription: A.\n---\n');
mkdirSync(join(rootP, 'harness', 'p', 'claude-code', 'docs', 'harness'), { recursive: true });
writeFileSync(join(rootP, 'harness', 'p', 'claude-code', 'docs', 'harness', 'claude-code.md'), '# Adapter\n');
writeFileSync(join(rootP, 'harness', 'p', 'claude-code', 'README.md'), '# p\n');
const pWithExtras = (extras: string[] = ['docs', 'README.md']): MountPack => ({
  id: 'p',
  commit: COMMIT_P,
  root: rootP,
  pluginRoot: 'harness/p/claude-code',
  skills: [{ name: 'a', dir: 'harness/p/claude-code/skills/a' }],
  extras,
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stats = lstatSync(path);
    return stats.isDirectory() ? [path, ...walk(path)] : [path];
  });
}

beforeEach(() => {
  rmSync(mountsDir(), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('buildMount', () => {
  it('is content-addressed regardless of pack order and reuses an existing mount', async () => {
    const first = await buildMount({ packs: [alpha(), beta()] });
    const second = await buildMount({ packs: [beta(), alpha()] });
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.path).toBe(join(mountsDir(), first?.hash ?? ''));
    expect(first?.packIds).toEqual(['alpha', 'beta']);
    expect(readdirSync(mountsDir())).toEqual([first?.hash]);
  });

  it('changes the hash when the skill set changes', () => {
    expect(mountHash({ packs: [alpha(['one'])] })).not.toBe(mountHash({ packs: [alpha()] }));
    expect(mountHash({ packs: [alpha()] })).not.toBe(mountHash({ packs: [{ ...alpha(), commit: COMMIT_B }] }));
  });

  it('returns null when no skill is selected', async () => {
    expect(await buildMount({ packs: [] })).toBeNull();
    expect(await buildMount({ packs: [alpha([])] })).toBeNull();
    expect(existsSync(mountsDir())).toBe(false);
  });

  it('writes both plugin manifests and the Codex marketplace', async () => {
    const mount = await buildMount({ packs: [alpha()] });
    if (!mount) throw new Error('expected a mount');
    const claude = JSON.parse(readFileSync(join(mount.path, 'plugins', 'alpha', '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(claude).toEqual({
      name: 'alpha',
      version: mount.hash,
      description: `Overdeck skill pack alpha @ ${COMMIT_A.slice(0, 12)}`,
      skills: ['./skills/one', './skills/two'],
    });
    const codex = JSON.parse(readFileSync(join(mount.path, 'plugins', 'alpha', '.codex-plugin', 'plugin.json'), 'utf8'));
    expect(codex).toMatchObject({ name: 'alpha', version: mount.hash, skills: './skills/' });
    const marketplace = JSON.parse(readFileSync(join(mount.path, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
    expect(marketplace).toEqual({
      name: CODEX_PACK_MARKETPLACE,
      plugins: [{ name: 'alpha', source: { source: 'local', path: './plugins/alpha' } }],
    });
    expect(readFileSync(join(mount.path, 'plugins', 'alpha', 'skills', 'one', 'scripts', 'run.sh'), 'utf8')).toBe('echo hi\n');
  });

  it('never copies symlinks', async () => {
    const mount = await buildMount({ packs: [alpha()] });
    if (!mount) throw new Error('expected a mount');
    const entries = walk(mount.path);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((path) => lstatSync(path).isSymbolicLink())).toEqual([]);
    expect(existsSync(join(mount.path, 'plugins', 'alpha', 'skills', 'one', 'leak.txt'))).toBe(false);
  });

  it('rewrites Deft SKILL.md copies and keeps other packs byte-for-byte', async () => {
    const mount = await buildMount({ packs: [deft(), alpha()] });
    if (!mount) throw new Error('expected a mount');
    const glossary = readFileSync(join(mount.path, 'plugins', 'deft', 'skills', 'glossary', 'SKILL.md'), 'utf8');
    expect(glossary).toMatch(/^---\nname: glossary\n/);
    expect(glossary).toContain('<!-- overdeck:deft-host-notice v1 -->');
    expect(glossary).toContain('# Deft Glossary');
    expect(readFileSync(join(mount.path, 'plugins', 'alpha', 'skills', 'one', 'SKILL.md'), 'utf8')).toBe(
      readFileSync(join(rootA, 'skills', 'one', 'SKILL.md'), 'utf8'),
    );
    const claude = JSON.parse(readFileSync(join(mount.path, 'plugins', 'deft', '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(claude.skills).toEqual(['./skills/glossary']);
  });

  it('covers the transform in the hash', () => {
    const { transform: _transform, ...plain } = deft();
    expect(mountHash({ packs: [deft()] })).not.toBe(mountHash({ packs: [plain] }));
  });

  it('mounts gstack-runtime skills verbatim from the render root', async () => {
    const mount = await buildMount({ packs: [gstack()] });
    if (!mount) throw new Error('expected a mount');
    expect(readFileSync(join(mount.path, 'plugins', 'gstack', 'skills', 'review', 'SKILL.md'), 'utf8')).toBe(GSTACK_REVIEW_MD);
  });

  it('records the render root in a gstack mount and touches the render on build and reuse', async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(rootGstack, old, old);
    const mount = await buildMount({ packs: [gstack(), alpha()] });
    if (!mount) throw new Error('expected a mount');
    expect(readFileSync(join(mount.path, 'plugins', 'gstack', MOUNT_RENDER_ROOT_FILE), 'utf8')).toBe(`${rootGstack}\n`);
    expect(existsSync(join(mount.path, 'plugins', 'alpha', MOUNT_RENDER_ROOT_FILE))).toBe(false);
    expect(statSync(rootGstack).mtimeMs).toBeGreaterThan(old.getTime() + 1000);
    expect(await renderRootsUsedBy([mount.path])).toEqual(new Set([rootGstack]));
    utimesSync(rootGstack, old, old);
    await buildMount({ packs: [gstack(), alpha()] });
    expect(statSync(rootGstack).mtimeMs).toBeGreaterThan(old.getTime() + 1000);
  });

  it('covers the gstack-runtime transform and its render version in the hash', async () => {
    const { transform: _transform, ...plain } = gstack();
    const hash = mountHash({ packs: [gstack()] });
    expect(hash).not.toBe(mountHash({ packs: [plain] }));
    vi.resetModules();
    vi.doMock('../gstack.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../gstack.js')>()),
      GSTACK_RENDER_VERSION: 99,
    }));
    try {
      const fresh = await import('../mount.js');
      expect(fresh.mountHash({ packs: [gstack()] })).not.toBe(hash);
    } finally {
      vi.doUnmock('../gstack.js');
      vi.resetModules();
    }
  });

  it('rejects an unknown transform', async () => {
    await expect(buildMount({ packs: [{ ...deft(), transform: 'other' as 'deft-readonly' }] })).rejects.toThrow(
      /invalid pack transform/,
    );
  });

  it('rejects skill dirs that escape the pack', async () => {
    await expect(buildMount({ packs: [{ ...alpha(), skills: [{ name: 'one', dir: '../beta/skills/three' }] }] })).rejects.toThrow(
      /escapes pack/,
    );
  });

  it('copies extras from the plugin root next to skills', async () => {
    const mount = await buildMount({ packs: [pWithExtras(['docs', 'README.md', 'missing'])] });
    if (!mount) throw new Error('expected a mount');
    expect(readFileSync(join(mount.path, 'plugins', 'p', 'docs', 'harness', 'claude-code.md'), 'utf8')).toBe('# Adapter\n');
    expect(readFileSync(join(mount.path, 'plugins', 'p', 'README.md'), 'utf8')).toBe('# p\n');
    expect(existsSync(join(mount.path, 'plugins', 'p', 'missing'))).toBe(false);
    expect(existsSync(join(mount.path, 'plugins', 'p', 'skills', 'a', 'SKILL.md'))).toBe(true);
  });

  it('covers extras in the hash and leaves extra-free hashes unchanged', () => {
    const withExtras = pWithExtras(['docs']);
    const { extras: _extras, ...noExtrasField } = withExtras;
    expect(mountHash({ packs: [withExtras] })).not.toBe(mountHash({ packs: [noExtrasField] }));
    expect(mountHash({ packs: [pWithExtras([])] })).toBe(mountHash({ packs: [noExtrasField] }));
  });

  it('rejects extras that escape or collide', async () => {
    await expect(buildMount({ packs: [pWithExtras(['../x'])] })).rejects.toThrow(/escapes pack/);
    await expect(buildMount({ packs: [pWithExtras(['skills'])] })).rejects.toThrow(/collides with generated content/);
    await expect(buildMount({ packs: [pWithExtras(['.claude-plugin/plugin.json'])] })).rejects.toThrow(
      /collides with generated content/,
    );
  });
});

describe('linkClaudeMount', () => {
  const link = join(overdeckHome, 'launch', 'agent-1', 'skill-packs');

  it('links to the mount plugins, replaces the target, and removes the link for null', async () => {
    const first = await buildMount({ packs: [alpha()] });
    const second = await buildMount({ packs: [beta()] });
    await linkClaudeMount(link, first);
    expect(readlinkSync(link)).toBe(join(first?.path ?? '', 'plugins'));
    await linkClaudeMount(link, second);
    expect(readlinkSync(link)).toBe(join(second?.path ?? '', 'plugins'));
    expect(existsSync(join(link, 'beta', '.claude-plugin', 'plugin.json'))).toBe(true);
    await linkClaudeMount(link, null);
    expect(() => lstatSync(link)).toThrow();
    await linkClaudeMount(link, null);
  });
});

describe('writeCodexPackBlock', () => {
  const codexHome = join(overdeckHome, 'agents', 'agent-1', 'codex');
  const configToml = join(codexHome, 'config.toml');
  const cacheRoot = join(codexHome, 'plugins', 'cache', CODEX_PACK_MARKETPLACE);
  const skillBlock = [
    'model = "gpt-5.5"',
    '',
    '# overdeck:skill-overrides:begin',
    '[[skills.config]]',
    'name = "grilling"',
    'enabled = false',
    '# overdeck:skill-overrides:end',
  ].join('\n');

  beforeEach(() => {
    rmSync(codexHome, { recursive: true, force: true });
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(configToml, `${skillBlock}\n`);
  });

  it('appends the pack block after the skill-override block and copies the plugin', async () => {
    const mount = await buildMount({ packs: [alpha(), beta()] });
    if (!mount) throw new Error('expected a mount');
    await writeCodexPackBlock(codexHome, mount);
    expect(readFileSync(configToml, 'utf8')).toBe(
      [
        skillBlock,
        '',
        CODEX_PACK_BLOCK_BEGIN,
        '[marketplaces.overdeck-packs]',
        'source_type = "local"',
        `source = "${mount.path}"`,
        '',
        '[plugins."alpha@overdeck-packs"]',
        'enabled = true',
        '',
        '[plugins."beta@overdeck-packs"]',
        'enabled = true',
        '# overdeck:skill-packs:end',
        '',
      ].join('\n'),
    );
    expect(statSync(configToml).mode & 0o777).toBe(0o600);
    expect(existsSync(join(cacheRoot, 'alpha', mount.hash, 'skills', 'one', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(cacheRoot, 'beta', mount.hash, '.codex-plugin', 'plugin.json'))).toBe(true);
  });

  it('is byte-identical when repeated with the same mount', async () => {
    const mount = await buildMount({ packs: [alpha()] });
    await writeCodexPackBlock(codexHome, mount);
    const once = readFileSync(configToml, 'utf8');
    await writeCodexPackBlock(codexHome, mount);
    expect(readFileSync(configToml, 'utf8')).toBe(once);
  });

  it('replaces the block for a new mount and prunes old cache entries', async () => {
    const first = await buildMount({ packs: [alpha(), beta()] });
    const second = await buildMount({ packs: [alpha(['one'])] });
    if (!first || !second) throw new Error('expected mounts');
    await writeCodexPackBlock(codexHome, first);
    await writeCodexPackBlock(codexHome, second);
    const text = readFileSync(configToml, 'utf8');
    expect(text.split(CODEX_PACK_BLOCK_BEGIN)).toHaveLength(2);
    expect(text).toContain(`source = "${second.path}"`);
    expect(text).not.toContain('beta@overdeck-packs');
    expect(readdirSync(cacheRoot)).toEqual(['alpha']);
    expect(readdirSync(join(cacheRoot, 'alpha'))).toEqual([second.hash]);
  });

  it('removes the block and the cache for a null mount', async () => {
    await writeCodexPackBlock(codexHome, await buildMount({ packs: [alpha()] }));
    await writeCodexPackBlock(codexHome, null);
    expect(readFileSync(configToml, 'utf8')).toBe(`${skillBlock}\n`);
    expect(existsSync(cacheRoot)).toBe(false);
    expect(statSync(configToml).mode & 0o777).toBe(0o600);
  });
});

describe('gcMounts', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-28T12:00:00Z');
  const launchRoot = join(overdeckHome, 'launch');
  const age = (path: string, days: number): void => {
    const when = new Date(now - days * DAY);
    utimesSync(path, when, when);
  };

  beforeEach(() => {
    rmSync(launchRoot, { recursive: true, force: true });
  });

  it('removes old unreferenced mounts, stray temp dirs and dangling links only', async () => {
    const referenced = await buildMount({ packs: [alpha()] });
    const oldUnused = await buildMount({ packs: [beta()] });
    const freshUnused = await buildMount({ packs: [alpha(['one'])] });
    if (!referenced || !oldUnused || !freshUnused) throw new Error('expected mounts');
    await linkClaudeMount(join(launchRoot, 'live', 'skill-packs'), referenced);
    const danglingLink = join(launchRoot, 'gone', 'skill-packs');
    mkdirSync(join(launchRoot, 'gone'), { recursive: true });
    symlinkSync(join(mountsDir(), 'missing', 'plugins'), danglingLink);
    const staleTmp = join(mountsDir(), '.tmp-stale');
    mkdirSync(staleTmp);
    age(referenced.path, 30);
    age(oldUnused.path, 30);
    age(freshUnused.path, 1);
    age(staleTmp, 30);

    const result = await gcMounts({ maxAgeMs: 7 * DAY, now });
    expect(result.removedLinks).toEqual([danglingLink]);
    expect(result.referencedMounts).toEqual([referenced.path]);
    expect(result.removedMounts.sort()).toEqual([oldUnused.path, staleTmp].sort());
    expect(existsSync(referenced.path)).toBe(true);
    expect(existsSync(freshUnused.path)).toBe(true);
    expect(existsSync(oldUnused.path)).toBe(false);
    expect(() => lstatSync(danglingLink)).toThrow();
  });

  it('touches a reused mount so it stays young', async () => {
    const mount = await buildMount({ packs: [alpha()] });
    if (!mount) throw new Error('expected a mount');
    age(mount.path, 30);
    await buildMount({ packs: [alpha()] });
    const result = await gcMounts({ maxAgeMs: 7 * DAY, now: Date.now() });
    expect(result.removedMounts).toEqual([]);
    expect(existsSync(mount.path)).toBe(true);
  });
});

describe('removePackFromMounts (PAN-4727)', () => {
  const launchRoot = join(overdeckHome, 'launch');
  const agentsRoot = join(overdeckHome, 'agents');

  beforeEach(() => {
    rmSync(launchRoot, { recursive: true, force: true });
    rmSync(agentsRoot, { recursive: true, force: true });
  });

  it('removes mounts holding the pack, the links they leave dangling and its Codex caches', async () => {
    const withGstack = await buildMount({ packs: [gstack(), alpha()] });
    const without = await buildMount({ packs: [alpha()] });
    if (!withGstack || !without) throw new Error('expected mounts');
    const gstackLink = join(launchRoot, 'a1', 'skill-packs');
    const alphaLink = join(launchRoot, 'a2', 'skill-packs');
    await linkClaudeMount(gstackLink, withGstack);
    await linkClaudeMount(alphaLink, without);
    const cache = (agent: string, home: string, id: string) =>
      join(agentsRoot, agent, home, 'plugins', 'cache', CODEX_PACK_MARKETPLACE, id);
    for (const dir of [cache('x', 'codex-home-v2', 'gstack'), cache('x', 'codex-home-v2', 'alpha'), cache('y', 'codex-home', 'gstack')]) {
      mkdirSync(dir, { recursive: true });
    }

    const result = await removePackFromMounts('gstack');
    expect(result.removedMounts).toEqual([withGstack.path]);
    expect(result.removedLinks).toEqual([gstackLink]);
    expect(result.removedCodexCaches.sort()).toEqual([cache('x', 'codex-home-v2', 'gstack'), cache('y', 'codex-home', 'gstack')].sort());
    expect(existsSync(withGstack.path)).toBe(false);
    expect(existsSync(without.path)).toBe(true);
    expect(() => lstatSync(gstackLink)).toThrow();
    expect(readlinkSync(alphaLink)).toBe(join(without.path, 'plugins'));
    expect(existsSync(cache('x', 'codex-home-v2', 'alpha'))).toBe(true);
  });

  it('keeps sweeping after a mount it cannot remove and reports the failure', async () => {
    const stuck = await buildMount({ packs: [gstack()] });
    if (!stuck) throw new Error('expected a mount');
    const cache = join(agentsRoot, 'x', 'codex-home', 'plugins', 'cache', CODEX_PACK_MARKETPLACE, 'gstack');
    mkdirSync(cache, { recursive: true });
    chmodSync(mountsDir(), 0o555);
    try {
      const result = await removePackFromMounts('gstack');
      expect(result.removedMounts).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toContain(stuck.path);
      expect(result.removedCodexCaches).toEqual([cache]);
    } finally {
      chmodSync(mountsDir(), 0o755);
    }
    expect(existsSync(stuck.path)).toBe(true);
  });

  it('rejects an invalid pack id', async () => {
    await expect(removePackFromMounts('../x')).rejects.toThrow(/invalid pack id/);
  });
});
