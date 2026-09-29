/**
 * PAN-4334 WI-2: the pack registry in config.yaml and the pack cache paths,
 * against real files under a temp OVERDECK_HOME.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  getPack,
  listPacks,
  packCacheDir,
  packExtractDir,
  packRepoDir,
  packsHome,
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
