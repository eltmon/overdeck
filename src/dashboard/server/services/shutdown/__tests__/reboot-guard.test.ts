/**
 * PAN-5342 WI-8: the reboot guard. `spawn` is a fake; no real systemd-inhibit
 * runs. Ticks run on fake timers.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REBOOT_GUARD_TICK_MS,
  _resetRebootGuardForTests,
  rebootGuardArgs,
  releaseRebootGuard,
  startRebootGuard,
  type InhibitorProcess,
  type RebootGuardDeps,
} from '../reboot-guard.js';

class FakeChild extends EventEmitter {
  readonly stdin = { end: vi.fn(), on: vi.fn() };
}

function harness(initial: Record<string, boolean>, overrides: Partial<RebootGuardDeps> = {}) {
  const sessions = new Map(Object.entries(initial)); // id → at turn boundary
  const state = { inventoryNull: false, draining: false };
  const children: FakeChild[] = [];
  const spawn = vi.fn((_command: string, _args: readonly string[], _options: unknown): InhibitorProcess => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as InhibitorProcess;
  });
  startRebootGuard({
    platform: 'linux',
    spawn,
    listLiveSessionIds: async () => (state.inventoryNull ? null : new Set(sessions.keys())),
    atTurnBoundary: (id) => sessions.get(id) ?? false,
    isDraining: () => state.draining,
    now: () => Date.now(),
    ...overrides,
  });
  return { sessions, state, children, spawn };
}

const tick = () => vi.advanceTimersByTimeAsync(REBOOT_GUARD_TICK_MS);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  _resetRebootGuardForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('reboot guard (PAN-5342 WI-8)', () => {
  it('holds a block inhibitor with the exact argv, counting only mid-turn sessions, after the first tick', async () => {
    const h = harness({ 'agent-a': false, 'conv-flywheel': true });
    await vi.advanceTimersByTimeAsync(REBOOT_GUARD_TICK_MS - 1);
    expect(h.spawn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.spawn).toHaveBeenCalledWith(
      'systemd-inhibit',
      ['--what=shutdown', '--mode=block', '--who=Overdeck', '--why=Overdeck has 1 agents running. Use Shut down Overdeck first.', 'cat'],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    expect(rebootGuardArgs(3)[3]).toBe('--why=Overdeck has 3 agents running. Use Shut down Overdeck first.');
  });

  it('live but idle sessions only hold nothing', async () => {
    const h = harness({ 'conv-flywheel': true, 'agent-a': true });
    await tick();
    await tick();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('respawns when N changes (new holder first) and not when it holds steady', async () => {
    const h = harness({ 'agent-a': false });
    await tick();
    await tick();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    h.sessions.set('agent-b', false);
    await tick();
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(h.spawn.mock.calls[1]![1][3]).toBe('--why=Overdeck has 2 agents running. Use Shut down Overdeck first.');
    expect(h.children[0]!.stdin.end).toHaveBeenCalledTimes(1);
    expect(h.children[1]!.stdin.end).not.toHaveBeenCalled();
    // The old holder exiting cleanly does not drop the new one.
    h.children[0]!.emit('exit', 0, null);
    await tick();
    expect(h.spawn).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when N reaches 0', async () => {
    const h = harness({ 'agent-a': false });
    await tick();
    h.sessions.set('agent-a', true);
    await tick();
    expect(h.children[0]!.stdin.end).toHaveBeenCalledTimes(1);
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it('keeps the current state when the inventory is unreadable', async () => {
    const h = harness({ 'agent-a': false });
    await tick();
    h.state.inventoryNull = true;
    await tick();
    expect(h.children[0]!.stdin.end).not.toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it('stays held through a drain until releaseRebootGuard(), even with every session idle', async () => {
    const h = harness({ 'agent-a': false });
    await tick();
    h.state.draining = true;
    h.sessions.set('agent-a', true);
    await tick();
    await tick();
    expect(h.children[0]!.stdin.end).not.toHaveBeenCalled();
  });

  it('is released by releaseRebootGuard() and never respawned', async () => {
    const h = harness({ 'agent-a': false });
    await tick();
    releaseRebootGuard();
    expect(h.children[0]!.stdin.end).toHaveBeenCalledTimes(1);
    h.sessions.set('agent-b', false);
    await tick();
    await tick();
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it('disables itself after a spawn error, logging once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ 'agent-a': false });
    await tick();
    h.children[0]!.emit('error', Object.assign(new Error('spawn systemd-inhibit ENOENT'), { code: 'ENOENT' }));
    h.sessions.set('agent-b', false);
    await tick();
    await tick();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[reboot-guard] disabled: spawn systemd-inhibit ENOENT');
  });

  it('disables itself when systemd-inhibit exits non-zero within 2 s', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ 'agent-a': false });
    await tick();
    h.children[0]!.emit('exit', 1, null);
    await tick();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[reboot-guard] disabled: systemd-inhibit exited with code 1');
  });

  it('is a no-op off Linux', async () => {
    const h = harness({ 'agent-a': false }, { platform: 'darwin' });
    await tick();
    await tick();
    expect(h.spawn).not.toHaveBeenCalled();
  });
});
