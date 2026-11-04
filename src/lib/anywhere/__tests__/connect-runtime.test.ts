import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureDurableRuntime,
  isNpxCacheRoot,
  isRuntimePackageRoot,
  readRuntimeVersion,
  runtimePackageRoot,
  type ConnectRuntimeDeps,
} from '../connect-runtime.js';

const HOME = '/home/a/.overdeck';
const ROOT = '/home/a/.overdeck/runtime/node_modules/@overdeck/core';

function fakeDeps(files: Record<string, string>, execFile?: ConnectRuntimeDeps['execFile']) {
  const store = new Map(Object.entries(files));
  return {
    store,
    deps: {
      execFile: vi.fn<ConnectRuntimeDeps['execFile']>(execFile ?? (async () => {
        store.set(`${ROOT}/package.json`, JSON.stringify({ version: '1.2.3' }));
        store.set(`${ROOT}/dist/cli/index.js`, '');
        store.set(`${ROOT}/dist/supervisor/server.js`, '');
        return { stdout: '', stderr: '' };
      })),
      readFile: vi.fn(async (path: string) => store.get(path) ?? null),
      fileExists: vi.fn(async (path: string) => store.has(path)),
    },
  };
}

describe('isNpxCacheRoot', () => {
  it('detects an npx cache root and nothing else', () => {
    expect(isNpxCacheRoot('/home/a/.npm/_npx/3f2a/node_modules/@overdeck/core')).toBe(true);
    expect(isNpxCacheRoot('C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\3f2a\\node_modules\\@overdeck\\core')).toBe(true);
    expect(isNpxCacheRoot('/usr/lib/node_modules/@overdeck/core')).toBe(false);
    expect(isNpxCacheRoot('/home/a/Projects/overdeck')).toBe(false);
    expect(isNpxCacheRoot('/home/a/my_npx_tools/overdeck')).toBe(false);
  });
});

describe('isRuntimePackageRoot', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('matches the runtime package root and nothing else', () => {
    expect(isRuntimePackageRoot(ROOT, HOME)).toBe(true);
    expect(isRuntimePackageRoot('/usr/lib/node_modules/@overdeck/core', HOME)).toBe(false);
    expect(isRuntimePackageRoot(`${ROOT}/`, HOME)).toBe(true);
    expect(isRuntimePackageRoot('/home/a/.overdeck/runtime/x/../node_modules/@overdeck/core', HOME)).toBe(true);
  });

  it('matches through a symlinked OVERDECK_HOME', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'connect-runtime-'));
    const real = join(tmpDir, 'real');
    const link = join(tmpDir, 'link');
    const root = join(real, 'runtime', 'node_modules', '@overdeck', 'core');
    await mkdir(root, { recursive: true });
    await symlink(real, link);

    expect(isRuntimePackageRoot(root, link)).toBe(true);
  });
});

describe('readRuntimeVersion', () => {
  it('reads the installed version, or null', async () => {
    expect(runtimePackageRoot(HOME)).toBe(ROOT);
    await expect(readRuntimeVersion(HOME, fakeDeps({ [`${ROOT}/package.json`]: '{"version":"1.2.3"}' }).deps)).resolves.toBe('1.2.3');
    await expect(readRuntimeVersion(HOME, fakeDeps({}).deps)).resolves.toBeNull();
    await expect(readRuntimeVersion(HOME, fakeDeps({ [`${ROOT}/package.json`]: 'not json' }).deps)).resolves.toBeNull();
  });
});

describe('ensureDurableRuntime', () => {
  it('runs no npm when the runtime already has the version', async () => {
    const { deps } = fakeDeps({ [`${ROOT}/package.json`]: '{"version":"1.2.3"}' });

    await expect(ensureDurableRuntime(HOME, '1.2.3', deps)).resolves.toEqual({ root: ROOT, installed: false });
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('installs the exact version into <home>/runtime with the documented npm argv', async () => {
    const { deps } = fakeDeps({});

    await expect(ensureDurableRuntime(HOME, '1.2.3', deps)).resolves.toEqual({ root: ROOT, installed: true });
    expect(deps.execFile).toHaveBeenCalledWith(
      'npm',
      ['install', '--prefix', '/home/a/.overdeck/runtime', '--no-audit', '--no-fund', '--omit=dev', '@overdeck/core@1.2.3'],
      { timeout: 600_000 },
    );
  });

  it('reinstalls when the runtime has another version', async () => {
    const { deps } = fakeDeps({ [`${ROOT}/package.json`]: '{"version":"1.2.2"}' });

    await expect(ensureDurableRuntime(HOME, '1.2.3', deps)).resolves.toEqual({ root: ROOT, installed: true });
    expect(deps.execFile).toHaveBeenCalledOnce();
  });

  it('reports the last 20 lines of npm stderr when the install fails', async () => {
    const stderr = Array.from({ length: 25 }, (_, i) => `npm ERR! line ${i + 1}`).join('\n');
    const { deps } = fakeDeps({}, async () => {
      throw Object.assign(new Error('Command failed: npm install'), { stderr });
    });

    const error = await ensureDurableRuntime(HOME, '1.2.3', deps).catch((e: unknown) => e as Error);
    expect(error.message).toBe(
      `Could not install @overdeck/core@1.2.3 into /home/a/.overdeck/runtime: ${stderr.split('\n').slice(5).join('\n')}. `
      + 'Run that npm command yourself, then run pan connect again.',
    );
    expect(error.message).not.toContain('line 5\n');
  });

  it('fails when the install did not produce the supervisor bundle', async () => {
    const { deps } = fakeDeps({}, async () => ({ stdout: '', stderr: '' }));

    await expect(ensureDurableRuntime(HOME, '1.2.3', deps)).rejects.toThrow(/dist\/cli\/index\.js is missing/);
  });
});
