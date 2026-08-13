import type { RuntimeName, TokenUsage } from '../../../lib/runtimes/types.js';
import { getGlobalRegistry } from '../../../lib/runtimes/index.js';

export interface RuntimeSessionProjection {
  harness: RuntimeName;
  lastActivity?: string;
  tokenUsage?: TokenUsage;
  cost?: number;
}

export function projectRuntimeSession(agentId: string, harness: RuntimeName): RuntimeSessionProjection {
  const runtime = getGlobalRegistry().get(harness);
  if (!runtime) return { harness };
  const lastActivity = runtime.getLastActivity(agentId);
  const tokenUsage = runtime.getTokenUsage(agentId);
  const cost = runtime.getSessionCost(agentId)?.totalCost;
  return {
    harness,
    ...(lastActivity ? { lastActivity: lastActivity.toISOString() } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}
