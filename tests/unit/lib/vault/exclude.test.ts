import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVaultConfig, type VaultExclude } from '../../../../src/lib/vault/config.js';
import { addExclusion, isExcluded, isPathUnder, removeExclusion } from '../../../../src/lib/vault/exclude.js';

const none: VaultExclude = { paths: [], origins: [], sessions: [] };

describe('vault exclude: isExcluded (pure)', () => {
  it('ac1: path exclusions are segment aware', () => {
    const exclude = { ...none, paths: ['/a/b'] };
    expect(isExcluded({ cwd: '/a/b/c' }, exclude)).toBe(true);
    expect(isExcluded({ cwd: '/a/b' }, exclude)).toBe(true);
    expect(isExcluded({ cwd: '/a/b/' }, exclude)).toBe(true);
    expect(isExcluded({ cwd: '/a/bc' }, exclude)).toBe(false);
    expect(isExcluded({ cwd: '/a' }, exclude)).toBe(false);
    expect(isExcluded({ cwd: '/x/a/b' }, exclude)).toBe(false);
    expect(isPathUnder('/a/b/../b/c', '/a/b')).toBe(true);
  });

  it('ac2: an excluded origin excludes every cwd in that repo', () => {
    const exclude = { ...none, origins: ['git@github.com:eltmon/private.git'] };
    expect(isExcluded({ cwd: '/home/u/private', gitOrigin: 'git@github.com:eltmon/private.git' }, exclude)).toBe(true);
    expect(isExcluded({ cwd: '/home/u/other', gitOrigin: 'git@github.com:eltmon/other.git' }, exclude)).toBe(false);
    expect(isExcluded({ cwd: '/home/u/none', gitOrigin: null }, exclude)).toBe(false);
  });

  it('session exclusions match the native session id or the vaultId', () => {
    const exclude = { ...none, sessions: ['sess-1', 'vault-9'] };
    expect(isExcluded({ nativeSessionId: 'sess-1' }, exclude)).toBe(true);
    expect(isExcluded({ vaultId: 'vault-9' }, exclude)).toBe(true);
    expect(isExcluded({ nativeSessionId: 'sess-2', vaultId: 'vault-1' }, exclude)).toBe(false);
    expect(isExcluded({}, exclude)).toBe(false);
  });
});

describe('vault exclude: config updates', () => {
  let root: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-exclude-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('ac3: addExclusion then removeExclusion round-trips through config.json', async () => {
    await addExclusion('paths', '/a/b');
    await addExclusion('origins', 'https://example.com/o.git');
    await addExclusion('sessions', 'sess-1');
    await addExclusion('sessions', 'sess-1');
    let exclude = (await readVaultConfig()).exclude;
    expect(exclude).toEqual({ paths: ['/a/b'], origins: ['https://example.com/o.git'], sessions: ['sess-1'] });
    expect(isExcluded({ cwd: '/a/b/c' }, exclude)).toBe(true);
    expect(isExcluded({ nativeSessionId: 'sess-1' }, exclude)).toBe(true);

    await removeExclusion('paths', '/a/b');
    await removeExclusion('sessions', 'sess-1');
    await removeExclusion('sessions', 'never-there');
    exclude = (await readVaultConfig()).exclude;
    expect(exclude).toEqual({ paths: [], origins: ['https://example.com/o.git'], sessions: [] });
    expect(isExcluded({ cwd: '/a/b/c' }, exclude)).toBe(false);
    expect(isExcluded({ nativeSessionId: 'sess-1' }, exclude)).toBe(false);
  });

  it('normalises path entries and leaves other config keys alone', async () => {
    await addExclusion('paths', '/a/b/../b/');
    const config = await readVaultConfig();
    expect(config.exclude.paths).toEqual(['/a/b']);
    expect(config.syncIntervalSec).toBe(300);
    expect(config.backend).toBeUndefined();
  });
});
