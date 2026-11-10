/**
 * Grok Build cost sweep (PAN-5078 D9): turn_completed entries that the ACP host
 * wrote with Grok turn usage into `$OVERDECK_HOME/agents/<id>/acp-session.jsonl`,
 * parsed into cost events for the CostWriter `record()` door, which deduplicates
 * by requestId. Overdeck never reads Grok's private ~/.grok/sessions store.
 * ACP transcripts of other providers (Kimi, OpenCode) carry no grok/* usage and
 * contribute nothing.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EffortLevel } from '@overdeck/contracts';
import type { AcpTurnUsage } from '../acp/transcript.js';
import { calculateCost, getPricing } from '../cost.js';
import type { IssueId } from '../overdeck/issues.js';
import { getOverdeckHome } from '../paths.js';
import { acpTranscriptPath } from '../runtimes/storage/acp.js';
import { readLaunchEfforts } from '../session-history.js';

export interface GrokCollectedCostEvent {
  ts: Date;
  issueId: IssueId | null;
  agentId: string;
  sessionId: string;
  sessionType: 'grok';
  provider: 'custom';
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  requestId: string;
  sourceFile: string;
  effort: EffortLevel | null;
}

interface TurnCompletedEntry {
  timestamp?: unknown;
  event?: unknown;
  sessionId?: unknown;
  promptId?: unknown;
  usage?: AcpTurnUsage;
}

function issueIdFromAgentName(name: string): IssueId | null {
  const match = name.match(/(?:agent|planning)-((?:[a-z]+-)?\d+)/i);
  return match?.[1] ? match[1].toUpperCase() as IssueId : null;
}

/** The vendor-reported cost, else the pricing table on the bare CLI model id. */
function turnCost(usage: AcpTurnUsage): number {
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) return usage.costUsd;
  const pricing = getPricing('custom', usage.model.slice('grok/'.length));
  if (!pricing) return 0;
  return calculateCost({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  }, pricing);
}

async function readTranscriptLines(file: string): Promise<string[] | null> {
  try {
    return (await readFile(file, 'utf8')).split('\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function collectGrokCostEvents(home = getOverdeckHome()): Promise<{
  events: GrokCollectedCostEvent[];
  skipped: Array<{ file: string; reason: string }>;
  errors: string[];
  scanned: number;
}> {
  const agentsRoot = join(home, 'agents');
  const events: GrokCollectedCostEvent[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const errors: string[] = [];
  let scanned = 0;

  let agentIds: string[];
  try {
    agentIds = (await readdir(agentsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { events, skipped, errors, scanned };
    throw error;
  }

  for (const agentId of agentIds) {
    const file = acpTranscriptPath(agentId, agentsRoot);
    let lines: string[] | null;
    try {
      lines = await readTranscriptLines(file);
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!lines) continue;
    scanned++;

    let effortFor: ReturnType<typeof readLaunchEfforts> | undefined;
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: TurnCompletedEntry;
      try {
        entry = JSON.parse(line) as TurnCompletedEntry;
      } catch {
        continue;
      }
      const usage = entry.usage;
      if (entry.event !== 'turn_completed' || !usage || typeof usage.model !== 'string' || !usage.model.startsWith('grok/')) continue;
      if (typeof entry.sessionId !== 'string' || !entry.sessionId || typeof entry.promptId !== 'string' || !entry.promptId) {
        skipped.push({ file, reason: 'no-request-id' });
        continue;
      }
      effortFor ??= readLaunchEfforts(agentId);
      events.push({
        ts: new Date(typeof entry.timestamp === 'string' ? entry.timestamp : 0),
        issueId: issueIdFromAgentName(agentId),
        agentId,
        sessionId: entry.sessionId,
        sessionType: 'grok',
        provider: 'custom',
        model: usage.model,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadTokens,
        cacheWrite: usage.cacheWriteTokens,
        cost: turnCost(usage),
        requestId: `grok:${entry.sessionId}:${entry.promptId}`,
        sourceFile: file,
        effort: effortFor(entry.sessionId) ?? null,
      });
    }
  }
  return { events, skipped, errors, scanned };
}
