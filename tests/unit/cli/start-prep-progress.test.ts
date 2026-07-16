import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPrepProgress,
  PrepStepTimeoutError,
} from '../../../src/cli/commands/start-prep-progress.js';

function createSpinner() {
  return { text: '' };
}

function createStream(isTTY: boolean) {
  const chunks: string[] = [];
  return {
    chunks,
    stream: {
      isTTY,
      write: vi.fn((chunk: string | Uint8Array) => {
        chunks.push(String(chunk));
        return true;
      }),
    },
  };
}

describe('start prep progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the spinner and writes a plain progress line for non-TTY output', () => {
    const spinner = createSpinner();
    const { chunks, stream } = createStream(false);
    const progress = createPrepProgress(spinner, { stream });

    progress.update('Syncing latest main into workspace...');

    expect(spinner.text).toBe('Syncing latest main into workspace...');
    expect(chunks).toEqual(['[prep] Syncing latest main into workspace...\n']);
  });

  it('updates the spinner without writing a plain progress line for TTY output', () => {
    const spinner = createSpinner();
    const { chunks, stream } = createStream(true);
    const progress = createPrepProgress(spinner, { stream });

    progress.update('Syncing latest main into workspace...');

    expect(spinner.text).toBe('Syncing latest main into workspace...');
    expect(chunks).toEqual([]);
  });

  it('emits a heartbeat every 15 seconds until the step settles', async () => {
    const spinner = createSpinner();
    const { chunks, stream } = createStream(false);
    const progress = createPrepProgress(spinner, { stream });
    let resolveStep!: (value: string) => void;

    const resultPromise = progress.step(
      'sync-main',
      60_000,
      () => new Promise<string>((resolve) => { resolveStep = resolve; }),
    );

    await vi.advanceTimersByTimeAsync(15_000);
    expect(chunks).toContain('[prep] still running: sync-main (15s elapsed)\n');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(chunks).toContain('[prep] still running: sync-main (30s elapsed)\n');

    resolveStep('synced');
    await expect(resultPromise).resolves.toBe('synced');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a named timeout error when the step exceeds its budget', async () => {
    const spinner = createSpinner();
    const { stream } = createStream(false);
    const progress = createPrepProgress(spinner, { stream });

    const resultPromise = progress.step(
      'sync-main',
      240_000,
      () => new Promise<never>(() => undefined),
    );
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: 'PrepStepTimeoutError',
      message: "Prep step 'sync-main' exceeded its 240s budget",
    });

    await vi.advanceTimersByTimeAsync(240_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(new PrepStepTimeoutError('test-step', 1_000)).toBeInstanceOf(Error);
  });

  it('aborts degradable work and waits for cancellation cleanup to settle', async () => {
    const progress = createPrepProgress(createSpinner(), { stream: createStream(false).stream });
    let receivedSignal: AbortSignal | undefined;
    let finishCleanup!: () => void;
    let settled = false;
    const resultPromise = progress.step('sync-main', 240_000, (signal) => {
      receivedSignal = signal;
      return new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
    }, { awaitQuiescence: true });
    void resultPromise.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(240_000);

    expect(receivedSignal?.aborted).toBe(true);
    expect(settled).toBe(false);
    finishCleanup();
    await expect(resultPromise).rejects.toBeInstanceOf(PrepStepTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a cleanup failure instead of degrading after timeout', async () => {
    const progress = createPrepProgress(createSpinner(), { stream: createStream(false).stream });
    const unsafeCleanup = new Error('Git quiescence could not be established');
    const resultPromise = progress.step('sync-main', 240_000, (signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(unsafeCleanup), { once: true });
    }), { awaitQuiescence: true });
    const rejection = expect(resultPromise).rejects.toBe(unsafeCleanup);

    await vi.advanceTimersByTimeAsync(240_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the step value, clears timers, and emits elapsed completion progress', async () => {
    const spinner = createSpinner();
    const { chunks, stream } = createStream(false);
    const progress = createPrepProgress(spinner, { stream });

    const resultPromise = progress.step('install-dependencies', 30_000, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
      return 42;
    });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(resultPromise).resolves.toBe(42);
    expect(chunks).toEqual([
      '[prep] install-dependencies\n',
      '[prep] completed: install-dependencies (5s elapsed)\n',
    ]);
    expect(spinner.text).toBe('completed: install-dependencies (5s elapsed)');
    expect(vi.getTimerCount()).toBe(0);
  });
});
