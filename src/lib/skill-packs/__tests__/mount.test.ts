/**
 * PAN-4334 WI-5/6/7: content-addressed pack mounts, the Claude plugin link,
 * the Codex config block and plugin cache, and mount garbage collection, against real files under a temp
 * OVERDECK_HOME.
 */
import {
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
const beta = (): MountPack => ({ id: 'beta', commit: COMMIT_B, root: rootB, skills: [{ name: 'three', dir: 'skills/three' }] });

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

  it('rejects skill dirs that escape the pack', async () => {
    await expect(buildMount({ packs: [{ ...alpha(), skills: [{ name: 'one', dir: '../beta/skills/three' }] }] })).rejects.toThrow(
      /escapes pack/,
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
