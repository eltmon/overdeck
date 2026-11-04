import type { spawn as spawnType } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted — define TEMP_ROOT via vi.hoisted so it's
// available before the factory runs (matches project-registration.test.ts).
const { TEMP_ROOT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: t } = require('node:os') as typeof import('node:os');
  return { TEMP_ROOT: j(t(), `pan-serve-test-${process.pid}`) };
});

vi.mock('../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/paths.js')>();
  return { ...actual, packageRoot: TEMP_ROOT };
});

import { serveCommand } from '../../../src/cli/commands/serve.js';
import { _resetInternalTokenCacheForTests } from '../../../src/lib/internal-token.js';
import { getOverdeckHome } from '../../../src/lib/paths.js';

function tokenFilePath(): string {
  return join(getOverdeckHome(), 'internal-token');
}

function fakeSpawn(): { spawn: typeof spawnType; calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }> } {
  const calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }> = [];
  const fake = (command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
    calls.push({ command, args, env: options.env });
    return new EventEmitter();
  };
  return { spawn: fake as unknown as typeof spawnType, calls };
}

beforeEach(() => {
  mkdirSync(join(TEMP_ROOT, 'dist', 'dashboard', 'public'), { recursive: true });
  writeFileSync(join(TEMP_ROOT, 'dist', 'dashboard', 'server.js'), '');
  writeFileSync(join(TEMP_ROOT, 'dist', 'dashboard', 'public', 'index.html'), '');

  _resetInternalTokenCacheForTests();
  rmSync(tokenFilePath(), { force: true });
  delete process.env.OVERDECK_INTERNAL_TOKEN;

  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(TEMP_ROOT, { recursive: true, force: true });
  // serveCommand mints <OVERDECK_HOME>/internal-token; never leave it for the
  // next test file in this worker's shared home (PAN-4881).
  rmSync(tokenFilePath(), { force: true });
});

describe('serveCommand', () => {
  it('writes the token file and never puts the token in the child env when no env token is set', async () => {
    const { spawn, calls } = fakeSpawn();
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const promise = serveCommand({ port: '39100' }, { spawn, openBrowser });
    await vi.advanceTimersByTimeAsync(1_500);
    await promise;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.env?.OVERDECK_INTERNAL_TOKEN).toBeUndefined();

    const fileToken = readFileSync(tokenFilePath(), 'utf8').trim();
    expect(fileToken).toMatch(/^[a-f0-9]{64}$/);
    expect(openBrowser).toHaveBeenCalledWith(`http://localhost:39100#overdeck_token=${fileToken}`);
  });

  it('uses the token file over a stale env token', async () => {
    mkdirSync(getOverdeckHome(), { recursive: true });
    writeFileSync(tokenFilePath(), 'file-token\n');
    process.env.OVERDECK_INTERNAL_TOKEN = 'stale-token';

    const { spawn } = fakeSpawn();
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const promise = serveCommand({ port: '39101' }, { spawn, openBrowser });
    await vi.advanceTimersByTimeAsync(1_500);
    await promise;

    expect(openBrowser).toHaveBeenCalledWith('http://localhost:39101#overdeck_token=file-token');
  });

  it('produces the same token across two runs', async () => {
    const { spawn: spawn1 } = fakeSpawn();
    const openBrowser1 = vi.fn().mockResolvedValue(undefined);
    const promise1 = serveCommand({ port: '39102' }, { spawn: spawn1, openBrowser: openBrowser1 });
    await vi.advanceTimersByTimeAsync(1_500);
    await promise1;

    _resetInternalTokenCacheForTests();
    const { spawn: spawn2 } = fakeSpawn();
    const openBrowser2 = vi.fn().mockResolvedValue(undefined);
    const promise2 = serveCommand({ port: '39102' }, { spawn: spawn2, openBrowser: openBrowser2 });
    await vi.advanceTimersByTimeAsync(1_500);
    await promise2;

    expect(openBrowser1).toHaveBeenCalledTimes(1);
    expect(openBrowser2).toHaveBeenCalledTimes(1);
    const firstUrl = openBrowser1.mock.calls[0]?.[0] as string;
    const secondUrl = openBrowser2.mock.calls[0]?.[0] as string;
    expect(firstUrl).toBe(secondUrl);
  });

  it('opens the browser exactly once after 1.5 s without --no-open', async () => {
    const { spawn } = fakeSpawn();
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const promise = serveCommand({ port: '39103' }, { spawn, openBrowser });
    await promise;
    await vi.advanceTimersByTimeAsync(1_499);
    expect(openBrowser).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(openBrowser).toHaveBeenCalledTimes(1);
  });

  it('never opens the browser with --no-open and still spawns the server on the port', async () => {
    const { spawn, calls } = fakeSpawn();
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    await serveCommand({ port: '39104', open: false }, { spawn, openBrowser });
    await vi.runAllTimersAsync();

    expect(openBrowser).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.env?.PORT).toBe('39104');
  });
});
