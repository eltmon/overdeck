import { describe, expect, it, vi } from 'vitest';
import type { DeliveryResult } from '../delivery.js';
import { broadcastCommit, composeCommitFeedMessage } from '../tier-feed.js';

const TIERS = [
  { tierName: 'cheap', agentId: 'agent-pan-1-slot-1' },
  { tierName: 'standard', agentId: 'agent-pan-1-slot-2' },
  { tierName: 'frontier', agentId: 'agent-pan-1-slot-3' },
];

function spies() {
  const deliveries: Array<{ agentId: string; message: string; caller?: string }> = [];
  const deliver = vi.fn(async (agentId: string, message: string, caller?: string): Promise<DeliveryResult> => {
    deliveries.push({ agentId, message, caller });
    return { ok: true, path: 'supervisor' };
  });
  const gitShow = vi.fn(async () => 'commit abc123\n\ndiff --git a/foo.ts b/foo.ts\n+added line\n');
  return { deliver, gitShow, deliveries };
}

describe('broadcastCommit', () => {
  it('sends the commit diff to every standing tier agent via the delivery seam', async () => {
    const { deliver, gitShow, deliveries } = spies();

    await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
    });

    expect(gitShow).toHaveBeenCalledWith('/ws', 'abc123');
    expect(deliveries.map((d) => d.agentId)).toEqual(TIERS.map((t) => t.agentId));
    for (const delivery of deliveries) {
      expect(delivery.message).toContain('diff --git a/foo.ts b/foo.ts');
      expect(delivery.message).toContain('Bead: my bead');
      expect(delivery.caller).toBe('tier-feed:broadcastCommit');
    }
  });

  it('sends exactly N deliveries for N standing tiers — everyone hears everything', async () => {
    const { deliver, gitShow } = spies();

    const results = await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
    });

    expect(deliver).toHaveBeenCalledTimes(TIERS.length);
    expect(results).toHaveLength(TIERS.length);
    expect(results.map((r) => r.tierName)).toEqual(['cheap', 'standard', 'frontier']);
  });

  it('marks every feed message ingestion-only, instructing the recipient not to respond', async () => {
    const { deliver, gitShow, deliveries } = spies();

    await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
    });

    for (const delivery of deliveries) {
      expect(delivery.message).toContain('ingestion-only');
      expect(delivery.message).toContain('Do NOT respond');
    }
  });

  it('keeps delivering to remaining tiers when one delivery throws', async () => {
    const { gitShow } = spies();
    const deliver = vi.fn(async (agentId: string): Promise<DeliveryResult> => {
      if (agentId === 'agent-pan-1-slot-2') throw new Error('session gone');
      return { ok: true, path: 'supervisor' };
    });

    const results = await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
    });

    expect(results).toHaveLength(3);
    expect(results[1].result.ok).toBe(false);
    expect(results[1].result.failure).toBe('session gone');
    expect(results[0].result.ok).toBe(true);
    expect(results[2].result.ok).toBe(true);
  });

  it('composes deterministic messages so replay reconstructs the identical feed', () => {
    const first = composeCommitFeedMessage('abc123', 'my bead', 'diff-body\n');
    const second = composeCommitFeedMessage('abc123', 'my bead', 'diff-body\n');
    expect(first).toBe(second);
  });
});
