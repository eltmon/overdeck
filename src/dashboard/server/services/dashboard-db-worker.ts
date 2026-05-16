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

type DashboardDbOperation =
  | 'getDiscoveredStats'
  | 'listDiscoveredSessions'
  | 'getDiscoveredSessionById'
  | 'aggregateDiscoveredSessionCost'
  | 'aggregateDiscoveredSessionCostBy'
  | 'searchSessions';

interface DashboardDbRequest {
  id: string;
  operation: DashboardDbOperation;
  payload: unknown;
}

async function runJob(operation: DashboardDbOperation, payload: unknown): Promise<unknown> {
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
  }
}

parentPort?.on('message', async (message: DashboardDbRequest) => {
  try {
    const result = await runJob(message.operation, message.payload);
    parentPort?.postMessage({ id: message.id, ok: true, result });
  } catch (err) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
      error: {
        name: err instanceof Error ? err.name : 'Error',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
  }
});
