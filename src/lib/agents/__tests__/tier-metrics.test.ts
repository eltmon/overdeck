import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeWarmHitFractions,
  deriveTieredAgentCostRole,
  recordTierFeedDelivery,
  readTierFeedDeliveries,
  type TierFeedDeliveryMetric,
} from '../tier-metrics.js';

let tempDir: string | undefined;

function metric(agentId: string, ts: string): TierFeedDeliveryMetric {
  return {
    ts,
    issueId: 'PAN-1',
    sha: 'abc123',
    beadTitle: 'bead',
    tierName: 'standard',
    agentId,
    tokenCount: 10,
    result: { ok: true, path: 'supervisor' },
  };
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('tier metrics', () => {
  it('writes feed delivery metrics that are queryable from the JSONL log', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tier-metrics-'));

    await recordTierFeedDelivery(metric('agent-pan-1-slot-1', '2026-07-02T12:00:00.000Z'), {
      overdeckHome: tempDir,
    });

    const deliveries = await readTierFeedDeliveries({ overdeckHome: tempDir });
    expect(deliveries).toEqual([
      expect.objectContaining({
        ts: '2026-07-02T12:00:00.000Z',
        agentId: 'agent-pan-1-slot-1',
        tokenCount: 10,
      }),
    ]);
  });

  it('computes warm-hit fraction from delivery-to-delivery gaps under 300 seconds per agent', () => {
    const fractions = computeWarmHitFractions([
      metric('agent-pan-1-slot-1', '2026-07-02T12:00:00.000Z'),
      metric('agent-pan-1-slot-1', '2026-07-02T12:04:59.000Z'),
      metric('agent-pan-1-slot-1', '2026-07-02T12:10:00.000Z'),
      metric('agent-pan-1-slot-2', '2026-07-02T12:00:00.000Z'),
    ]);

    expect(fractions).toEqual([
      {
        agentId: 'agent-pan-1-slot-1',
        deliveryCount: 3,
        measuredGapCount: 2,
        warmHitCount: 1,
        warmHitFraction: 0.5,
      },
      {
        agentId: 'agent-pan-1-slot-2',
        deliveryCount: 1,
        measuredGapCount: 0,
        warmHitCount: 0,
        warmHitFraction: 0,
      },
    ]);
  });

  it('derives tiered execution cost roles from registered agent ids', () => {
    expect(deriveTieredAgentCostRole('agent-pan-1', 'PAN-1')).toBe('foreman');
    expect(deriveTieredAgentCostRole('agent-pan-1-slot-3', 'PAN-1')).toBe('tier:slot-3');
    expect(deriveTieredAgentCostRole('agent-pan-1-review-supervisor', 'PAN-1')).toBe('supervisor');
    expect(deriveTieredAgentCostRole('agent-pan-2-slot-1', 'PAN-1')).toBe('other');
  });
});
