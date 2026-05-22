/**
 * Health filtering logic for dashboard health API
 * Determines which agents should be visible in health checks
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { Effect } from 'effect';
import { loadCloisterConfig } from '../../lib/cloister/config.js';
import { capturePaneAsyncEffect, sessionExistsAsyncEffect } from '../../lib/tmux.js';

/**
 * Check if agent tmux session is alive
 */
export async function checkAgentHealthAsync(agentId: string): Promise<{
  alive: boolean;
  lastOutput?: string;
  outputAge?: number;
}> {
  try {
    // Check if tmux session exists
    const alive = await Effect.runPromise(sessionExistsAsyncEffect(agentId));
    if (!alive) {
      return { alive: false };
    }

    // Get recent output to check if active
    const stdout = await Effect.runPromise(capturePaneAsyncEffect(agentId, 5));

    return { alive: true, lastOutput: stdout.trim() };
  } catch {
    return { alive: false };
  }
}

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
): Promise<{ status: 'healthy' | 'warning' | 'stuck' | 'dead'; reason?: string } | null> {
  // 1. Read state.json first — most agents are stopped/completed and exit here.
  let agentStatus: string | undefined;
  let lastActivity: Date | null = null;

  if (!existsSync(stateFile)) return null;

  try {
    const state = JSON.parse(await readFile(stateFile, 'utf-8'));
    agentStatus = state.status;
    lastActivity = state.lastActivity ? new Date(state.lastActivity) : null;
  } catch {
    // Corrupted state.json — treat as missing
    return null;
  }

  if (!agentStatus) return null;
  if (agentStatus === 'stopped' || agentStatus === 'completed') return null;

  // 2. Pull more recent lastActivity from runtime.json if present (hooks write here).
  const runtimeFile = stateFile.replace('state.json', 'runtime.json');
  if (existsSync(runtimeFile)) {
    try {
      const runtime = JSON.parse(await readFile(runtimeFile, 'utf-8'));
      if (runtime.lastActivity) {
        const runtimeDate = new Date(runtime.lastActivity);
        if (!lastActivity || runtimeDate > lastActivity) {
          lastActivity = runtimeDate;
        }
      }
    } catch {
      // Non-critical — use state.json lastActivity
    }
  }

  // 3. Check tmux liveness against the prefetched set — no per-agent subprocess.
  const alive = liveSessions.has(agentId);

  if (!alive) {
    // Status says running but no tmux session — only report 'dead' if recent.
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
}
