/**
 * Prime Agent session JSONL → durable cost events (PAN-3668 WI-19, FR-12, D16).
 *
 * One event per assistant `message` entry that carries usage. When RLM children ran
 * under a message, `child_usage_attributed` entries fold their usage into it; the last
 * such entry's `aggregateUsage` for that message replaces the message's own `usage`, so
 * child usage is counted once, on its parent. `requestId` is
 * `prime-agent:<sessionId>:<entryId>`, stable across re-reads, so a second reconcile
 * imports nothing. A message with no usage, or with all-zero usage (a failed or aborted
 * turn), produces no event.
 */
import { readFile } from 'node:fs/promises';

interface PrimeUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

export interface PrimeAgentUsageEvent {
  requestId: string;
  sessionId: string;
  entryId: string;
  timestamp: string;
  provider: string | null;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function parsePrimeAgentCostEvents(sessionFile: string): Promise<PrimeAgentUsageEvent[]> {
  const raw = await readFile(sessionFile, 'utf8');
  const entries: Array<Record<string, unknown>> = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object') entries.push(parsed as Record<string, unknown>);
    } catch {
      // A live session can end in a partial line.
    }
  }

  const sessionId = entries.find((entry) => entry.type === 'session' && typeof entry.id === 'string')?.id as string | undefined;
  if (!sessionId) return [];

  const aggregates = new Map<string, PrimeUsage>();
  for (const entry of entries) {
    if (entry.type === 'child_usage_attributed' && typeof entry.targetId === 'string' && entry.aggregateUsage && typeof entry.aggregateUsage === 'object') {
      aggregates.set(entry.targetId, entry.aggregateUsage as PrimeUsage);
    }
  }

  const events: PrimeAgentUsageEvent[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message' || typeof entry.id !== 'string') continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || message.role !== 'assistant') continue;
    const usage = aggregates.get(entry.id) ?? (message.usage as PrimeUsage | undefined);
    if (!usage) continue;
    const event: PrimeAgentUsageEvent = {
      requestId: `prime-agent:${sessionId}:${entry.id}`,
      sessionId,
      entryId: entry.id,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date(num(message.timestamp)).toISOString(),
      provider: typeof message.provider === 'string' ? message.provider : null,
      model: typeof message.model === 'string' ? message.model : null,
      input: num(usage.input),
      output: num(usage.output),
      cacheRead: num(usage.cacheRead),
      cacheWrite: num(usage.cacheWrite),
      cost: num(usage.cost?.total),
    };
    if (event.input + event.output + event.cacheRead + event.cacheWrite === 0 && event.cost === 0) continue;
    events.push(event);
  }
  return events;
}
