import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemError } from 'effect/PlatformError';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HOST_TOOL_MISSING_RECHECK_MS,
  hostToolNotFoundError,
  isSpawnNotFoundError,
  noteHostToolSpawnFailed,
  refreshHostTools,
  resetHostToolsForTests,
  resolveHostTool,
  setHostToolFinderForTests,
} from '../../../src/lib/host-tools.js';

afterEach(() => {
  resetHostToolsForTests();
});

describe('resolveHostTool', () => {
  it('caches a found path and calls the finder once', () => {
    const find = vi.fn().mockReturnValue('/fake/bin/docker');
    expect(resolveHostTool('docker', { find, pathEnv: '/fake/bin', now: () => 0 })).toBe('/fake/bin/docker');
    expect(resolveHostTool('docker', { find, pathEnv: '/fake/bin', now: () => 1 })).toBe('/fake/bin/docker');
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('caches a miss for 60 s, then looks again', () => {
    const find = vi.fn().mockReturnValue(null);
    const pathEnv = '/fake/bin';
    expect(resolveHostTool('docker', { find, pathEnv, now: () => 0 })).toBeNull();
    expect(find).toHaveBeenCalledTimes(1);
    expect(resolveHostTool('docker', { find, pathEnv, now: () => 59_999 })).toBeNull();
    expect(find).toHaveBeenCalledTimes(1);
    expect(resolveHostTool('docker', { find, pathEnv, now: () => HOST_TOOL_MISSING_RECHECK_MS })).toBeNull();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('a PATH change invalidates the cached entry', () => {
    const find = vi.fn().mockReturnValue('/fake/bin/docker');
    expect(resolveHostTool('docker', { find, pathEnv: '/fake/bin', now: () => 0 })).toBe('/fake/bin/docker');
    expect(find).toHaveBeenCalledTimes(1);
    resolveHostTool('docker', { find, pathEnv: '/other/bin', now: () => 0 });
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe('noteHostToolSpawnFailed', () => {
  it('marks a vanished tool missing', () => {
    const find = vi.fn().mockReturnValueOnce('/fake/bin/docker').mockReturnValue(null);
    const deps = { find, pathEnv: '/fake/bin', now: () => 0 };
    expect(resolveHostTool('docker', deps)).toBe('/fake/bin/docker');
    noteHostToolSpawnFailed('docker', hostToolNotFoundError('docker'), deps);
    expect(resolveHostTool('docker', deps)).toBeNull();
  });

  it('keeps a tool that a fresh lookup still finds', () => {
    const find = vi.fn().mockReturnValue('/fake/bin/docker');
    const deps = { find, pathEnv: '/fake/bin', now: () => 0 };
    expect(resolveHostTool('docker', deps)).toBe('/fake/bin/docker');
    // A missing-cwd ENOENT from the same spawn, not a missing binary.
    noteHostToolSpawnFailed('docker', hostToolNotFoundError('docker'), deps);
    expect(resolveHostTool('docker', deps)).toBe('/fake/bin/docker');
  });

  it('ignores non-ENOENT errors', () => {
    const find = vi.fn().mockReturnValue('/fake/bin/docker');
    const deps = { find, pathEnv: '/fake/bin', now: () => 0 };
    expect(resolveHostTool('docker', deps)).toBe('/fake/bin/docker');
    noteHostToolSpawnFailed('docker', { code: 1 }, deps);
    expect(resolveHostTool('docker', deps)).toBe('/fake/bin/docker');
    expect(find).toHaveBeenCalledTimes(1);
  });
});

describe('isSpawnNotFoundError', () => {
  it('recognizes an Effect PlatformError NotFound and a TmuxError-wrapped ENOENT', () => {
    const platformError = systemError({
      _tag: 'NotFound',
      module: 'ChildProcess',
      method: 'spawn',
      cause: { code: 'ENOENT' },
    });
    expect(isSpawnNotFoundError(platformError)).toBe(true);

    class TmuxError extends Error {
      cause: unknown;
      constructor(cause: unknown) {
        super('tmux failed');
        this.cause = cause;
      }
    }
    const tmuxError = new TmuxError({ code: 'ENOENT', syscall: 'spawn tmux' });
    expect(isSpawnNotFoundError(tmuxError)).toBe(true);

    expect(isSpawnNotFoundError({ code: 1 })).toBe(false);
  });
});

describe('refreshHostTools', () => {
  it('forces a fresh lookup', () => {
    const find = vi.fn().mockReturnValue('/fake/bin/docker');
    const deps = { find, pathEnv: '/fake/bin', now: () => 0 };
    expect(resolveHostTool('docker', deps)).toBe('/fake/bin/docker');
    refreshHostTools();
    resolveHostTool('docker', deps);
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe('OVERDECK_TEST_ASSUME_HOST_TOOLS', () => {
  it('returns the bare name when no finder is injected', () => {
    expect(process.env.OVERDECK_TEST_ASSUME_HOST_TOOLS).toBe('1');
    expect(resolveHostTool('tmux')).toBe('tmux');
  });
});

describe('the real PATH lookup', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs = [];
  });

  it('returns null for an empty directory', () => {
    vi.stubEnv('OVERDECK_TEST_ASSUME_HOST_TOOLS', '');
    const dir = mkdtempSync(join(tmpdir(), 'host-tools-empty-'));
    tempDirs.push(dir);
    expect(resolveHostTool('docker', { pathEnv: dir, now: () => 0 })).toBeNull();
  });

  it('returns the absolute path of an executable file', () => {
    vi.stubEnv('OVERDECK_TEST_ASSUME_HOST_TOOLS', '');
    const dir = mkdtempSync(join(tmpdir(), 'host-tools-found-'));
    tempDirs.push(dir);
    const binPath = join(dir, 'docker');
    writeFileSync(binPath, '#!/bin/sh\n');
    chmodSync(binPath, 0o755);
    expect(resolveHostTool('docker', { pathEnv: dir, now: () => 0 })).toBe(binPath);
  });
});

describe('setHostToolFinderForTests', () => {
  it('clears the cache so a previously cached path does not hide the new finder', () => {
    const originalFind = vi.fn().mockReturnValue('/fake/bin/docker');
    expect(resolveHostTool('docker', { find: originalFind, pathEnv: '/fake/bin', now: () => 0 })).toBe(
      '/fake/bin/docker',
    );
    setHostToolFinderForTests(() => null);
    expect(resolveHostTool('docker')).toBeNull();
  });
});
