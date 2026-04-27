import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { SessionNodePresence } from '@panctl/contracts';

/**
 * Derive session presence from runtime state, tmux session existence, and recent activity.
 * Aligns route consumers on the same heartbeat and output.log freshness checks.
 */
export async function deriveSessionPresence(
  agentId: string,
  rtState: { state: string } | null,
  tmuxSessionNames: Set<string>,
): Promise<SessionNodePresence> {
  const hasTmux = tmuxSessionNames.has(agentId);
  if (!hasTmux) return 'ended';

  if (!rtState) return 'idle';

  if (rtState.state === 'active') return 'active';
  if (rtState.state === 'suspended') return 'suspended';
  if (rtState.state === 'idle' || rtState.state === 'waiting-on-human') {
    const heartbeatPath = join(homedir(), '.panopticon', 'heartbeats', `${agentId}.json`);
    const hbStat = await stat(heartbeatPath).catch(() => null);
    if (hbStat && (Date.now() - hbStat.mtime.getTime()) < 5000) {
      return 'active';
    }

    const logPath = join(homedir(), '.panopticon', 'agents', agentId, 'output.log');
    const logStat = await stat(logPath).catch(() => null);
    if (logStat && (Date.now() - logStat.mtime.getTime()) < 5000) {
      return 'active';
    }

    return 'idle';
  }

  return 'ended';
}
