/**
 * Health filtering logic for dashboard health API
 * Determines which agents should be visible in health checks
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

import { Effect } from 'effect';

import { loadCloisterConfig } from '../../lib/cloister/config.js';
import { capturePaneAsyncEffect, sessionExistsAsyncEffect } from '../../lib/tmux.js';

type AgentHealth = {
  alive: boolean;
  lastOutput?: string;
  outputAge?: number;
};

type AgentHealthStatus = { status: 'healthy' | 'warning' | 'stuck' | 'dead'; reason?: string } | null;

export const checkAgentHealthEffect = (agentId: string): Effect.Effect<AgentHealth> =>
  Effect.gen(function* () {
    const alive = yield* sessionExistsAsyncEffect(agentId);
    if (!alive) {
      return { alive: false };
    }

    const stdout = yield* capturePaneAsyncEffect(agentId, 5);
    return { alive: true, lastOutput: stdout.trim() };
  }).pipe(Effect.catch(() => Effect.succeed({ alive: false })));

/**
 * Check if agent tmux session is alive
 */
export async function checkAgentHealthAsync(agentId: string): Promise<AgentHealth> {
  return Effect.runPromise(checkAgentHealthEffect(agentId));
}

export const determineHealthStatusEffect = (
  agentId: string,
  stateFile: string,
  liveSessions: Set<string>,
): Effect.Effect<AgentHealthStatus> => Effect.gen(function* () {
  let agentStatus: string | undefined;
  let lastActivity: Date | null = null;

  if (!existsSync(stateFile)) return null;

  const stateText = yield* Effect.tryPromise(() => readFile(stateFile, 'utf-8')).pipe(
    Effect.catch(() => Effect.succeed(null)),
  );
  if (!stateText) return null;

  try {
    const state = JSON.parse(stateText);
    agentStatus = state.status;
    lastActivity = state.lastActivity ? new Date(state.lastActivity) : null;
  } catch {
    return null;
  }

  if (!agentStatus) return null;
  if (agentStatus === 'stopped' || agentStatus === 'completed') return null;

  const runtimeFile = stateFile.replace('state.json', 'runtime.json');
  if (existsSync(runtimeFile)) {
    const runtimeText = yield* Effect.tryPromise(() => readFile(runtimeFile, 'utf-8')).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (runtimeText) {
      try {
        const runtime = JSON.parse(runtimeText);
        if (runtime.lastActivity) {
          const runtimeDate = new Date(runtime.lastActivity);
          if (!lastActivity || runtimeDate > lastActivity) {
            lastActivity = runtimeDate;
          }
        }
      } catch {}
    }
  }

  const alive = liveSessions.has(agentId);

  if (!alive) {
    const cloisterConfig = loadCloisterConfig();
    const stalenessHours = cloisterConfig.retention?.health_staleness_hours ?? 24;
    const STALE_THRESHOLD_MS = stalenessHours * 60 * 60 * 1000;
    if (lastActivity) {
      const ageMs = Date.now() - lastActivity.getTime();
      if (ageMs > STALE_THRESHOLD_MS) return null;
    } else {
      return null;
    }
    return { status: 'dead', reason: 'Agent crashed unexpectedly' };
  }

  if (lastActivity) {
    const ageMs = Date.now() - lastActivity.getTime();
    const ageMinutes = ageMs / (1000 * 60);

    if (ageMinutes > 30) {
      return { status: 'stuck', reason: `No activity for ${Math.round(ageMinutes)} minutes` };
    } else if (ageMinutes > 15) {
      return { status: 'warning', reason: `Low activity (${Math.round(ageMinutes)} minutes)` };
    }
  }

  return { status: 'healthy' };
});

/**
 * Determine health status based on activity
 * Returns null if agent should be hidden (completed/stopped/no state.json)
 *
 * `liveSessions` is REQUIRED — pass the result of `getAgentSessionsAsync()`
 * fetched once per request. Iterating ~150 agent dirs and spawning a tmux
 * subprocess per agent (sessionExistsAsync + capturePaneAsync) was pinning
 * the dashboard process at 100% CPU on every 5s `/api/health/agents` poll.
 * State is also read before the tmux check so stopped/completed/missing
 * agents short-circuit without any extra work.
 */
export async function determineHealthStatusAsync(
  agentId: string,
  stateFile: string,
  liveSessions: Set<string>
): Promise<AgentHealthStatus> {
  return Effect.runPromise(determineHealthStatusEffect(agentId, stateFile, liveSessions));
}
