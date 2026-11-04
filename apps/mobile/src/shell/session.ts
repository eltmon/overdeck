/**
 * The current machine the channel shims route to (PAN-4837 FR-8, D-3). `currentMachine()` is read
 * on every `/api/` request and `/ws/` socket; each dial opens a link channel through the shell's
 * connection. A dial that fails with a {@link ConnectionError} is published so the shell can show
 * the removed-machine screen or the failure text, until the next dial that succeeds.
 */
import type { ShimMachine } from '@overdeck/anywhere-channel/web';

import { type Connection, ConnectionError } from './connection';
import type { PairedMachine } from './types';

interface Session {
  machine: PairedMachine;
  connection: Pick<Connection, 'openLink'>;
}

let session: Session | null = null;
let lastError: ConnectionError | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Select the machine the shims route to, or none. Clears the last dial error. */
export function setSession(machine: PairedMachine | null, connection: Pick<Connection, 'openLink'> | null): void {
  session = machine && connection ? { machine, connection } : null;
  if (lastError !== null) {
    lastError = null;
    notify();
  }
}

export function currentMachine(): ShimMachine | null {
  const active = session;
  if (!active) return null;
  return {
    environmentId: active.machine.environmentId,
    bearerToken: active.machine.token,
    dial: async () => {
      try {
        const stream = await active.connection.openLink(active.machine);
        // A later dial that works clears the text of an earlier failure (PAN-5018).
        if (lastError !== null && session === active) {
          lastError = null;
          notify();
        }
        return stream;
      } catch (error) {
        if (error instanceof ConnectionError && session === active) {
          lastError = error;
          notify();
        }
        throw error;
      }
    },
  };
}

/** The last dial failure for the current machine, or null. */
export function lastDialError(): ConnectionError | null {
  return lastError;
}

export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
