import { Effect } from 'effect';
import type { ServerBootProperties, TelemetryCountBucket } from '@overdeck/contracts';
import { listRunningAgents } from '../../lib/agents.js';
import { listProjectsSync } from '../../lib/projects.js';
import { isListedOrRunning, listLiveAgentIds } from '../../lib/terminal-backends/inventory.js';
import { getAnalyticsService } from '../../lib/telemetry/service.js';

interface ServerBootTelemetryDeps {
  analytics: {
    capture: (event: 'server_boot', properties: ServerBootProperties) => void;
  };
  listProjects: () => readonly unknown[];
  /** Agent rows marked with whether they have a live pane on the selected backend (Herdr or tmux). */
  listAgents: () => Promise<ReadonlyArray<{ hasLivePane: boolean }>>;
}

const serverAnalytics = getAnalyticsService('server');

/**
 * Live = in the selected backend's inventory, not the tmux-only tmuxActive
 * flag (#4109); an unreadable inventory counts the running rows.
 */
export async function listBootTelemetryAgents(): Promise<Array<{ hasLivePane: boolean }>> {
  const [agents, liveIds] = await Promise.all([Effect.runPromise(listRunningAgents()), listLiveAgentIds()]);
  return agents.map((agent) => ({ hasLivePane: isListedOrRunning(agent, liveIds) }));
}

const defaultDeps: ServerBootTelemetryDeps = {
  analytics: serverAnalytics,
  listProjects: listProjectsSync,
  listAgents: listBootTelemetryAgents,
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
        agents.filter((agent) => agent.hasLivePane).length,
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
