import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import {
  _resetUpdateQueueForTests,
  runExclusiveUpdate,
  runHarnessUpdateCommand,
  runQueuedUpdateCommand,
} from '../../../../src/lib/fleet/harness-update-runner.js';

type Callback = (error: (Error & { code?: unknown; killed?: boolean }) | null, stdout: string, stderr: string) => void;

function respondWith(error: (Error & { code?: unknown; killed?: boolean }) | null, stdout = '', stderr = ''): void {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Callback) => {
    queueMicrotask(() => cb(error, stdout, stderr));
    return { stdin: { end: vi.fn() } };
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('runHarnessUpdateCommand (PAN-5108 D10)', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('calls execFile with the argv split into file and args, without a shell', async () => {
    respondWith(null, 'added 1 package');
    const argv = ['/usr/bin/npm', 'install', '-g', '@anthropic-ai/claude-code@latest'];

    const result = await runHarnessUpdateCommand(argv, { timeoutMs: 1_000 });

    expect(result).toEqual({ code: 0, output: 'added 1 package' });
    const [file, args, opts] = execFileMock.mock.calls[0]!;
    expect(file).toBe('/usr/bin/npm');
    expect(args).toEqual(['install', '-g', '@anthropic-ai/claude-code@latest']);
    expect(opts).not.toHaveProperty('shell');
    expect(opts).toMatchObject({ timeout: 1_000, maxBuffer: 16 * 1024 * 1024 });
  });

  it('prepends pathDir to PATH', async () => {
    respondWith(null);

    await runHarnessUpdateCommand(['npm', 'install'], { timeoutMs: 1_000, pathDir: '/home/u/.nvm/bin' });

    const opts = execFileMock.mock.calls[0]![2] as { env: NodeJS.ProcessEnv };
    expect(opts.env.PATH).toBe(`/home/u/.nvm/bin:${process.env.PATH ?? ''}`);
  });

  it('resolves with the exit code and the output tail on failure', async () => {
    respondWith(Object.assign(new Error('Command failed'), { code: 243 }), '', 'npm ERR! EACCES');

    const result = await runHarnessUpdateCommand(['npm', 'install'], { timeoutMs: 1_000 });

    expect(result.code).toBe(243);
    expect(result.output).toContain('EACCES');
    expect(result.output).toContain('Command failed');
  });

  it('reports a maxBuffer overflow as itself, not as a timeout', async () => {
    respondWith(Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }));

    const result = await runHarnessUpdateCommand(['npm'], { timeoutMs: 1_000 });

    expect(result.code).toBe(-1);
    expect(result.output).toContain('maxBuffer length exceeded');
    expect(result.output).not.toContain('timed out');
  });

  it('resolves with -1 for a spawn error and for a timeout', async () => {
    respondWith(Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' }));
    expect((await runHarnessUpdateCommand(['npm'], { timeoutMs: 1_000 })).code).toBe(-1);

    respondWith(Object.assign(new Error('killed'), { killed: true, code: null }));
    const timedOut = await runHarnessUpdateCommand(['npm'], { timeoutMs: 180_000 });
    expect(timedOut.code).toBe(-1);
    expect(timedOut.output).toContain('timed out after 180 seconds');
  });

  it('keeps only the last 2000 characters of output', async () => {
    respondWith(null, `${'a'.repeat(3_000)}END`);

    const result = await runHarnessUpdateCommand(['npm'], { timeoutMs: 1_000 });

    expect(result.output).toHaveLength(2_000);
    expect(result.output.endsWith('END')).toBe(true);
  });
});

describe('runExclusiveUpdate (PAN-5108 D8)', () => {
  beforeEach(() => {
    _resetUpdateQueueForTests();
    execFileMock.mockReset();
  });

  const OK = { code: 0, output: 'done' };

  it('joins a second request for the same key while the first is pending', async () => {
    const gate = deferred<{ code: number; output: string }>();
    const job = vi.fn(() => gate.promise);

    const first = runExclusiveUpdate('npm install -g x', job);
    const second = runExclusiveUpdate('npm install -g x', job);
    gate.resolve(OK);

    await expect(first).resolves.toEqual(OK);
    await expect(second).resolves.toEqual(OK);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('runs different keys one after the other', async () => {
    const firstGate = deferred<{ code: number; output: string }>();
    const secondJob = vi.fn(async () => ({ code: 0, output: 'second' }));

    const first = runExclusiveUpdate('a', () => firstGate.promise);
    const second = runExclusiveUpdate('b', secondJob);
    await Promise.resolve();
    await Promise.resolve();
    expect(secondJob).not.toHaveBeenCalled();

    firstGate.resolve(OK);
    await expect(first).resolves.toEqual(OK);
    await expect(second).resolves.toEqual({ code: 0, output: 'second' });
    expect(secondJob).toHaveBeenCalledTimes(1);
  });

  it('does not let a rejected job block the next job', async () => {
    const failed = runExclusiveUpdate('a', async () => {
      throw new Error('boom');
    });
    const next = runExclusiveUpdate('b', async () => OK);

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toEqual(OK);
  });

  it('runs the same key again after the earlier run settled', async () => {
    const job = vi.fn(async () => OK);

    await runExclusiveUpdate('a', job);
    await runExclusiveUpdate('a', job);

    expect(job).toHaveBeenCalledTimes(2);
  });
});

describe('runQueuedUpdateCommand (PAN-5108 D8 cross-path joins)', () => {
  beforeEach(() => {
    _resetUpdateQueueForTests();
    execFileMock.mockReset();
  });

  it('returns the command result of a run it joins', async () => {
    const gate = deferred<{ code: number; output: string }>();
    const running = runExclusiveUpdate('npm install -g x', () => gate.promise);
    const joined = runQueuedUpdateCommand(['npm', 'install', '-g', 'x'], { timeoutMs: 1_000 });
    gate.resolve({ code: 1, output: 'E404' });

    await expect(running).resolves.toEqual({ code: 1, output: 'E404' });
    await expect(joined).resolves.toEqual({ code: 1, output: 'E404' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('runs its own command, without throwing, when it joins a launch run that ran no command', async () => {
    respondWith(null, 'changed 1 package');
    const gate = deferred<null>();
    // A launch job whose own pre-check found the binary new enough yields null.
    const launchRun = runExclusiveUpdate('npm install -g x', () => gate.promise);
    const background = runQueuedUpdateCommand(['npm', 'install', '-g', 'x'], { timeoutMs: 1_000 });
    gate.resolve(null);

    await expect(launchRun).resolves.toBeNull();
    await expect(background).resolves.toEqual({ code: 0, output: 'changed 1 package' });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
