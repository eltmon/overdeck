import { appendFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import type { DeliveryResult } from './delivery.js';
import { getOverdeckHome } from '../paths.js';

export const WARM_HIT_GAP_SECONDS = 300;

export interface TierFeedDeliveryMetric {
  ts: string;
  issueId?: string;
  sha: string;
  beadTitle: string;
  tierName: string;
  agentId: string;
  tokenCount: number;
  result: DeliveryResult;
}

export interface AgentWarmHitFraction {
  agentId: string;
  deliveryCount: number;
  measuredGapCount: number;
  warmHitCount: number;
  warmHitFraction: number;
}

export function tierMetricsDir(overdeckHome = getOverdeckHome()): string {
  return join(overdeckHome, 'tier-metrics');
}

export function tierFeedDeliveriesPath(overdeckHome = getOverdeckHome()): string {
  return join(tierMetricsDir(overdeckHome), 'feed-deliveries.jsonl');
}

export function estimateFeedDeliveryTokens(message: string): number {
  return Math.ceil(message.length / 4);
}

export async function recordTierFeedDelivery(
  metric: TierFeedDeliveryMetric,
  options: { overdeckHome?: string } = {},
): Promise<void> {
  const dir = tierMetricsDir(options.overdeckHome);
  await mkdir(dir, { recursive: true });
  await appendFile(tierFeedDeliveriesPath(options.overdeckHome), `${JSON.stringify(metric)}\n`, 'utf8');
}

export async function readTierFeedDeliveries(
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

export function computeWarmHitFractions(
  deliveries: readonly TierFeedDeliveryMetric[],
  warmGapSeconds = WARM_HIT_GAP_SECONDS,
): AgentWarmHitFraction[] {
  const byAgent = new Map<string, TierFeedDeliveryMetric[]>();
  for (const delivery of deliveries) {
    const existing = byAgent.get(delivery.agentId) ?? [];
    existing.push(delivery);
    byAgent.set(delivery.agentId, existing);
  }

  return [...byAgent.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([agentId, agentDeliveries]) => {
      const ordered = [...agentDeliveries].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      let measuredGapCount = 0;
      let warmHitCount = 0;
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = Date.parse(ordered[index - 1].ts);
        const current = Date.parse(ordered[index].ts);
        if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
        measuredGapCount += 1;
        if ((current - previous) / 1000 < warmGapSeconds) warmHitCount += 1;
      }
      return {
        agentId,
        deliveryCount: ordered.length,
        measuredGapCount,
        warmHitCount,
        warmHitFraction: measuredGapCount === 0 ? 0 : warmHitCount / measuredGapCount,
      };
    });
}

export function deriveTieredAgentCostRole(agentId: string, issueId?: string): string {
  const issueLower = issueId?.toLowerCase();
  if (issueLower && agentId === `agent-${issueLower}`) return 'foreman';
  if (issueLower && agentId === `agent-${issueLower}-review-supervisor`) return 'supervisor';
  const slotMatch = issueLower
    ? new RegExp(`^agent-${issueLower}-slot-(\\d+)$`).exec(agentId)
    : /^agent-[a-z]+-\d+-slot-(\d+)$/i.exec(agentId);
  if (slotMatch) return `tier:slot-${slotMatch[1]}`;
  return 'other';
}
