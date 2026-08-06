import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { waitForCliproxySpawn } from '../../src/lib/cliproxy.js';

function fakeChild(pid?: number): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    unref: vi.fn(),
  }) as unknown as ChildProcess;
}

describe('waitForCliproxySpawn', () => {
  it('turns a spawn ENOENT into a rejected promise instead of an unhandled process error', async () => {
    const child = fakeChild();
    const spawnPromise = waitForCliproxySpawn(child);
    const error = new Error('spawn /missing/cliproxy ENOENT');

    child.emit('error', error);

    await expect(spawnPromise).rejects.toBe(error);
    expect(child.listenerCount('error')).toBe(0);
  });

  it('resolves with the spawned pid and detaches the child', async () => {
    const child = fakeChild(3523);
    const spawnPromise = waitForCliproxySpawn(child);

    child.emit('spawn');

    await expect(spawnPromise).resolves.toBe(3523);
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
