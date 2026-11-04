/**
 * The worker wait for a local worker or a stand-in (PAN-4651 D-4651-6; moved
 * from `src/cli/commands/worker-remote.ts` by PAN-4938 D-4 so the dashboard's
 * self worker wait route can use it without importing CLI modules).
 *
 * Stand-in waits read `remote.json`: `running` is alive, `exited` / `stopped`
 * are confirmed dead, and an owner that cannot be reached is alive with no idle
 * age, so a sleeping desktop delays the report but never fails the wait.
 */
import type { LivenessVerdict } from '../liveness.js';
import { readRemoteStandIn, type RemoteStandIn } from './remote-standin.js';
import type { WaitDeps, WaitOptions, WaitOutcome } from './wait.js';

/** WaitDeps for a stand-in, read fresh from `remote.json` on every poll. */
export function standInWaitDeps(localId: string, read: (id: string) => Promise<RemoteStandIn | null> = readRemoteStandIn): WaitDeps {
  return {
    isAlive: async (): Promise<LivenessVerdict> => {
      const standIn = await read(localId);
      if (!standIn) return { alive: false, reason: 'runtime-indeterminate' };
      if (standIn.state === 'running' || standIn.unreachableSince !== null) return { alive: true, paneAlive: true };
      return { alive: false, reason: 'no-session' };
    },
    idleAgeMs: async () => {
      const standIn = await read(localId);
      return standIn && standIn.unreachableSince === null ? standIn.idleAgeMs : null;
    },
    fetchLastAssistantMessage: async () => (await read(localId))?.lastAssistantMessage ?? null,
    resolveTranscriptPath: async () => null,
  };
}

/** The wait every `pan worker run` / `wait` uses: a stand-in reads `remote.json`, a local worker the liveness oracle (or `localDeps`). */
export async function waitForAnyWorker(
  id: string,
  options: WaitOptions,
  wait: (id: string, options: WaitOptions, deps: WaitDeps) => Promise<WaitOutcome>,
  read: (id: string) => Promise<RemoteStandIn | null> = readRemoteStandIn,
  localDeps: WaitDeps = {},
): Promise<WaitOutcome> {
  return wait(id, options, (await read(id)) ? standInWaitDeps(id, read) : localDeps);
}
