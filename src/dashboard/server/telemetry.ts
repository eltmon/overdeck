import { Effect } from 'effect';
import type { ServerBootProperties, TelemetryCountBucket } from '@overdeck/contracts';
import { listRunningAgents } from '../../lib/agents.js';
import { listProjectsSync } from '../../lib/projects.js';
import { getAnalyticsService } from '../../lib/telemetry/service.js';

interface ServerBootTelemetryDeps {
  analytics: {
    capture: (event: 'server_boot', properties: ServerBootProperties) => void;
  };
  listProjects: () => readonly unknown[];
  listAgents: () => Promise<ReadonlyArray<{ tmuxActive: boolean }>>;
}

const serverAnalytics = getAnalyticsService('server');

const defaultDeps: ServerBootTelemetryDeps = {
  analytics: serverAnalytics,
  listProjects: listProjectsSync,
  listAgents: () => Effect.runPromise(listRunningAgents()),
};

export function bucketServerCount(value: number): TelemetryCountBucket {
  if (value <= 0) return '0';
  if (value <= 2) return '1-2';
  if (value <= 5) return '3-5';
  if (value <= 10) return '6-10';
  return '11+';
}

export async function captureServerBootTelemetry(
  deps: ServerBootTelemetryDeps = defaultDeps,
): Promise<void> {
  try {
    const [projects, agents] = await Promise.all([
      Promise.resolve(deps.listProjects()),
      deps.listAgents(),
    ]);
    deps.analytics.capture('server_boot', {
      project_count: bucketServerCount(projects.length),
      active_agent_count: bucketServerCount(
        agents.filter((agent) => agent.tmuxActive).length,
      ),
    });
  } catch {
    // Telemetry must never delay or fail dashboard boot.
  }
}

export function startServerBootTelemetry(
  deps: ServerBootTelemetryDeps = defaultDeps,
): void {
  void captureServerBootTelemetry(deps);
}
