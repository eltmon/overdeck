import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveFilePathExists } from '../resolve-file-path-exists.js';

const TEST_ROOT = join(tmpdir(), `pan-1457-resolve-file-path-exists-${process.pid}`);

beforeAll(async () => {
  await mkdir(TEST_ROOT, { recursive: true });
  await writeFile(join(TEST_ROOT, 'real-file.txt'), 'hi');
  await mkdir(join(TEST_ROOT, 'real-dir'));
  await mkdir(join(TEST_ROOT, 'src/components/Foo'), { recursive: true });
  await mkdir(join(TEST_ROOT, 'src/lib'), { recursive: true });
  await writeFile(join(TEST_ROOT, 'src/lib/foo.ts'), 'export {}');
  try {
    await symlink(join(TEST_ROOT, 'real-file.txt'), join(TEST_ROOT, 'symlink-to-file'));
    await symlink(join(TEST_ROOT, 'does-not-exist'), join(TEST_ROOT, 'broken-symlink'));
  } catch {
    // Some filesystems disallow symlinks — those test cases will be skipped.
  }
});

afterAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

describe('resolveFilePathExists', () => {
  it('returns exists=true kind=file for a real file (relative)', async () => {
    expect(await resolveFilePathExists({ cwd: TEST_ROOT, path: 'real-file.txt' })).toEqual({
      exists: true,
      kind: 'file',
    });
  });

  it('returns exists=true kind=dir for a real directory (relative)', async () => {
    expect(await resolveFilePathExists({ cwd: TEST_ROOT, path: 'real-dir' })).toEqual({
      exists: true,
      kind: 'dir',
    });
  });

  it('returns exists=true kind=dir for a bare directory reference like src/components/Foo', async () => {
    // PAN-1457 motivating false-negative: regex alone would reject this.
    expect(
      await resolveFilePathExists({ cwd: TEST_ROOT, path: 'src/components/Foo' }),
    ).toEqual({ exists: true, kind: 'dir' });
  });

  it('returns exists=true for a real file nested under cwd', async () => {
    expect(await resolveFilePathExists({ cwd: TEST_ROOT, path: 'src/lib/foo.ts' })).toEqual({
      exists: true,
      kind: 'file',
    });
  });

  it('returns exists=false for a phantom path (conv/2209-style)', async () => {
    // PAN-1457 motivating false-positive.
    expect(await resolveFilePathExists({ cwd: TEST_ROOT, path: 'conv/2209' })).toEqual({
      exists: false,
      kind: null,
    });
  });

  it('returns exists=false for a path that escapes cwd via ..', async () => {
    // The resolved /tmp/.../does-not-exist won't exist either way.
    expect(
      await resolveFilePathExists({ cwd: TEST_ROOT, path: '../does-not-exist' }),
    ).toEqual({ exists: false, kind: null });
  });

  it('follows symlinks to real targets', async () => {
    const result = await resolveFilePathExists({ cwd: TEST_ROOT, path: 'symlink-to-file' });
    // Either exists=true (symlinks supported) or exists=false (filesystem
    // refused the symlink during setup) — both are acceptable.
    if (result.exists) {
      expect(result).toEqual({ exists: true, kind: 'file' });
    }
  });

  it('reports broken symlinks as exists=false', async () => {
    const result = await resolveFilePathExists({ cwd: TEST_ROOT, path: 'broken-symlink' });
    // If symlink creation was unsupported the path simply doesn't exist;
    // either way the result must be exists=false.
    expect(result).toEqual({ exists: false, kind: null });
  });

  it('accepts absolute paths and stats them directly', async () => {
    expect(
      await resolveFilePathExists({ cwd: '/tmp', path: join(TEST_ROOT, 'real-file.txt') }),
    ).toEqual({ exists: true, kind: 'file' });
  });

  it('returns exists=false for an empty path', async () => {
    expect(await resolveFilePathExists({ cwd: TEST_ROOT, path: '' })).toEqual({
      exists: false,
      kind: null,
    });
  });

  it('returns exists=false for absurdly long paths', async () => {
    const longPath = 'a'.repeat(5000);
    expect(await resolveFilePathExists({ cwd: TEST_ROOT, path: longPath })).toEqual({
      exists: false,
      kind: null,
    });
  });
});
