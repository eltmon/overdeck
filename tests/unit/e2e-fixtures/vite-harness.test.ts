import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRecordingLogger, createViteCacheDir, removeViteCacheDir } from '../../e2e/fixtures/vite-harness';

let projectRoot: string | undefined;

afterEach(async () => {
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = undefined;
});

describe('createViteCacheDir', () => {
  it('returns a distinct existing directory per call', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pan-5298-'));

    const dirA = await createViteCacheDir(projectRoot, 'issue-tree');
    const dirB = await createViteCacheDir(projectRoot, 'issue-tree');

    expect(dirA).not.toBe(dirB);
    const prefix = join(projectRoot, '.cache', 'vite-e2e', 'issue-tree-');
    expect(dirA.startsWith(prefix)).toBe(true);
    expect(dirB.startsWith(prefix)).toBe(true);
    expect((await stat(dirA)).isDirectory()).toBe(true);
    expect((await stat(dirB)).isDirectory()).toBe(true);
  });
});

describe('removeViteCacheDir', () => {
  it('deletes the directory and accepts undefined', async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pan-5298-'));
    const dir = await createViteCacheDir(projectRoot, 'issue-tree');

    await removeViteCacheDir(dir);
    expect(existsSync(dir)).toBe(false);

    await expect(removeViteCacheDir(undefined)).resolves.toBeUndefined();
  });
});

function createStubLogger() {
  const base = {
    hasWarned: false,
    info: vi.fn(),
    warn: vi.fn(function warn(this: typeof base) { this.hasWarned = true; }),
    warnOnce: vi.fn(function warnOnce(this: typeof base) { this.hasWarned = true; }),
    error: vi.fn(function error(this: typeof base) { this.hasWarned = true; }),
    clearScreen: vi.fn(),
    hasErrorLogged: vi.fn(() => false),
  };
  return base;
}

describe('createRecordingLogger', () => {
  it('records lines and forwards to the base logger', () => {
    const base = createStubLogger();
    const createLogger = vi.fn((_level: 'error') => base as never);
    const lines: string[] = [];

    const logger = createRecordingLogger(createLogger, lines);

    logger.info('a');
    logger.warn('b');
    logger.warnOnce('c');
    logger.warnOnce('c');
    logger.error('d');

    expect(lines).toEqual(['info  a', 'warn  b', 'warn  c', 'error d']);
    expect(createLogger).toHaveBeenCalledWith('error');
    expect(base.warnOnce).toHaveBeenCalledTimes(2);
    expect(base.error).toHaveBeenCalledTimes(1);
    expect(base.error).toHaveBeenCalledWith('d', undefined);
    expect(logger.hasWarned).toBe(true);
  });

  it('reports hasWarned false before any warning', () => {
    const base = createStubLogger();
    const createLogger = vi.fn((_level: 'error') => base as never);
    const lines: string[] = [];

    const logger = createRecordingLogger(createLogger, lines);

    expect(logger.hasWarned).toBe(false);
    logger.info('x');
    expect(logger.hasWarned).toBe(false);
  });
});
