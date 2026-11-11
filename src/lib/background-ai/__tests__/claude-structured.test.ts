import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  ClaudeStructuredCallError,
  buildStructuredClaudeArgs,
  isClaudeAuthFailure,
  runClaudeStructured,
} from '../claude-structured.js';

type FakeChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  });
}

function closeWith(child: FakeChild, stdout: string, code = 0, stderr = ''): void {
  setImmediate(() => {
    if (stderr) child.stderr.write(stderr);
    child.stdout.end(stdout);
    child.stderr.end();
    child.stdout.on('end', () => child.emit('close', code));
  });
}

const resolveBinary = async () => '/bin/claude';

describe('runClaudeStructured', () => {
  it('rejects with an auth ClaudeStructuredCallError when the CLI exits 1 with a Not logged in envelope and empty stderr', async () => {
    const child = fakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);
    closeWith(child, JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' }), 1, '');

    const promise = runClaudeStructured(
      { model: 'claude-haiku-5-5', prompt: 'p', schema: { type: 'object' }, timeoutMs: 5000 },
      { spawn: spawnFn, resolveBinary },
    );

    await expect(promise).rejects.toBeInstanceOf(ClaudeStructuredCallError);
    await promise.catch((error: ClaudeStructuredCallError) => {
      expect(error.failure.authFailure).toBe(true);
      expect(error.message).toContain('Not logged in');
    });
  });

  it('rejects when exit 0 carries is_error true', async () => {
    const child = fakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);
    closeWith(child, JSON.stringify({ is_error: true, result: 'boom' }), 0);

    await expect(
      runClaudeStructured(
        { model: 'claude-haiku-5-5', prompt: 'p', schema: { type: 'object' }, timeoutMs: 5000 },
        { spawn: spawnFn, resolveBinary },
      ),
    ).rejects.toBeInstanceOf(ClaudeStructuredCallError);
  });

  it('resolves the envelope with structured_output on exit 0', async () => {
    const child = fakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);
    closeWith(child, JSON.stringify({ structured_output: { title: 'x' } }), 0);

    const result = await runClaudeStructured(
      { model: 'claude-haiku-5-5', prompt: 'p', schema: { type: 'object' }, timeoutMs: 5000 },
      { spawn: spawnFn, resolveBinary },
    );

    expect(result).toEqual({ structured_output: { title: 'x' } });
  });

  it('appends extraArgs after the hardening flags', async () => {
    const child = fakeChild();
    const spawnFn = vi.fn().mockReturnValue(child);
    closeWith(child, JSON.stringify({ structured_output: {} }), 0);

    await runClaudeStructured(
      {
        model: 'claude-haiku-5-5',
        prompt: 'p',
        schema: { type: 'object' },
        timeoutMs: 5000,
        extraArgs: ['--no-session-persistence'],
      },
      { spawn: spawnFn, resolveBinary },
    );

    const hardened = buildStructuredClaudeArgs({ type: 'object' }, 'claude-haiku-5-5');
    const actualArgs = spawnFn.mock.calls[0][1] as string[];
    expect(actualArgs).toEqual([...hardened, '--no-session-persistence']);
  });

  describe('timeout and abort', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('kills the child and rejects after timeoutMs', async () => {
      const child = fakeChild();
      const spawnFn = vi.fn().mockReturnValue(child);

      const promise = runClaudeStructured(
        { model: 'claude-haiku-5-5', prompt: 'p', schema: { type: 'object' }, timeoutMs: 1000 },
        { spawn: spawnFn, resolveBinary },
      );
      const assertion = expect(promise).rejects.toThrow('claude invocation timed out after 1000ms');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('kills the child and rejects when the signal aborts, and spawns nothing for an already-aborted signal', async () => {
      const child = fakeChild();
      const spawnFn = vi.fn().mockReturnValue(child);
      const controller = new AbortController();

      const promise = runClaudeStructured(
        { model: 'claude-haiku-5-5', prompt: 'p', schema: { type: 'object' }, timeoutMs: 5000, signal: controller.signal },
        { spawn: spawnFn, resolveBinary },
      );
      const assertion = expect(promise).rejects.toThrow('claude invocation aborted');

      // Let resolveBinary/providerEnv settle and the child actually spawn
      // before aborting, so this exercises the in-flight abort path (the
      // listener attached inside the executor), not the already-aborted
      // pre-spawn check covered below.
      await vi.advanceTimersByTimeAsync(0);
      expect(spawnFn).toHaveBeenCalled();
      controller.abort();
      await assertion;
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      const alreadyAbortedController = new AbortController();
      alreadyAbortedController.abort();
      const spawnFn2 = vi.fn();
      await expect(
        runClaudeStructured(
          {
            model: 'claude-haiku-5-5',
            prompt: 'p',
            schema: { type: 'object' },
            timeoutMs: 5000,
            signal: alreadyAbortedController.signal,
          },
          { spawn: spawnFn2, resolveBinary },
        ),
      ).rejects.toThrow('claude invocation aborted');
      expect(spawnFn2).not.toHaveBeenCalled();
    });
  });
});

describe('isClaudeAuthFailure', () => {
  it('matches 401/403 and the login texts, and not a rate-limit text', () => {
    expect(isClaudeAuthFailure(null, 401)).toBe(true);
    expect(isClaudeAuthFailure(null, 403)).toBe(true);
    expect(isClaudeAuthFailure('Not logged in', null)).toBe(true);
    expect(isClaudeAuthFailure('Please run /login', null)).toBe(true);
    expect(isClaudeAuthFailure('Invalid API key', null)).toBe(true);
    expect(isClaudeAuthFailure('OAuth token has expired', null)).toBe(true);
    expect(isClaudeAuthFailure('authentication_error', null)).toBe(true);
    expect(isClaudeAuthFailure('Unauthorized', null)).toBe(true);
    expect(isClaudeAuthFailure('rate limit exceeded, try again later', null)).toBe(false);
    expect(isClaudeAuthFailure(null, 429)).toBe(false);
  });
});
