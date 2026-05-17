import { parentPort } from 'node:worker_threads';
import {
  aggregateDiscoveredSessionCost,
  aggregateDiscoveredSessionCostBy,
  countDiscoveredSessions,
  findDiscoveredSessions,
  getDiscoveredSessionById,
  getDiscoveredStats,
} from '../../../lib/database/discovered-sessions-db.js';
import type { ConversationFilter } from '../../../lib/database/discovered-sessions-db.js';
import { searchSessions } from '../../../lib/conversations/search.js';
import type { SearchQuery } from '../../../lib/conversations/search.js';
import { scan } from '../../../lib/conversations/scanner.js';
import type { ScanOptions } from '../../../lib/conversations/scanner.js';
import { enrichSessions, CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import type { EnrichOptions } from '../../../lib/conversations/enrichment/index.js';
import { embedSessions } from '../../../lib/conversations/embeddings/index.js';
import type { EmbedSessionsOptions } from '../../../lib/conversations/embeddings/index.js';

type DashboardDbOperation =
  | 'getDiscoveredStats'
  | 'listDiscoveredSessions'
  | 'getDiscoveredSessionById'
  | 'aggregateDiscoveredSessionCost'
  | 'aggregateDiscoveredSessionCostBy'
  | 'searchSessions'
  | 'scanConversations'
  | 'enrichSessions'
  | 'embedSessions';

interface DashboardDbRequest {
  id: string;
  operation: DashboardDbOperation;
  payload: unknown;
}

async function runJob(
  id: string,
  operation: DashboardDbOperation,
  payload: unknown,
): Promise<unknown> {
  const emitProgress = (progress: unknown) => {
    parentPort?.postMessage({ id, progress });
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
    case 'getDiscoveredSessionById':
      return getDiscoveredSessionById(payload as number);
    case 'aggregateDiscoveredSessionCost':
      return aggregateDiscoveredSessionCost(payload as ConversationFilter);
    case 'aggregateDiscoveredSessionCostBy':
      return aggregateDiscoveredSessionCostBy(payload as 'workspace' | 'model' | 'day' | 'tier');
    case 'searchSessions':
      return searchSessions(payload as SearchQuery);
    case 'scanConversations':
      return scan({ ...(payload as ScanOptions), onProgress: emitProgress });
    case 'enrichSessions':
      return enrichSessions({ ...(payload as EnrichOptions), onProgress: emitProgress });
    case 'embedSessions':
      return embedSessions(payload as EmbedSessionsOptions);
  }
}

const queue: DashboardDbRequest[] = [];
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 1;

async function execute(message: DashboardDbRequest): Promise<void> {
  try {
    const result = await runJob(message.id, message.operation, message.payload);
    parentPort?.postMessage({ id: message.id, ok: true, result });
  } catch (err) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
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
  while (activeJobs < MAX_CONCURRENT_JOBS) {
    const next = queue.shift();
    if (!next) return;
    activeJobs++;
    void execute(next).finally(() => {
      activeJobs--;
      drainQueue();
    });
  }
}

parentPort?.on('message', (message: DashboardDbRequest) => {
  queue.push(message);
  drainQueue();
});
