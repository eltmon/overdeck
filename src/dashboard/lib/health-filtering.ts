/**
 * Health filtering logic for dashboard health API
 * Determines which agents should be visible in health checks
 */

import { readFileSync, existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
    await execAsync(`tmux has-session -t "${agentId}" 2>/dev/null`);

    // Get recent output to check if active
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${agentId}" -p -S -5 2>/dev/null`,
      { maxBuffer: 1024 * 1024 }
    );

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

  // Read state.json once (used for both status check and activity check)
  let agentStatus: string | undefined;
  let lastActivity: Date | null = null;

  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      agentStatus = state.status;
      lastActivity = state.lastActivity ? new Date(state.lastActivity) : null;
    } catch {
      // Silently ignore corrupted state.json - treat as missing/test artifact
      // Agent will be excluded from health checks
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

    // Status is "running" or "in_progress" but no tmux - actual crash
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
