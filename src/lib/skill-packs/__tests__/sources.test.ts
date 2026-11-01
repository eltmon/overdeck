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
  packBrowserDir,
  packCacheDir,
  packExtractDir,
  packRenderDir,
  packRepoDir,
  packsHome,
  packStateDir,
  readPackRegistry,
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

  it('round-trips browser: true and stores it only when set (PAN-4730)', async () => {
    await writePackEntry({ id: 'gstack', url: 'u', ref: 'main', commit: COMMIT, adapter: 'gstack-runtime', browser: true });
    expect(readConfig().skills?.packs?.['gstack']).toEqual({ url: 'u', ref: 'main', commit: COMMIT, adapter: 'gstack-runtime', browser: true });
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: 'u', ref: 'main', commit: COMMIT, adapter: 'gstack-runtime', browser: true });
    await writePackEntry({ id: 'gstack', url: 'u', ref: 'main', commit: COMMIT, adapter: 'gstack-runtime' });
    expect(readConfig().skills?.packs?.['gstack']).toEqual({ url: 'u', ref: 'main', commit: COMMIT, adapter: 'gstack-runtime' });
  });

  it('ignores a browser value other than true without skipping the entry', async () => {
    writeFileSync(configPath(), `skills:\n  packs:\n    gstack: { url: u, ref: r, commit: ${COMMIT}, browser: 'yes' }\n`);
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: 'u', ref: 'r', commit: COMMIT });
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

describe('readPackRegistry (gc)', () => {
  it('reads every pack key, with null for a malformed entry', async () => {
    writeFileSync(configPath(), `skills:\n  packs:\n    gstack:\n      url: u\n      ref: main\n      commit: ${COMMIT}\n    broken:\n      url: u\n      ref: main\n      commit: not-a-sha\n`);
    const registry = await readPackRegistry();
    expect(registry.readable).toBe(true);
    expect([...registry.packs.entries()]).toEqual([['gstack', COMMIT], ['broken', null]]);
  });

  it('is unreadable when the config does not parse', async () => {
    writeFileSync(configPath(), `skills:\n  packs:\n    gstack:\n      url: u\n     ref: main\n`);
    expect(await readPackRegistry()).toEqual({ readable: false, packs: new Map() });
    expect(await listPacks()).toEqual([]);
  });

  it('is readable and empty without a config or packs', async () => {
    expect(await readPackRegistry()).toEqual({ readable: true, packs: new Map() });
    writeFileSync(configPath(), 'models:\n  default: sonnet\n');
    expect(await readPackRegistry()).toEqual({ readable: true, packs: new Map() });
  });
});

describe('pack cache paths', () => {
  it('lives under OVERDECK_HOME/packs', () => {
    expect(packsHome()).toBe(join(overdeckHome, 'packs'));
    expect(packRepoDir('mattpocock')).toBe(join(overdeckHome, 'packs', 'mattpocock', 'repo.git'));
    expect(packExtractDir('mattpocock', COMMIT)).toBe(join(overdeckHome, 'packs', 'mattpocock', COMMIT));
    expect(packBrowserDir('gstack')).toBe(join(overdeckHome, 'packs', 'gstack', 'browser'));
  });

  it('throws on ids and commits that could escape the cache', () => {
    expect(() => packCacheDir('../x')).toThrow(/invalid pack id/);
    expect(() => packCacheDir('')).toThrow(/invalid pack id/);
    expect(() => packExtractDir('mattpocock', '../../etc')).toThrow(/invalid pack commit/);
  });

  it('puts a runtime pack render per commit and its state beside the extractions', () => {
    expect(packRenderDir('gstack', COMMIT)).toBe(join(overdeckHome, 'packs', 'gstack', 'render', COMMIT));
    expect(packStateDir('gstack')).toBe(join(overdeckHome, 'packs', 'gstack', 'state'));
    expect(() => packRenderDir('gstack', '../../etc')).toThrow(/invalid pack commit/);
    expect(() => packStateDir('../x')).toThrow(/invalid pack id/);
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

describe('plugin root packs', () => {
  let up: Upstream;
  let first = '';

  beforeAll(() => {
    up = createUpstream();
    up.commitFile('harness/pstack/claude-code/.claude-plugin/plugin.json', JSON.stringify({ name: 'pstack' }), 'plugin');
    up.commitFile('harness/pstack/claude-code/skills/alpha/SKILL.md', skillMd('alpha'), 'alpha');
    up.commitFile('harness/pstack/claude-code/skills/setup-pstack/SKILL.md', skillMd('setup-pstack'), 'setup-pstack');
    first = up.commitFile('other/skills/x/SKILL.md', skillMd('x'), 'other');
    up.tag('v1', first);
  });

  afterAll(() => {
    rmSync(up.scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(packsHome(), { recursive: true, force: true });
  });

  it('addPack previews the skills under the known plugin root', async () => {
    writeFileSync(configPath(), '# keep me\n');
    const result = await addPack({ id: 'pstack', url: up.url, ref: 'v1' }, vi.fn(async () => true));
    expect(result.preview.manifest.skills.map((skill) => skill.name)).toEqual(['alpha', 'setup-pstack']);
    expect(result.preview.manifest.skills.find((skill) => skill.name === 'setup-pstack')?.optIn).toBe(true);
    expect(result.preview.pluginRoot).toBe('harness/pstack/claude-code');
  });

  it('extracts only the plugin root', async () => {
    writeFileSync(configPath(), '# keep me\n');
    const result = await addPack({ id: 'pstack', url: up.url, ref: 'v1' }, vi.fn(async () => true));
    const dir = packExtractDir('pstack', result.preview.commit);
    expect(existsSync(join(dir, 'other'))).toBe(false);
    expect(existsSync(join(dir, 'harness', 'pstack', 'claude-code', 'skills', 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('re-extracts a cached commit that lacks the plugin root', async () => {
    const dir = packExtractDir('pstack', first);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'unrelated.txt'), 'stale\n');
    await fetchPackSource('pstack', up.url);
    const extracted = await extractCommit('pstack', first, 'harness/pstack/claude-code');
    expect(existsSync(join(extracted, 'harness', 'pstack', 'claude-code', 'skills', 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('updatePack reports a changed skill by its repo-relative tree hash', async () => {
    writeFileSync(configPath(), '# keep me\n');
    await addPack({ id: 'pstack', url: up.url, ref: 'v1' }, vi.fn(async () => true));
    up.commitFile('harness/pstack/claude-code/skills/alpha/SKILL.md', `${skillMd('alpha')}\nChanged.\n`, 'change alpha');
    const next = up.commitFile('harness/pstack/claude-code/skills/alpha/notes.md', 'notes\n', 'notes');
    const result = await updatePack('pstack', { ref: 'main' }, vi.fn(async () => true));
    expect(result.preview.commit).toBe(next);
    expect(result.preview.diff).toEqual({ added: [], removed: [], changed: ['alpha'], newCapabilities: [] });
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

  it('refuses reserved, invalid and registered ids before any git call', async () => {
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
    await expect(addPack({ id: 'sageox', url: join(up.scratch, 'missing.git'), ref: 'main' }, accept)).rejects.toMatchObject({
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

describe('gstack runtime pack lifecycle', () => {
  // A fake fork: pack-mode.json, one skill, and a `setup` that does what pack mode's contract says (or fails).
  const GOOD_SETUP = [
    '#!/usr/bin/env bash',
    'set -e',
    'mkdir -p "$2" "$4"',
    'printf \'{"packMode":1,"stateRoot":"%s","version":"0.0.0"}\\n\' "$4" > "$2/.gstack-pack.json"',
    'printf \'%s\\n\' "$4" > "$2/.gstack-pack-state-root"',
  ].join('\n');
  const FAILING_SETUP = '#!/usr/bin/env bash\necho "pack mode: boom" >&2\nexit 1\n';

  let up: Upstream;
  let good = '';
  let failing = '';
  let noPackMode = '';
  const accept = vi.fn(async () => true);
  const decline = vi.fn(async () => false);

  beforeAll(() => {
    up = createUpstream();
    up.commitFile('pack-mode.json', '{"packMode": 1}\n', 'pack mode');
    up.commitFile('review/SKILL.md', skillMd('review'), 'review');
    good = up.commitFile('setup', GOOD_SETUP, 'good setup');
    failing = up.commitFile('setup', FAILING_SETUP, 'failing setup');
    up.commitFile('setup', GOOD_SETUP, 'good setup again');
    noPackMode = up.commitFile('pack-mode.json', '{"packMode": 2}\n', 'other pack mode');
  });

  afterAll(() => {
    rmSync(up.scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    rmSync(packsHome(), { recursive: true, force: true });
    accept.mockClear();
    decline.mockClear();
  });

  it('previews the render command and writes and renders nothing when declined', async () => {
    const result = await addPack({ id: 'gstack', url: up.url, ref: good }, decline);
    expect(result.written).toBe(false);
    expect(result.preview.adapter).toBe('gstack-runtime');
    expect(result.preview.runtime).toEqual({
      command: ['bash', 'setup', '--pack-root', packRenderDir('gstack', good), '--pack-state-root', packStateDir('gstack')],
    });
    expect(await getPack('gstack')).toBeNull();
    expect(existsSync(packRenderDir('gstack', good))).toBe(false);
  });

  it('renders after consent, then registers the commit', async () => {
    const result = await addPack({ id: 'gstack', url: up.url, ref: good }, accept);
    expect(result.written).toBe(true);
    expect(existsSync(join(packRenderDir('gstack', good), '.gstack-pack.json'))).toBe(true);
    expect(existsSync(packStateDir('gstack'))).toBe(true);
    expect(await getPack('gstack')).toEqual({ id: 'gstack', url: up.url, ref: good, commit: good });
  });

  it('writes no registry entry and no render when the render fails', async () => {
    const error = await addPack({ id: 'gstack', url: up.url, ref: failing }, accept).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'render', message: 'pack gstack: render failed: pack mode: boom' });
    expect(accept).toHaveBeenCalledOnce();
    expect(await getPack('gstack')).toBeNull();
    expect(existsSync(packRenderDir('gstack', failing))).toBe(false);
  });

  it('rejects a commit without pack mode before asking', async () => {
    await expect(addPack({ id: 'gstack', url: up.url, ref: noPackMode }, accept)).rejects.toMatchObject({
      code: 'render',
      message: `pack gstack: ${noPackMode.slice(0, 7)} has no pack mode (pack-mode.json); use https://github.com/eltmon/gstack at a commit with pack mode`,
    });
    expect(accept).not.toHaveBeenCalled();
    expect(await getPack('gstack')).toBeNull();
  });

  it('keeps the trusted commit when the new commit fails to render on update', async () => {
    await writePackEntry({ id: 'gstack', url: up.url, ref: good, commit: good });
    await expect(updatePack('gstack', { ref: failing }, accept)).rejects.toMatchObject({ code: 'render' });
    expect((await getPack('gstack'))?.commit).toBe(good);
    expect(existsSync(packRenderDir('gstack', failing))).toBe(false);
  });

  it('reports an unchanged pack without the pack-mode and bun checks', async () => {
    await writePackEntry({ id: 'gstack', url: up.url, ref: good, commit: good });
    const result = await updatePack('gstack', {}, accept);
    expect(result.written).toBe(false);
    expect(result.preview.runtime).toBeUndefined();
    expect(accept).not.toHaveBeenCalled();
  });

  it('re-renders the trusted commit on sync when its render is missing', async () => {
    await addPack({ id: 'gstack', url: up.url, ref: good }, accept);
    rmSync(packRenderDir('gstack', good), { recursive: true, force: true });
    await syncPack('gstack');
    expect(existsSync(join(packRenderDir('gstack', good), '.gstack-pack.json'))).toBe(true);
  });
});
