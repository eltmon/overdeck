import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURED_COMMAND_MAX_OUTPUT_BYTES,
  CAPTURED_COMMAND_TIMEOUT_MS,
  runCapturedCommand,
} from '../executors.js';

function createChild() {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

describe('runCapturedCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns the bundled CLI with argv and derives status from the exit code', async () => {
    const child = createChild();
    const spawnPanCli = vi.fn(() => child);
    const resultPromise = runCapturedCommand(['status'], { spawnPanCli });

    child.stdout!.emit('data', Buffer.from('running agents\n'));
    child.emit('close', 0, null);

    await expect(resultPromise).resolves.toEqual({
      kind: 'captured',
      status: 'completed',
      command: '/pan status',
      output: 'running agents\n',
      truncated: false,
    });
    expect(spawnPanCli).toHaveBeenCalledWith(['status'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('includes stderr and reports non-zero exits as failed', async () => {
    const child = createChild();
    const resultPromise = runCapturedCommand(['show', 'PAN-42'], {
      spawnPanCli: vi.fn(() => child),
    });

    child.stderr!.emit('data', Buffer.from('Issue PAN-42 was not found.\n'));
    child.emit('close', 2, null);

    await expect(resultPromise).resolves.toMatchObject({
      kind: 'captured',
      status: 'failed',
      command: '/pan show PAN-42',
      output: 'Issue PAN-42 was not found.\n',
      truncated: false,
    });
  });

  it('bounds captured output and states when it was truncated', async () => {
    const child = createChild();
    const resultPromise = runCapturedCommand(['status'], {
      spawnPanCli: vi.fn(() => child),
    });

    child.stdout!.emit('data', Buffer.alloc(CAPTURED_COMMAND_MAX_OUTPUT_BYTES + 1_024, 'x'));
    child.emit('close', 0, null);
    const result = await resultPromise;

    expect(result).toMatchObject({
      kind: 'captured',
      status: 'completed',
      truncated: true,
    });
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(CAPTURED_COMMAND_MAX_OUTPUT_BYTES);
    expect(result.output.endsWith('Output was truncated after 65,536 bytes.')).toBe(true);
  });

  it('kills and fails a child that exceeds the timeout', async () => {
    const child = createChild();
    const resultPromise = runCapturedCommand(['status'], {
      spawnPanCli: vi.fn(() => child),
    });

    await vi.advanceTimersByTimeAsync(CAPTURED_COMMAND_TIMEOUT_MS);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(resultPromise).resolves.toEqual({
      kind: 'captured',
      status: 'failed',
      command: '/pan status',
      output: 'Command /pan status timed out after 30 seconds and was stopped.',
      truncated: false,
    });
  });
});
