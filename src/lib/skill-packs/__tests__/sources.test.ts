/**
 * PAN-4334 WI-2/WI-3: the pack registry in config.yaml, the pack cache paths,
 * and the git cache, against real files under a temp OVERDECK_HOME and a
 * local bare repo (no network).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pack-sources-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { getGlobalConfigPath } from '../../config-yaml/load.js';
import {
  deletePackEntry,
  extractCommit,
  fetchPackSource,
  getPack,
  listPacks,
  packCacheDir,
  packExtractDir,
  packRepoDir,
  packsHome,
  packUpdateAvailable,
  resolveRef,
  treeHash,
  writePackEntry,
} from '../sources.js';

const COMMIT = 'a'.repeat(40);
const configPath = (): string => getGlobalConfigPath();
interface ConfigShape {
  models?: unknown;
  skills?: { packs?: Record<string, { commit?: string }> } & Record<string, unknown>;
}
const readConfig = (): ConfigShape => parseYaml(readFileSync(configPath(), 'utf8')) as ConfigShape;

beforeEach(() => {
  mkdirSync(overdeckHome, { recursive: true });
  rmSync(configPath(), { force: true });
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('pack registry', () => {
  it('round-trips a written entry', async () => {
    await writePackEntry({ id: 'mattpocock', url: 'https://github.com/mattpocock/skills', ref: 'v1.2.3', commit: COMMIT });
    expect(await listPacks()).toEqual([
      { id: 'mattpocock', url: 'https://github.com/mattpocock/skills', ref: 'v1.2.3', commit: COMMIT },
    ]);
    expect(await getPack('mattpocock')).toMatchObject({ ref: 'v1.2.3' });
    expect(await getPack('missing')).toBeNull();
  });

  it('stores adapter only when given', async () => {
    await writePackEntry({ id: 'p', url: 'u', ref: 'main', commit: COMMIT, adapter: 'plain' });
    expect(readConfig().skills?.packs?.['p']).toEqual({ url: 'u', ref: 'main', commit: COMMIT, adapter: 'plain' });
  });

  it('preserves comments and unrelated keys', async () => {
    writeFileSync(configPath(), '# keep me\nmodels:\n  default: sonnet\n');
    await writePackEntry({ id: 'mattpocock', url: 'u', ref: 'v1', commit: COMMIT });
    const text = readFileSync(configPath(), 'utf8');
    expect(text).toContain('# keep me');
    expect(readConfig().models).toEqual({ default: 'sonnet' });
    expect(readConfig().skills?.packs?.['mattpocock']?.commit).toBe(COMMIT);
  });

  it('delete removes the entry, its pack toggle and its skill overrides only', async () => {
    writeFileSync(
      configPath(),
      [
        'skills:',
        '  overrides:',
        '    grilling: false',
        '    mattpocock/tdd: false',
        '    mattpocock/grilling: true',
        '  pack_overrides:',
        '    mattpocock: true',
        '  packs:',
        '    mattpocock:',
        '      url: u',
        '      ref: v1',
        `      commit: ${COMMIT}`,
        '',
      ].join('\n'),
    );
    await deletePackEntry('mattpocock');
    expect(readConfig().skills).toEqual({ overrides: { grilling: false } });
    expect(await listPacks()).toEqual([]);
  });

  it('skips malformed entries', async () => {
    writeFileSync(
      configPath(),
      `skills:\n  packs:\n    good: { url: u, ref: r, commit: ${COMMIT} }\n    short: { url: u, ref: r, commit: abc }\n    Bad_Id: { url: u, ref: r, commit: ${COMMIT} }\n`,
    );
    expect((await listPacks()).map((entry) => entry.id)).toEqual(['good']);
  });

  it('rejects bad ids and commits on write', async () => {
    await expect(writePackEntry({ id: '../x', url: 'u', ref: 'r', commit: COMMIT })).rejects.toThrow(/invalid pack id/);
    await expect(writePackEntry({ id: 'x', url: 'u', ref: 'r', commit: 'main' })).rejects.toThrow(/invalid pack commit/);
    await expect(deletePackEntry('../x')).rejects.toThrow(/invalid pack id/);
  });
});

describe('pack cache paths', () => {
  it('lives under OVERDECK_HOME/packs', () => {
    expect(packsHome()).toBe(join(overdeckHome, 'packs'));
    expect(packRepoDir('mattpocock')).toBe(join(overdeckHome, 'packs', 'mattpocock', 'repo.git'));
    expect(packExtractDir('mattpocock', COMMIT)).toBe(join(overdeckHome, 'packs', 'mattpocock', COMMIT));
  });

  it('throws on ids and commits that could escape the cache', () => {
    expect(() => packCacheDir('../x')).toThrow(/invalid pack id/);
    expect(() => packCacheDir('')).toThrow(/invalid pack id/);
    expect(() => packExtractDir('mattpocock', '../../etc')).toThrow(/invalid pack commit/);
  });
});

describe('pack git cache', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'skill-pack-upstream-'));
  const work = join(scratch, 'work');
  const upstream = join(scratch, 'upstream.git');
  const run = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim();
  const commitFile = (path: string, content: string, message: string): string => {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), content);
    run(work, 'add', '-A');
    run(work, 'commit', '-q', '-m', message);
    run(work, 'push', '-q', 'origin', 'main', '--tags');
    return run(work, 'rev-parse', 'HEAD');
  };

  let first = '';
  let second = '';

  beforeAll(() => {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', upstream]);
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    run(work, 'remote', 'add', 'origin', upstream);
    first = commitFile('skills/a/SKILL.md', '---\nname: a\ndescription: A.\n---\n', 'first');
    second = commitFile('skills/b/SKILL.md', '---\nname: b\ndescription: B.\n---\n', 'second');
    run(work, 'tag', '-a', 'v1', '-m', 'v1', first);
    run(work, 'push', '-q', 'origin', '--tags');
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('clones and resolves a tag to its commit', async () => {
    await fetchPackSource('up', upstream);
    expect(existsSync(packRepoDir('up'))).toBe(true);
    expect(await resolveRef('up', 'v1')).toBe(first);
    expect(await resolveRef('up', 'main')).toBe(second);
    await expect(resolveRef('up', 'nope')).rejects.toThrow(/does not name a commit/);
  });

  it('extracts a commit once and reuses the directory', async () => {
    await fetchPackSource('up', upstream);
    const dir = await extractCommit('up', first);
    expect(dir).toBe(packExtractDir('up', first));
    expect(readFileSync(join(dir, 'skills', 'a', 'SKILL.md'), 'utf8')).toContain('name: a');
    expect(existsSync(join(dir, 'skills', 'b'))).toBe(false);
    const inode = statSync(dir).ino;
    expect(await extractCommit('up', first)).toBe(dir);
    expect(statSync(dir).ino).toBe(inode);
  });

  it('reports tree hashes per path', async () => {
    await fetchPackSource('up', upstream);
    const atFirst = await treeHash('up', first, 'skills/a');
    expect(atFirst).toMatch(/^[0-9a-f]{40}$/);
    expect(await treeHash('up', second, 'skills/a')).toBe(atFirst);
    expect(await treeHash('up', first, 'skills/b')).toBeNull();
  });

  it('fetches new upstream commits and reports them as updates', async () => {
    await fetchPackSource('up', upstream);
    const third = commitFile('skills/c/SKILL.md', '---\nname: c\ndescription: C.\n---\n', 'third');
    const entry = { id: 'up', url: upstream, ref: 'main', commit: second };
    expect(await packUpdateAvailable(entry)).toBe(third);
    expect(await packUpdateAvailable({ ...entry, commit: third })).toBeNull();
    expect(await packUpdateAvailable({ ...entry, ref: 'v1', commit: first })).toBeNull();
    expect(await packUpdateAvailable({ ...entry, ref: second })).toBeNull();
    await fetchPackSource('up', upstream);
    expect(await resolveRef('up', 'main')).toBe(third);
  });

  it('returns null for an unreachable remote', async () => {
    const entry = { id: 'up', url: join(scratch, 'missing.git'), ref: 'main', commit: second };
    expect(await packUpdateAvailable(entry)).toBeNull();
  });

  it('leaves no partial clone after a failed fetch', async () => {
    await expect(fetchPackSource('gone', join(scratch, 'missing.git'))).rejects.toThrow();
    expect(existsSync(packRepoDir('gone'))).toBe(false);
  });
});
