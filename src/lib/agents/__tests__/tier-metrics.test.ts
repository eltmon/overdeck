import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveTieredAgentCostRole, recordTierFeedDelivery, type TierFeedDeliveryMetric, tierFeedDeliveriesPath  } from '../tier-metrics.js';

// Moved here from src/lib/agents/tier-metrics.ts, which no production code called (PAN-3958 CH-8).
async function readTierFeedDeliveries(
  options: { overdeckHome?: string } = {},
): Promise<TierFeedDeliveryMetric[]> {
  let body: string;
  try {
    body = await readFile(tierFeedDeliveriesPath(options.overdeckHome), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return body
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as TierFeedDeliveryMetric);
}

let tempDir: string | undefined;

function metric(agentId: string, ts: string): TierFeedDeliveryMetric {
  return {
    ts,
    issueId: 'PAN-1',
    sha: 'abc123',
    taskTitle: 'task',
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


  it('derives tiered execution cost roles from registered agent ids', () => {
    expect(deriveTieredAgentCostRole('agent-pan-1', 'PAN-1')).toBe('foreman');
    expect(deriveTieredAgentCostRole('agent-pan-1-slot-3', 'PAN-1')).toBe('tier:slot-3');
    expect(deriveTieredAgentCostRole('agent-pan-1-review-supervisor', 'PAN-1')).toBe('supervisor');
    expect(deriveTieredAgentCostRole('agent-pan-2-slot-1', 'PAN-1')).toBe('other');
  });
});
