/**
 * Health filtering logic for dashboard health API
 * Determines which agents should be visible in health checks
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { loadCloisterConfig } from '../../lib/cloister/config.js';
import { capturePaneAsync, sessionExistsAsync } from '../../lib/tmux.js';

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
    const alive = await sessionExistsAsync(agentId);
    if (!alive) {
      return { alive: false };
    }

    // Get recent output to check if active
    const stdout = await capturePaneAsync(agentId, 5);

    return { alive: true, lastOutput: stdout.trim() };
  } catch {
    return { alive: false };
  }
}

/**
 * Determine health status based on activity
 * Returns null if agent should be hidden (completed/stopped/no state.json)
 */
export async function determineHealthStatusAsync(
  agentId: string,
  stateFile: string
): Promise<{ status: 'healthy' | 'warning' | 'stuck' | 'dead'; reason?: string } | null> {
  const health = await checkAgentHealthAsync(agentId);

  // Read state.json for config (status) and runtime.json for heartbeat (lastActivity)
  let agentStatus: string | undefined;
  let lastActivity: Date | null = null;

  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf-8'));
      agentStatus = state.status;
      // Legacy: lastActivity may still be in state.json
      lastActivity = state.lastActivity ? new Date(state.lastActivity) : null;
    } catch {
      // Silently ignore corrupted state.json - treat as missing/test artifact
      // Agent will be excluded from health checks
    }
  }

  // Check runtime.json for more recent lastActivity (hooks write here now)
  const runtimeFile = stateFile.replace('state.json', 'runtime.json');
  if (existsSync(runtimeFile)) {
    try {
      const runtime = JSON.parse(await readFile(runtimeFile, 'utf-8'));
      if (runtime.lastActivity) {
        const runtimeDate = new Date(runtime.lastActivity);
        // Use whichever is more recent
        if (!lastActivity || runtimeDate > lastActivity) {
          lastActivity = runtimeDate;
        }
      }
    } catch {
      // Non-critical — use state.json lastActivity
    }
  }

  // No tmux session - check state.json to determine if crash or intentional
  if (!health.alive) {
    // No state.json or corrupted - exclude (test artifact or corrupted)
    if (!agentStatus) {
      return null;
    }

    // Intentionally stopped or completed - exclude
    if (agentStatus === 'stopped' || agentStatus === 'completed') {
      return null;
    }

    // Status is "running" or "in_progress" but no tmux — check staleness
    // Only report as "dead" if the agent was active recently
    // Older stale state files are hidden to avoid cluttering the health view
    const cloisterConfig = loadCloisterConfig();
    const stalenessHours = cloisterConfig.retention?.health_staleness_hours ?? 24;
    const STALE_THRESHOLD_MS = stalenessHours * 60 * 60 * 1000;
    if (lastActivity) {
      const ageMs = Date.now() - lastActivity.getTime();
      if (ageMs > STALE_THRESHOLD_MS) {
        return null; // Stale — hide from health view
      }
    } else {
      // No lastActivity at all — ancient state file, hide it
      return null;
    }

    return { status: 'dead', reason: 'Agent crashed unexpectedly' };
  }

  // Tmux session exists - check activity based on lastActivity
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
