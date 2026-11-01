/**
 * PAN-4630: `herdrSearchDirs` is the shared lookup the probe and the terminal
 * streams both use for PATH. Ordering (PATH entries, then `~/.local/bin`
 * last) and empty-segment filtering matter: a dashboard PATH with a trailing
 * delimiter or no PATH at all must still resolve `~/.local/bin`.
 */
import { describe, expect, it } from 'vitest';
import { delimiter, join } from 'path';

import { herdrSearchDirs } from '../../../../src/lib/terminal-backends/select.js';

describe('herdrSearchDirs', () => {
  it('returns PATH entries in order followed by ~/.local/bin last', () => {
    expect(herdrSearchDirs({ pathEnv: ['/a', '/b'].join(delimiter), homeDir: '/h' })).toEqual([
      '/a',
      '/b',
      join('/h', '.local', 'bin'),
    ]);
  });

  it('drops empty PATH segments', () => {
    expect(
      herdrSearchDirs({ pathEnv: ['', '/a', '', '/b', ''].join(delimiter), homeDir: '/h' }),
    ).toEqual(['/a', '/b', join('/h', '.local', 'bin')]);
  });

  it('returns only ~/.local/bin when PATH is empty', () => {
    expect(herdrSearchDirs({ pathEnv: '', homeDir: '/h' })).toEqual([join('/h', '.local', 'bin')]);
  });
});
