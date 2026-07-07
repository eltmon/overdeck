import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { listAgentStates, type AgentState } from '../../../../lib/agents.js';
import { listSessions } from '../../../../lib/tmux.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { getCurrentDockerStats } from './shared.js';

/** Build the GET /api/resources response from the SQLite agents table. */
export function getResourcesEffect(): Effect.Effect<ReturnType<typeof jsonResponse>, never, never> {
  return Effect.gen(function* () {
    const containers = getCurrentDockerStats();
    const stoppedContainers: unknown[] = [];

    // PAN-1908: authoritative agent registry is the SQLite agents table.
    // Read active agent states from the table and cross-check tmux liveness.
    const sessions = yield* listSessions().pipe(
      Effect.catch(() => Effect.succeed([])),
    );
    const tmuxSessionNames = new Set(sessions.map(s => s.name));
    const agents: Record<string, unknown>[] = listAgentStates()
      .filter((state: AgentState) => state.status !== 'stopped')
      .map((state: AgentState) => ({
        ...state,
        hasLiveTmuxSession: tmuxSessionNames.has(state.id),
      }));

    return jsonResponse({
      containers,
      stoppedContainers,
      networks: [],
      volumes: [],
      agents,
      updatedAt: new Date().toISOString(),
    });
  });
}

export const getResourcesRoute = HttpRouter.add(
  'GET',
  '/api/resources',
  httpHandler(getResourcesEffect()),
);
