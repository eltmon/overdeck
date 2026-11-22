/**
 * Shared ACP turn-usage cost sweep (PAN-5078 D9, extracted for PAN-5587): the
 * `turn_completed` entries the ACP host wrote into
 * `$OVERDECK_HOME/agents/<id>/acp-session.jsonl`, parsed into cost events for the
 * CostWriter `record()` door, which deduplicates by requestId. Each caller selects
 * its own entries with `matches` and prices them with `price`; the walk, the
 * parsing and the event shape are the same for every ACP vendor.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { EffortLevel } from '@overdeck/contracts';
import type { AcpTurnUsage } from '../acp/transcript.js';
import type { IssueId } from '../overdeck/issues.js';
import { acpTranscriptPath } from '../runtimes/storage/acp.js';
import { readLaunchEfforts } from '../session-history.js';

export interface AcpCollectedCostEvent<SessionType extends string, Provider extends string> {
  ts: Date;
  issueId: IssueId | null;
  agentId: string;
  sessionId: string;
  sessionType: SessionType;
  provider: Provider;
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

export interface AcpTurnUsageCollection<SessionType extends string, Provider extends string> {
  events: AcpCollectedCostEvent<SessionType, Provider>[];
  skipped: Array<{ file: string; reason: string }>;
  errors: string[];
  scanned: number;
}

export interface AcpTurnUsageCollectorOptions<SessionType extends string, Provider extends string> {
  readonly home: string;
  /** Selects the usage entries this collector owns. */
  readonly matches: (usage: AcpTurnUsage) => boolean;
  readonly sessionType: SessionType;
  /** Prefix of the `<prefix>:<sessionId>:<promptId>` request id the writer dedupes on. */
  readonly requestIdPrefix: string;
  readonly provider: Provider;
  readonly price: (usage: AcpTurnUsage) => number;
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

async function readTranscriptLines(file: string): Promise<string[] | null> {
  try {
    return (await readFile(file, 'utf8')).split('\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function collectAcpTurnUsageCostEvents<SessionType extends string, Provider extends string>(
  options: AcpTurnUsageCollectorOptions<SessionType, Provider>,
): Promise<AcpTurnUsageCollection<SessionType, Provider>> {
  const agentsRoot = join(options.home, 'agents');
  const events: AcpCollectedCostEvent<SessionType, Provider>[] = [];
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
      if (entry.event !== 'turn_completed' || !usage || typeof usage.model !== 'string' || !options.matches(usage)) continue;
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
        sessionType: options.sessionType,
        provider: options.provider,
        model: usage.model,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadTokens,
        cacheWrite: usage.cacheWriteTokens,
        cost: options.price(usage),
        requestId: `${options.requestIdPrefix}:${entry.sessionId}:${entry.promptId}`,
        sourceFile: file,
        effort: effortFor(entry.sessionId) ?? null,
      });
    }
  }
  return { events, skipped, errors, scanned };
}
