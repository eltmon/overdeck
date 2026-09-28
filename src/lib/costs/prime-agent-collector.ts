/**
 * Prime Agent cost sweep (PAN-3668 WI-19, D16): every session JSONL under
 * `$OVERDECK_HOME/agents/<id>/prime-sessions/`, parsed into cost events for the
 * CostWriter `record()` door, which deduplicates by requestId.
 */
import { parsePrimeAgentCostEvents } from '../cost-parsers/prime-agent-parser.js';
import type { IssueId } from '../overdeck/issues.js';
import { getOverdeckHome } from '../paths.js';
import { listPrimeAgentSessionFiles } from '../runtimes/storage/prime-agent.js';
import { join } from 'node:path';

export interface PrimeAgentCollectedCostEvent {
  ts: Date;
  issueId: IssueId | null;
  agentId: string;
  sessionId: string;
  sessionType: 'prime-agent';
  provider: string | null;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  requestId: string;
  sourceFile: string;
}

function issueIdFromAgentName(name: string): IssueId | null {
  const match = name.match(/(?:agent|planning)-((?:[a-z]+-)?\d+)/i);
  return match?.[1] ? match[1].toUpperCase() as IssueId : null;
}

export async function collectPrimeAgentCostEvents(home = getOverdeckHome()): Promise<{
  events: PrimeAgentCollectedCostEvent[];
  skipped: Array<{ file: string; reason: string }>;
  errors: string[];
  scanned: number;
}> {
  const sessions = await listPrimeAgentSessionFiles(join(home, 'agents'));
  const events: PrimeAgentCollectedCostEvent[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const errors: string[] = [];
  for (const { agentId, file } of sessions) {
    let usage: Awaited<ReturnType<typeof parsePrimeAgentCostEvents>>;
    try {
      usage = await parsePrimeAgentCostEvents(file);
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (usage.length === 0) {
      skipped.push({ file, reason: 'no-usage' });
      continue;
    }
    for (const event of usage) {
      events.push({
        ts: new Date(event.timestamp),
        issueId: issueIdFromAgentName(agentId),
        agentId,
        sessionId: event.sessionId,
        sessionType: 'prime-agent',
        provider: event.provider,
        model: event.model,
        input: event.input,
        output: event.output,
        cacheRead: event.cacheRead,
        cacheWrite: event.cacheWrite,
        cost: event.cost,
        requestId: event.requestId,
        sourceFile: file,
      });
    }
  }
  return { events, skipped, errors, scanned: sessions.length };
}
