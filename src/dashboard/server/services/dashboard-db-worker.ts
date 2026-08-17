import { parentPort } from 'node:worker_threads';
import {
  aggregateDiscoveredSessionCost,
  aggregateDiscoveredSessionCostBy,
  countDiscoveredSessions,
  findDiscoveredSessions,
  getDiscoveredSessionById,
  getDiscoveredStats,
} from '../../../lib/overdeck/discovered-sessions.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { getSetting, setSetting } from '../../../lib/overdeck/control-settings.js';
import type { ConversationFilter } from '../../../lib/overdeck/discovered-sessions.js';
import { getSessionsFeedFacets, listSessionsFeed } from '../../../lib/overdeck/sessions-feed.js';
import type { SessionsFeedFilter } from '../../../lib/overdeck/sessions-feed.js';
import { searchSessions } from '../../../lib/conversations/search.js';
import type { SearchQuery } from '../../../lib/conversations/search.js';
import { scan } from '../../../lib/conversations/scanner.js';
import type { ScanOptions } from '../../../lib/conversations/scanner.js';
import { enrichSessions, CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import type { EnrichOptions } from '../../../lib/conversations/enrichment/index.js';
import { embedSessions } from '../../../lib/conversations/embeddings/index.js';
import type { EmbedSessionsOptions } from '../../../lib/conversations/embeddings/index.js';
import { listSubstrateBugWeights } from '../../../lib/overdeck/substrate-bug-weights-service.js';
import { collectCodexCostEvents } from '../../../lib/overdeck/cost.js';
import { collectPiCostEvents } from '../../../lib/costs/reconciler.js';
import { parseAcpConversationMessages } from './acp-conversation-parser.js';
import { parseCodexConversationMessages } from './codex-conversation-parser.js';
import { parseKimiConversationMessages } from './kimi-conversation-parser.js';
import { parseOhmypiConversationMessages } from './ohmypi-conversation-parser.js';
import { parsePiConversationMessages } from './pi-conversation-parser.js';
import { parseEntireConversation } from './conversation-service.js';
import type { ParseResult } from './conversation-service.js';

type DashboardDbOperation =
  | 'getDiscoveredStats'
  | 'listDiscoveredSessions'
  | 'listSessionsFeed'
  | 'getSessionsFeedFacets'
  | 'getDiscoveredSessionById'
  | 'aggregateDiscoveredSessionCost'
  | 'aggregateDiscoveredSessionCostBy'
  | 'searchSessions'
  | 'searchSessionsSemantic'
  | 'scanConversations'
  | 'enrichSessions'
  | 'embedSessions'
  | 'getConversationByName'
  | 'getSetting'
  | 'setSetting'
  | 'listSubstrateBugWeights'
  | 'getArtifactBySlug'
  | 'listArtifactsForWorkspaceOrIssue'
  | 'unshareArtifactBySlug'
  | 'parseTranscriptSnapshot'
  | 'costReconcileSweep';

type TranscriptParserName = 'pi' | 'ohmypi' | 'codex' | 'acp' | 'kimi' | 'claude-initial';
type TranscriptParser = (sessionFile: string) => Promise<ParseResult>;

const transcriptParsers: Record<TranscriptParserName, TranscriptParser> = {
  pi: parsePiConversationMessages,
  ohmypi: parseOhmypiConversationMessages,
  codex: parseCodexConversationMessages,
  acp: parseAcpConversationMessages,
  kimi: parseKimiConversationMessages,
  'claude-initial': sessionFile => parseEntireConversation(sessionFile, { flushPendingToolUse: false }),
};

interface DashboardDbRequest {
  id: string;
  operation: DashboardDbOperation;
  payload: unknown;
}

interface DashboardDbAck {
  id: string;
  ack: number;
}

const progressAcks = new Map<string, () => void>();
let progressSequence = 0;

function aggregateDiscoveredSessionCostByPayload(payload: unknown) {
  if (typeof payload === 'string') {
    return aggregateDiscoveredSessionCostBy(payload as 'workspace' | 'model' | 'day' | 'month');
  }
  const input = payload as { groupBy?: 'workspace' | 'model' | 'day' | 'month'; filter?: ConversationFilter } | undefined;
  return aggregateDiscoveredSessionCostBy(input?.groupBy ?? 'workspace', input?.filter ?? {});
}

async function runJob(
  id: string,
  operation: DashboardDbOperation,
  payload: unknown,
): Promise<unknown> {
  const emitProgress = (progress: unknown): Promise<void> => {
    const progressSeq = ++progressSequence;
    return new Promise(resolve => {
      progressAcks.set(`${id}:${progressSeq}`, resolve);
      parentPort?.postMessage({ id, progress, progressSeq });
    });
  };

  switch (operation) {
    case 'getDiscoveredStats':
      return getDiscoveredStats();
    case 'listDiscoveredSessions': {
      const filter = payload as ConversationFilter;
      return {
        sessions: findDiscoveredSessions(filter),
        total: countDiscoveredSessions({ ...filter, limit: undefined, offset: undefined }),
      };
    }
    case 'listSessionsFeed':
      return listSessionsFeed(payload as SessionsFeedFilter);
    case 'getSessionsFeedFacets':
      return getSessionsFeedFacets(payload as SessionsFeedFilter);
    case 'getDiscoveredSessionById':
      return getDiscoveredSessionById(payload as number);
    case 'aggregateDiscoveredSessionCost':
      return aggregateDiscoveredSessionCost(payload as ConversationFilter);
    case 'aggregateDiscoveredSessionCostBy':
      return aggregateDiscoveredSessionCostByPayload(payload);
    case 'searchSessions':
    case 'searchSessionsSemantic':
      return searchSessions(payload as SearchQuery);
    case 'scanConversations':
      return scan({ ...(payload as ScanOptions), onProgress: emitProgress });
    case 'enrichSessions':
      return enrichSessions({ ...(payload as EnrichOptions), onProgress: emitProgress });
    case 'embedSessions':
      return embedSessions({ ...(payload as EmbedSessionsOptions), autoInstall: true, onProgress: emitProgress });
    case 'getConversationByName':
      return getConversationByName(payload as string);
    case 'parseTranscriptSnapshot': {
      const input = payload as { sessionFile: string; parser: string };
      const parser = transcriptParsers[input.parser as TranscriptParserName];
      if (!parser) throw new Error(`Unknown transcript parser: ${input.parser}`);
      return parser(input.sessionFile);
    }
    case 'getSetting':
      return getSetting(payload as string);
    case 'setSetting': {
      const input = payload as { key: string; value: string };
      setSetting(input.key, input.value);
      return null;
    }
    case 'listSubstrateBugWeights': {
      const input = payload as { window: string; limit: number; offset: number };
      return listSubstrateBugWeights(input.window, { limit: input.limit, offset: input.offset });
    }
    case 'getArtifactBySlug': {
      const { getArtifactBySlugJob } = await import('./artifact-index-jobs.js');
      return getArtifactBySlugJob(payload as string);
    }
    case 'listArtifactsForWorkspaceOrIssue': {
      const { listArtifactsForWorkspaceOrIssueJob } = await import('./artifact-index-jobs.js');
      return listArtifactsForWorkspaceOrIssueJob(payload as string);
    }
    case 'unshareArtifactBySlug': {
      const { unshareArtifactBySlugJob } = await import('./artifact-index-jobs.js');
      return unshareArtifactBySlugJob(payload as string);
    }
    case 'costReconcileSweep':
      return (payload as { source: 'codex' | 'pi' }).source === 'pi'
        ? collectPiCostEvents({ ...(payload as { maxEvents?: number }), onBatch: emitProgress })
        : collectCodexCostEvents({ ...(payload as { maxEvents?: number }), onBatch: emitProgress });
  }
}

const queue: DashboardDbRequest[] = [];
let activeJobs = 0;
const MAX_CONCURRENT_JOBS_PER_LANE = 1;

async function execute(message: DashboardDbRequest): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await runJob(message.id, message.operation, message.payload);
    const bytes = message.operation === 'parseTranscriptSnapshot'
      ? (result as ParseResult).byteOffset
      : undefined;
    parentPort?.postMessage({ id: message.id, ok: true, result, startedAt, finishedAt: Date.now(), bytes });
  } catch (err) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
      startedAt,
      finishedAt: Date.now(),
      error: {
        name: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        estimatedCost: err instanceof CostThresholdError ? err.estimatedCost : undefined,
        threshold: err instanceof CostThresholdError ? err.threshold : undefined,
        sessionCount: err instanceof CostThresholdError ? err.sessionCount : undefined,
      },
    });
  }
}

function drainQueue(): void {
  while (activeJobs < MAX_CONCURRENT_JOBS_PER_LANE) {
    const next = queue.shift();
    if (!next) return;
    activeJobs++;
    void execute(next).finally(() => {
      activeJobs--;
      drainQueue();
    });
  }
}

parentPort?.on('message', (message: DashboardDbRequest | DashboardDbAck) => {
  if ('ack' in message) {
    const resolve = progressAcks.get(`${message.id}:${message.ack}`);
    progressAcks.delete(`${message.id}:${message.ack}`);
    resolve?.();
    return;
  }
  queue.push(message);
  drainQueue();
});
