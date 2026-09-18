import type { RuntimeName, TokenUsage } from '../../../lib/runtimes/types.js';
import { getGlobalRegistry } from '../../../lib/runtimes/index.js';

export interface RuntimeSessionProjection {
  harness: RuntimeName;
  lastActivity?: string;
  tokenUsage?: TokenUsage;
  cost?: number;
}

/**
 * Only runtimes that implement `getSessionMetrics` are projected. Falling back
 * to `getLastActivity` for the others would put a blocking directory scan on
 * the dashboard event loop for every agent row: claude-code resolves it through
 * `getSessionFilesSync`, a `readdirSync` plus a sort whose comparator calls
 * `statSync` twice per comparison (measured at 0.46 ms for a 36-file project
 * dir and 9.1 ms for a 510-file one). Those payloads carried no `lastActivity`,
 * `tokenUsage`, or `cost` before this projection existed, so skipping them
 * leaves every non-metrics harness exactly as it was.
 */
export function projectRuntimeSession(agentId: string, harness: RuntimeName): RuntimeSessionProjection {
  try {
    const runtime = getGlobalRegistry().get(harness);
    if (!runtime?.getSessionMetrics) return { harness };
    const metrics = runtime.getSessionMetrics(agentId);
    const lastActivity = metrics?.lastActivity;
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
