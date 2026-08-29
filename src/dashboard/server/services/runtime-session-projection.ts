import type { RuntimeName, TokenUsage } from '../../../lib/runtimes/types.js';
import { getGlobalRegistry } from '../../../lib/runtimes/index.js';

export interface RuntimeSessionProjection {
  harness: RuntimeName;
  lastActivity?: string;
  tokenUsage?: TokenUsage;
  cost?: number;
}

export function projectRuntimeSession(agentId: string, harness: RuntimeName): RuntimeSessionProjection {
  try {
    const runtime = getGlobalRegistry().get(harness);
    if (!runtime) return { harness };
    const metrics = runtime.getSessionMetrics?.(agentId);
    const lastActivity = metrics?.lastActivity ?? runtime.getLastActivity(agentId);
    const tokenUsage = metrics?.tokenUsage;
    const cost = metrics?.cost?.totalCost;
    return {
      harness,
      ...(lastActivity ? { lastActivity: lastActivity.toISOString() } : {}),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(cost !== undefined ? { cost } : {}),
    };
  } catch {
    return { harness };
  }
}
