/**
 * PAN-3966: the PAN-2579 warm-idle reap in `spawnRun` decides from the
 * backend-aware liveness oracle and reaps through `stopAgent`. It used to read
 * tmux's `#{pane_dead}`, which on a Herdr host always answered "not dead", so
 * every role-run re-dispatch was refused as "already running".
 */
import { describe, expect, it, vi } from 'vitest';

import type { LivenessVerdict } from '../liveness.js';
import { reapWarmIdleRoleRun } from '../warm-idle-reap.js';

const AGENT = 'agent-pan-3966-review';

function deps(verdict: LivenessVerdict | Error, status: string | undefined = 'running') {
  const stop = vi.fn(async () => undefined);
  const isAlive = vi.fn(async () => {
    if (verdict instanceof Error) throw verdict;
    return verdict;
  });
  const readStatus = vi.fn(() => status);
  return { stop, isAlive, readStatus };
}

describe('reapWarmIdleRoleRun', () => {
  it('reaps a leftover whose pane process exited, through the stop path', async () => {
    const d = deps({ alive: false, reason: 'pane-dead' });
    await expect(reapWarmIdleRoleRun(AGENT, d)).resolves.toBe(true);
    expect(d.isAlive).toHaveBeenCalledWith(AGENT);
    expect(d.stop).toHaveBeenCalledWith(AGENT);
  });

  it('keeps a live harness: it is an active run', async () => {
    const d = deps({ alive: true, paneAlive: true });
    await expect(reapWarmIdleRoleRun(AGENT, d)).resolves.toBe(false);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('treats an unprobeable pane as active', async () => {
    for (const verdict of [
      { alive: false, reason: 'runtime-indeterminate' } as const,
      new Error('herdr socket down'),
    ]) {
      const d = deps(verdict);
      await expect(reapWarmIdleRoleRun(AGENT, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  // PAN-3923: an interactive role run never exits on its own. A finished one
  // is a live harness idle at its prompt (Herdr) or a pane with no harness.
  it('reaps a Herdr harness that finished its prompt (idle or done, past starting)', async () => {
    for (const backendState of ['idle', 'done'] as const) {
      const d = deps({ alive: true, paneAlive: true, backendState }, 'running');
      await expect(reapWarmIdleRoleRun(AGENT, d)).resolves.toBe(true);
      expect(d.readStatus).toHaveBeenCalledWith(AGENT);
      expect(d.stop).toHaveBeenCalledWith(AGENT);
    }
  });

  it('keeps a Herdr harness that is working, blocked, unknown, or idle before its prompt landed', async () => {
    const cases = [
      ['working', 'running'],
      ['blocked', 'running'],
      ['unknown', 'running'],
      ['idle', 'starting'],
      ['done', 'starting'],
    ] as const;
    for (const [backendState, status] of cases) {
      const d = deps({ alive: true, paneAlive: true, backendState }, status);
      await expect(reapWarmIdleRoleRun(AGENT, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  it('reaps a pane with no live harness in it, not only a dead pane', async () => {
    for (const reason of ['runtime-missing', 'no-session'] as const) {
      const d = deps({ alive: false, reason });
      await expect(reapWarmIdleRoleRun(AGENT, d)).resolves.toBe(true);
      expect(d.stop).toHaveBeenCalledWith(AGENT);
    }
  });

  it('still lets the dispatch proceed when the stop itself fails', async () => {
    const d = deps({ alive: false, reason: 'pane-dead' });
    d.stop.mockRejectedValueOnce(new Error('close failed'));
    await expect(reapWarmIdleRoleRun(AGENT, d)).resolves.toBe(true);
  });
});
