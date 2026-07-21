import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { AGENTS_DIR } from '../paths.js';
import { isPaneDead, killSession, listSessionNames } from '../tmux.js';
import { logDeaconEventSync } from '../persistent-logger.js';

function describeReason(hasStateFile: boolean, paneDead: boolean): string {
  if (!hasStateFile && paneDead) return 'missing state.json and pane is dead';
  if (!hasStateFile) return 'missing state.json';
  return 'pane is dead';
}

/**
 * PAN-1559: inspect sessions are sub-role tmux sessions named `inspect-*`.
 * Any live inspect pane without agent state is untracked compute, and a dead
 * inspect pane is a zombie. Kill either shape so Deacon does not rely on the
 * stale agent-state janitor to eventually notice the directory.
 */
export async function cleanupOrphanedInspectSessions(): Promise<string[]> {
  const actions: string[] = [];
  let inspectSessions: readonly string[];

  try {
    inspectSessions = (await Effect.runPromise(listSessionNames()))
      .filter(session => session.startsWith('inspect-'));
  } catch {
    return actions;
  }

  for (const session of inspectSessions) {
    const statePath = join(AGENTS_DIR, session, 'state.json');
    const hasStateFile = existsSync(statePath);
    const paneDead = await Effect.runPromise(isPaneDead(session)).catch(() => false);

    if (hasStateFile && !paneDead) continue;

    try {
      await Effect.runPromise(killSession(session)).catch(() => {});
    } catch {
      // best-effort; keep the patrol moving
    }

    const reason = describeReason(hasStateFile, paneDead);
    const msg = `Killed orphaned inspect session ${session} (${reason})`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEventSync(`cleanupOrphanedInspectSessions: ${msg}`);
  }

  if (actions.length > 0) {
    logDeaconEventSync(`cleanupOrphanedInspectSessions completed: killed ${actions.length} session(s)`);
  } else {
    logDeaconEventSync('cleanupOrphanedInspectSessions completed: no orphaned sessions found');
  }

  return actions;
}
