/**
 * Live connections held by registry credentials: a paired device or an access
 * token (PAN-3762 D-3762-10, PAN-2351 FR-4).
 *
 * Revoking a record in the access-token registry stops its next request, but
 * WebSockets and SSE streams authenticated once at connect time stay open. Each
 * such connection registers a close callback here under its record id, and the
 * revoking route calls `closeDeviceConnections(id)` right after the revocation
 * so every live connection of that record ends at once.
 */
import { Deferred, Effect, Stream } from 'effect';

import type { DashboardCredential } from './routes/dashboard-auth.js';

const connections = new Map<string, Set<() => void>>();

/** Register a close callback for a device connection. Returns its unregister function. */
export function registerDeviceConnection(deviceId: string, close: () => void): () => void {
  let set = connections.get(deviceId);
  if (!set) {
    set = new Set();
    connections.set(deviceId, set);
  }
  set.add(close);
  return () => {
    const current = connections.get(deviceId);
    if (!current) return;
    current.delete(close);
    if (current.size === 0) connections.delete(deviceId);
  };
}

/** Close every live connection of a device. Returns how many were closed. */
export function closeDeviceConnections(deviceId: string): number {
  const set = connections.get(deviceId);
  if (!set) return 0;
  connections.delete(deviceId);
  for (const close of set) {
    try {
      close();
    } catch (error) {
      console.error(`[device-connections] closing a connection of device ${deviceId} failed:`, error);
    }
  }
  return set.size;
}

/** The registry record id behind a revocable credential (device or token); null for root credentials. */
export function revocableCredentialId(credential: DashboardCredential | null): string | null {
  if (credential?.kind === 'device') return credential.deviceId;
  if (credential?.kind === 'token') return credential.tokenId;
  return null;
}

/**
 * End a stream (the `/events/stream` SSE body) when the device or token that
 * opened it is revoked. Streams opened with a root credential are returned as-is.
 */
export function endStreamOnDeviceRevocation<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  credential: DashboardCredential | null,
): Stream.Stream<A, E, R> {
  const recordId = revocableCredentialId(credential);
  if (recordId === null) return stream;
  // Register when the stream starts, so a stream that never runs leaves no entry.
  return Stream.unwrap(Effect.sync(() => {
    const revoked = Deferred.makeUnsafe<void>();
    const unregister = registerDeviceConnection(recordId, () => {
      Deferred.doneUnsafe(revoked, Effect.void);
    });
    return stream.pipe(
      Stream.interruptWhen(Deferred.await(revoked)),
      Stream.ensuring(Effect.sync(unregister)),
    );
  }));
}

/** Test-only: the number of registered connections for a device (all devices when omitted). */
export function _deviceConnectionCountForTests(deviceId?: string): number {
  if (deviceId !== undefined) return connections.get(deviceId)?.size ?? 0;
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}
