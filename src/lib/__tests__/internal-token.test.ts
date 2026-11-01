import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetInternalTokenCacheForTests,
  ensureInternalToken,
  getInternalToken,
} from '../internal-token.js';
import { getOverdeckHome } from '../paths.js';

function tokenFilePath(): string {
  return join(getOverdeckHome(), 'internal-token');
}

beforeEach(() => {
  _resetInternalTokenCacheForTests();
  rmSync(tokenFilePath(), { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;
});

describe('internal-token', () => {
  it('file wins over a stale env token', () => {
    const path = tokenFilePath();
    writeFileSync(path, 'file-token\n');
    process.env.OVERDECK_INTERNAL_TOKEN = 'stale-token';

    expect(getInternalToken()).toBe('file-token');
    expect(ensureInternalToken()).toBe('file-token');
    expect(readFileSync(path, 'utf8').trim()).toBe('file-token');
  });

  it('env seeds the file when none exists', () => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'seed-token';

    expect(getInternalToken()).toBe('seed-token');
    expect(existsSync(tokenFilePath())).toBe(false);

    _resetInternalTokenCacheForTests();
    expect(ensureInternalToken()).toBe('seed-token');

    const path = tokenFilePath();
    expect(readFileSync(path, 'utf8')).toBe('seed-token\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('generates and persists when neither exists', () => {
    const token = ensureInternalToken();

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(tokenFilePath(), 'utf8').trim()).toBe(token);
  });

  it('ensure after a file-sourced cache does no file read', () => {
    const token = ensureInternalToken();
    const path = tokenFilePath();
    rmSync(path, { force: true });

    expect(ensureInternalToken()).toBe(token);
    expect(existsSync(path)).toBe(false);
  });
});
