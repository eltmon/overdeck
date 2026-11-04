/**
 * Deacon-lite's remote reap (PAN-4295): hand finished Fly remote agents to
 * review. Restores the PAN-1676 patrol call the Cut dropped. One reap at a
 * time: a tick that fires while the previous reap is still materializing a
 * worktree is skipped, never run in parallel.
 */
import { emitActivityEntry } from '../activity-logger.js';

let reapInFlight = false;

export async function reapFinishedRemoteAgents(): Promise<string[]> {
  if (reapInFlight) return [];
  reapInFlight = true;
  try {
    // Dynamic import keeps the Fly module graph out of deacon-lite's static imports.
    const { reapCompletedRemoteAgents } = await import('../remote/remote-completion.js');
    const actions: string[] = [];
    for (const r of await reapCompletedRemoteAgents()) {
      if (r.status !== 'handed-off' && r.status !== 'error') continue;
      const message = `Remote reap ${r.issueId}: ${r.status} (${r.details.join('; ')})`;
      actions.push(message);
      console.log(`[deacon-lite] ${message}`);
      emitActivityEntry({ source: 'cloister', level: r.status === 'error' ? 'warn' : 'info', message });
    }
    return actions;
  } finally {
    reapInFlight = false;
  }
}
