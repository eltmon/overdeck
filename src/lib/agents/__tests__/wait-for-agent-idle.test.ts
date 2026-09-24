/**
 * PAN-4186: `pan tell`'s idle-prompt wait (waitForAgentIdle) read only the
 * hook-fed runtime mirror, so a Herdr pane idle at its prompt still burned the
 * full 5 s and was sent to blind. On Herdr the pane's `agent_status` answers
 * too; tmux keeps the mirror-only wait. The backend is mocked at the
 * terminal-backend boundary (host selection + Herdr liveness probe); nothing
 * here reaches a real session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hostTerminalBackendName: vi.fn(async (): Promise<'herdr' | 'tmux'> => 'herdr'),
  probeHerdrAgentLiveness: vi.fn(),
  getAgentRuntimeStateSync: vi.fn((): { state: string } | null => ({ state: 'active' })),
}));

vi.mock('../../terminal-backends/select.js', () => ({
  hostTerminalBackendName: mocks.hostTerminalBackendName,
}));

vi.mock('../../terminal-backends/herdr.js', () => ({
  probeHerdrAgentLiveness: mocks.probeHerdrAgentLiveness,
}));

vi.mock('../runtime-state.js', () => ({
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
}));

import { waitForAgentIdle } from '../identity.js';

function aliveWith(state: string) {
  return { kind: 'alive', paneId: 'w1:p1', state };
}

/** Resolve the wait while advancing fake time; report whether it settled early. */
async function runWait(advanceMs: number): Promise<{ result: boolean; settledEarly: boolean }> {
  let settled = false;
  const pending = waitForAgentIdle('conv-42', 5000).then((value) => {
    settled = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(0);
  const settledEarly = settled;
  await vi.advanceTimersByTimeAsync(advanceMs);
  return { result: await pending, settledEarly };
}

describe('waitForAgentIdle (PAN-4186)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.hostTerminalBackendName.mockResolvedValue('herdr');
    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'active' });
    mocks.probeHerdrAgentLiveness.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns at once when Herdr reports the pane idle, even though the mirror does not', async () => {
    mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('idle'));
    const { result, settledEarly } = await runWait(5000);
    expect(result).toBe(true);
    expect(settledEarly).toBe(true);
    expect(mocks.probeHerdrAgentLiveness).toHaveBeenCalledWith('conv-42');
  });

  it('treats Herdr `done` (finished turn at the prompt) as idle', async () => {
    mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('done'));
    const { result, settledEarly } = await runWait(5000);
    expect(result).toBe(true);
    expect(settledEarly).toBe(true);
  });

  it('keeps waiting while Herdr reports working, and returns true once it goes idle', async () => {
    mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('working'));
    let settled = false;
    const pending = waitForAgentIdle('conv-42', 5000).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('idle'));
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toBe(true);
  });

  it('times out (wait-then-send) when Herdr reports working or blocked for the whole window', async () => {
    mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('blocked'));
    const { result, settledEarly } = await runWait(5000);
    expect(result).toBe(false);
    expect(settledEarly).toBe(false);
  });

  it.each([
    ['unknown state', () => mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('unknown'))],
    ['indeterminate probe', () => mocks.probeHerdrAgentLiveness.mockResolvedValue({ kind: 'indeterminate', reason: 'socket down' })],
    ['absent pane', () => mocks.probeHerdrAgentLiveness.mockResolvedValue({ kind: 'absent' })],
    ['probe throws', () => mocks.probeHerdrAgentLiveness.mockRejectedValue(new Error('boom'))],
  ])('keeps the current wait-then-send behavior when Herdr cannot tell (%s)', async (_label, arrange) => {
    arrange();
    const { result, settledEarly } = await runWait(5000);
    expect(result).toBe(false);
    expect(settledEarly).toBe(false);
  });

  it('still honors the runtime mirror on Herdr when the backend cannot tell', async () => {
    mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('unknown'));
    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'idle' });
    const { result, settledEarly } = await runWait(0);
    expect(result).toBe(true);
    expect(settledEarly).toBe(true);
  });

  it('on tmux reads only the runtime mirror and never probes Herdr', async () => {
    mocks.hostTerminalBackendName.mockResolvedValue('tmux');
    mocks.probeHerdrAgentLiveness.mockResolvedValue(aliveWith('idle'));
    const { result } = await runWait(5000);
    expect(result).toBe(false);
    expect(mocks.probeHerdrAgentLiveness).not.toHaveBeenCalled();

    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'idle' });
    const idle = await runWait(0);
    expect(idle.result).toBe(true);
    expect(idle.settledEarly).toBe(true);
    expect(mocks.probeHerdrAgentLiveness).not.toHaveBeenCalled();
  });
});
