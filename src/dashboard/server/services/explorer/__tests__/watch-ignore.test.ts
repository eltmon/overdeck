import { describe, expect, it } from 'vitest';
import {
  WATCHER_IGNORE_DIRS,
  buildParcelWatcherIgnoreOptions,
  buildWatchOptions,
  topLevelIgnoreRegex,
} from '../watch-ignore.js';

describe('buildParcelWatcherIgnoreOptions', () => {
  it('builds one nested-directory regex on linux', () => {
    const opts = buildParcelWatcherIgnoreOptions(WATCHER_IGNORE_DIRS, 'linux');
    expect(opts.ignore).toBeUndefined();
    expect(opts.ignoreGlobs).toHaveLength(1);
    const re = new RegExp(opts.ignoreGlobs![0]!);
    for (const p of ['node_modules', 'a/node_modules/b', 'x/.git/HEAD']) expect(re.test(p)).toBe(true);
    for (const p of ['node_modules_x/a', 'src/a.ts']) expect(re.test(p)).toBe(false);
  });

  it('adds at most eight plain exclusions on darwin', () => {
    const opts = buildParcelWatcherIgnoreOptions(WATCHER_IGNORE_DIRS, 'darwin');
    expect(opts.ignore).toHaveLength(8);
    expect(opts.ignoreGlobs).toHaveLength(1);
  });

  it('accepts either separator on win32', () => {
    const re = new RegExp(buildParcelWatcherIgnoreOptions(WATCHER_IGNORE_DIRS, 'win32').ignoreGlobs![0]!);
    expect(re.test('a\\node_modules\\b')).toBe(true);
    expect(re.test('a/node_modules/b')).toBe(true);
  });

  it('returns no options for no names', () => {
    expect(buildParcelWatcherIgnoreOptions([], 'linux')).toEqual({});
  });
});

describe('topLevelIgnoreRegex', () => {
  it('matches names at the root only, with regex characters escaped', () => {
    const re = new RegExp(topLevelIgnoreRegex(['workspaces', 'dist.rollback.1'], 'linux')!);
    for (const p of ['workspaces', 'workspaces/feature-1/x', 'dist.rollback.1']) expect(re.test(p)).toBe(true);
    for (const p of ['src/workspaces/x', 'dist-rollback-1', 'workspacesx']) expect(re.test(p)).toBe(false);
  });

  it('is null for no names', () => {
    expect(topLevelIgnoreRegex([], 'linux')).toBeNull();
  });
});

describe('buildWatchOptions', () => {
  it('appends the top-level regex when there are top-level names', () => {
    expect(buildWatchOptions([], 'linux').ignoreGlobs).toHaveLength(1);
    expect(buildWatchOptions(['workspaces'], 'linux').ignoreGlobs).toHaveLength(2);
  });
});
