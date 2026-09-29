/**
 * PAN-4334 WI-5: content-addressed pack mounts and the Claude plugin link,
 * against real files under a temp OVERDECK_HOME.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

import { buildMount, CODEX_PACK_MARKETPLACE, linkClaudeMount, mountHash, mountsDir, type MountPack } from '../mount.js';

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
