import { describe, expect, it, vi } from 'vitest';

import { requireManagedKimiDelivery } from '../managed-kimi-delivery.js';

describe('requireManagedKimiDelivery', () => {
  it.each(['flywheel', 'knowledge'])('stops and rejects failed %s-role Kimi context', async (role) => {
    const onFailure = vi.fn(async () => undefined);

    await expect(requireManagedKimiDelivery({
      agentId: `agent-${role}`,
      role,
      harness: 'kimi-code',
      delivery: { ok: false, path: 'tmux', failure: 'not ready' },
      onFailure,
    })).rejects.toThrow(/managed Kimi context delivery failed.*not ready/);

    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('does not run failure cleanup for a successful Kimi delivery', async () => {
    const onFailure = vi.fn(async () => undefined);
    await requireManagedKimiDelivery({
      agentId: 'agent-success',
      role: 'knowledge',
      harness: 'kimi-code',
      delivery: { ok: true, path: 'supervisor' },
      onFailure,
    });
    expect(onFailure).not.toHaveBeenCalled();
  });
});
