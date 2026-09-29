/**
 * PAN-4334 WI-2/3/4: the pack registry in config.yaml, the pack cache paths,
 * the git cache and the add/update/remove/sync lifecycle, against real files under a temp OVERDECK_HOME and a
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
  addPack,
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
  PackSourceError,
  removePack,
  resolveRef,
  syncPack,
  treeHash,
  updatePack,
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

interface Upstream {
  scratch: string;
  url: string;
  commitFile: (path: string, content: string, message: string) => string;
  tag: (name: string, commit: string) => void;
}

/** A local bare repo on branch main, pushed to from a scratch working copy. */
function createUpstream(): Upstream {
  const scratch = mkdtempSync(join(tmpdir(), 'skill-pack-upstream-'));
  const work = join(scratch, 'work');
  const url = join(scratch, 'upstream.git');
  const run = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: work,
      encoding: 'utf8',
    }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', url]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  run('remote', 'add', 'origin', url);
  return {
    scratch,
    url,
    commitFile: (path, content, message) => {
      mkdirSync(join(work, path, '..'), { recursive: true });
      writeFileSync(join(work, path), content);
      run('add', '-A');
      run('commit', '-q', '-m', message);
      run('push', '-q', 'origin', 'main');
      return run('rev-parse', 'HEAD');
    },
    tag: (name, commit) => {
      run('tag', '-a', name, '-m', name, commit);
      run('push', '-q', 'origin', '--tags');
    },
  };
}

const skillMd = (name: string): string => `---\nname: ${name}\ndescription: ${name}.\n---\n`;

describe('pack git cache', () => {
  let up: Upstream;
  let upstream = '';
  let scratch = '';
  let first = '';
  let second = '';

  beforeAll(() => {
    up = createUpstream();
    upstream = up.url;
    scratch = up.scratch;
    first = up.commitFile('skills/a/SKILL.md', skillMd('a'), 'first');
    second = up.commitFile('skills/b/SKILL.md', skillMd('b'), 'second');
    up.tag('v1', first);
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
    const third = up.commitFile('skills/c/SKILL.md', skillMd('c'), 'third');
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

describe('pack lifecycle', () => {
  let up: Upstream;
  let first = '';
  const accept = vi.fn(async () => true);
  const decline = vi.fn(async () => false);

  beforeAll(() => {
    up = createUpstream();
    up.commitFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'demo', skills: ['./skills/a'] }), 'plugin');
    first = up.commitFile('skills/a/SKILL.md', skillMd('a'), 'first');
    up.tag('v1', first);
  });

  afterAll(() => {
    rmSync(up.scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(packsHome(), { recursive: true, force: true });
    accept.mockClear();
    decline.mockClear();
  });

  it('writes nothing when the preview is declined', async () => {
    writeFileSync(configPath(), '# keep me\nmodels:\n  default: sonnet\n');
    const before = readFileSync(configPath(), 'utf8');
    const result = await addPack({ id: 'demo', url: up.url, ref: 'v1' }, decline);
    expect(result.written).toBe(false);
    expect(result.preview).toMatchObject({ id: 'demo', commit: first, adapter: 'claude-plugin' });
    expect(result.preview.manifest.skills.map((skill) => skill.name)).toEqual(['a']);
    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });

  it('registers the resolved commit when confirmed and keeps comments', async () => {
    writeFileSync(configPath(), '# keep me\n');
    const result = await addPack({ id: 'demo', url: up.url, ref: 'v1' }, accept);
    expect(result.written).toBe(true);
    expect(accept).toHaveBeenCalledOnce();
    expect(readFileSync(configPath(), 'utf8')).toContain('# keep me');
    expect(await getPack('demo')).toEqual({ id: 'demo', url: up.url, ref: 'v1', commit: first });
  });

  it('refuses integrations, reserved, invalid and registered ids before any git call', async () => {
    await expect(addPack({ id: 'sageox', url: up.url, ref: 'main' }, accept)).rejects.toMatchObject({
      code: 'integration',
      message: expect.stringContaining('issues/2444'),
    });
    await expect(addPack({ id: 'grilling', url: up.url, ref: 'main', reservedIds: ['grilling'] }, accept)).rejects.toMatchObject({
      code: 'bad-id',
    });
    await expect(addPack({ id: '../x', url: up.url, ref: 'main' }, accept)).rejects.toBeInstanceOf(PackSourceError);
    await writePackEntry({ id: 'demo', url: up.url, ref: 'v1', commit: first });
    await expect(addPack({ id: 'demo', url: up.url, ref: 'v1' }, accept)).rejects.toMatchObject({ code: 'exists' });
    expect(existsSync(packsHome())).toBe(false);
    expect(accept).not.toHaveBeenCalled();
  });

  it('reports git failures as PackSourceError git', async () => {
    await expect(addPack({ id: 'demo', url: join(up.scratch, 'missing.git'), ref: 'main' }, accept)).rejects.toMatchObject({
      code: 'git',
    });
  });

  it('updates only when confirmed and previews the added skill', async () => {
    await writePackEntry({ id: 'demo', url: up.url, ref: 'main', commit: first });
    up.commitFile('.claude-plugin/plugin.json', JSON.stringify({ name: 'demo', skills: ['./skills/a', './skills/b'] }), 'list b');
    up.commitFile('skills/a/SKILL.md', `${skillMd('a')}\nChanged.\n`, 'change a');
    const next = up.commitFile('skills/b/SKILL.md', skillMd('b'), 'add b');

    const declined = await updatePack('demo', {}, decline);
    expect(declined.written).toBe(false);
    expect(declined.preview.previousCommit).toBe(first);
    expect(declined.preview.diff).toEqual({ added: ['b'], removed: [], changed: ['a'], newCapabilities: [] });
    expect((await getPack('demo'))?.commit).toBe(first);

    const confirmed = await updatePack('demo', {}, accept);
    expect(confirmed.written).toBe(true);
    expect((await getPack('demo'))?.commit).toBe(next);

    accept.mockClear();
    expect((await updatePack('demo', {}, accept)).written).toBe(false);
    expect(accept).not.toHaveBeenCalled();
  });

  it('moves to a new ref when one is given', async () => {
    const head = up.commitFile('skills/a/notes.md', 'notes\n', 'notes');
    await writePackEntry({ id: 'demo', url: up.url, ref: 'main', commit: head });
    const result = await updatePack('demo', { ref: 'v1' }, accept);
    expect(result.written).toBe(true);
    expect(await getPack('demo')).toMatchObject({ ref: 'v1', commit: first });
  });

  it('rejects unknown packs on update and sync', async () => {
    await expect(updatePack('nope', {}, accept)).rejects.toMatchObject({ code: 'unknown-pack' });
    await expect(syncPack('nope')).rejects.toMatchObject({ code: 'unknown-pack' });
  });

  it('syncs the trusted commit into a fresh cache', async () => {
    await writePackEntry({ id: 'demo', url: up.url, ref: 'v1', commit: first });
    const result = await syncPack('demo');
    expect(result).toEqual({ commit: first, dir: packExtractDir('demo', first) });
    expect(existsSync(join(result.dir, 'skills', 'a', 'SKILL.md'))).toBe(true);
  });

  it('removes the registry entry, global overrides and the cache', async () => {
    writeFileSync(configPath(), 'skills:\n  overrides:\n    grilling: false\n    demo/a: true\n  pack_overrides:\n    demo: true\n');
    await writePackEntry({ id: 'demo', url: up.url, ref: 'v1', commit: first });
    await syncPack('demo');
    expect(await removePack('demo')).toEqual({ removed: true });
    expect(readConfig().skills).toEqual({ overrides: { grilling: false } });
    expect(existsSync(packCacheDir('demo'))).toBe(false);
    expect(await removePack('demo')).toEqual({ removed: false });
  });
});
