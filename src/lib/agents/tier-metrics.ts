import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { DeliveryResult } from './delivery.js';
import { getOverdeckHome } from '../paths.js';

export interface TierFeedDeliveryMetric {
  ts: string;
  issueId?: string;
  sha: string;
  itemTitle: string;
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

function tierMetricsDir(overdeckHome = getOverdeckHome()): string {
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
