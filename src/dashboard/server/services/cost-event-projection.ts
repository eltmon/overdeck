/**
 * Cost-event projection — persist pi-harness (and other non-Claude) cost events
 * into the canonical cost store.
 *
 * Claude-code agents write cost events directly via the PostToolUse hook
 * (sync-sources/hooks/record-cost-event.js). Pi and other harnesses emit
 * `cost-event` runtime events through the agent heartbeat endpoint; those are
 * translated to `cost.event_recorded` domain events. This projection bridges
 * those domain events into the same SQLite + JSONL cost store so dashboard
 * rollups and runaway-spend detection work for every harness.
 */

import { appendCostEventSync, type CostEvent } from '../../../lib/costs/events.js';
import { getDatabase } from '../../../lib/database/index.js';
import type { SqliteDatabase } from '../../../lib/database/driver.js';

export interface PersistableCostEvent {
  type: string;
  timestamp?: string;
  payload?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function usageNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function deriveProviderAndModel(model: string): { provider: string; model: string } {
  const lower = model.toLowerCase();
  if (lower.includes('claude')) {
    return { provider: 'anthropic', model };
  }
  if (lower.includes('gpt')) {
    return { provider: 'openai', model };
  }
  if (lower.includes('gemini')) {
    return { provider: 'google', model };
  }
  if (lower.includes('kimi') || lower.startsWith('minimax')) {
    return { provider: 'custom', model };
  }
  // Fall back to a sensible default rather than dropping the event.
  return { provider: 'anthropic', model: 'claude-sonnet-4' };
}

function buildCostEvent(event: PersistableCostEvent): CostEvent | null {
  if (event.type !== 'cost.event_recorded') return null;
  const p = asRecord(event.payload);
  const agentId = typeof p['agentId'] === 'string' && p['agentId'] ? p['agentId'] : null;
  if (!agentId) return null;

  const modelRaw = typeof p['model'] === 'string' && p['model'] ? p['model'] : 'pi';
  const { provider, model } = deriveProviderAndModel(modelRaw);
  const cost = usageNumber(p['cost']) ?? 0;
  const input = usageNumber(p['inputTokens']) ?? 0;
  const output = usageNumber(p['outputTokens']) ?? 0;
  const cacheRead = usageNumber(p['cacheReadTokens']) ?? 0;
  const cacheWrite = usageNumber(p['cacheWriteTokens']) ?? 0;

  return {
    ts: (typeof event.timestamp === 'string' && event.timestamp) ? event.timestamp : new Date().toISOString(),
    type: 'cost',
    agentId,
    issueId: typeof p['issueId'] === 'string' && p['issueId'] ? p['issueId'] : 'UNKNOWN-0',
    sessionType: typeof p['sessionType'] === 'string' && p['sessionType'] ? p['sessionType'] : 'implementation',
    provider,
    model,
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
  };
}

function updateAgentCostSoFar(db: SqliteDatabase, agentId: string, cost: number): void {
  if (cost === 0) return;
  db.prepare(
    `UPDATE agents
     SET cost_so_far = COALESCE(cost_so_far, 0) + ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(cost, new Date().toISOString(), agentId);
}

/**
 * Persist a `cost.event_recorded` domain event to the canonical cost store and
 * update the agent's running cost total.
 *
 * Best-effort: failures are logged but not thrown, so a malformed cost event
 * does not crash the dashboard event pipeline.
 */
export function persistCostEventFromDomainEvent(event: PersistableCostEvent): void {
  const costEvent = buildCostEvent(event);
  if (!costEvent) return;

  try {
    appendCostEventSync(costEvent);
  } catch (err) {
    console.error('[cost-event-projection] appendCostEventSync failed:', err);
    return;
  }

  try {
    const db = getDatabase();
    updateAgentCostSoFar(db, costEvent.agentId, costEvent.cost);
  } catch (err) {
    console.error('[cost-event-projection] updateAgentCostSoFar failed:', err);
  }
}
