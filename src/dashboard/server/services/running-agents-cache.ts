import { listRunningAgentsAsync } from '../../../lib/agents.js';

const RUNNING_AGENTS_CACHE_TTL_MS = 3_000;
const GLOBAL_RUNNING_AGENTS_CACHE_KEY = '__all_agents__';

const runningAgentsCache = new Map<string, {
  timestamp: number;
  agents: Awaited<ReturnType<typeof listRunningAgentsAsync>>;
}>();
let inflightRunningAgents:
  | Promise<Awaited<ReturnType<typeof listRunningAgentsAsync>>>
  | null = null;

function sweepExpired<T extends { timestamp: number }>(cache: Map<string, T>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;
  for (const [key, entry] of cache) {
    if (entry.timestamp < cutoff) {
      cache.delete(key);
    }
  }
}

export async function getCachedRunningAgents(
  listAgents: typeof listRunningAgentsAsync = listRunningAgentsAsync,
): Promise<Awaited<ReturnType<typeof listRunningAgentsAsync>>> {
  sweepExpired(runningAgentsCache, RUNNING_AGENTS_CACHE_TTL_MS);
  const cached = runningAgentsCache.get(GLOBAL_RUNNING_AGENTS_CACHE_KEY);
  if (cached && cached.timestamp > Date.now() - RUNNING_AGENTS_CACHE_TTL_MS) {
    return cached.agents;
  }

  if (!inflightRunningAgents) {
    inflightRunningAgents = listAgents().then((agents) => {
      runningAgentsCache.set(GLOBAL_RUNNING_AGENTS_CACHE_KEY, {
        timestamp: Date.now(),
        agents,
      });
      return agents;
    }).finally(() => {
      inflightRunningAgents = null;
    });
  }

  return inflightRunningAgents;
}

export function clearRunningAgentsCache(): void {
  runningAgentsCache.clear();
  inflightRunningAgents = null;
}
