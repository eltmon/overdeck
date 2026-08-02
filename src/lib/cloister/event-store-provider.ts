import type { DomainEvent } from '@overdeck/contracts';

export interface CloisterEventStore {
  append(event: Omit<DomainEvent, 'sequence'>): number;
  subscribe?: (fn: (event: { type: string; payload?: unknown }) => void) => () => void;
}

let cloisterEventStoreProvider: (() => CloisterEventStore) | null = null;

export function setCloisterEventStoreProvider(provider: (() => CloisterEventStore) | null): void {
  cloisterEventStoreProvider = provider;
}

/**
 * Read door for the process-local cloister event store (set by deacon-main in
 * the deacon-child process). Cloister modules that emit domain events outside
 * the service host append through this — never to the DB directly. Returns
 * null when no provider is wired (CLI/test contexts).
 */
export function getCloisterEventStore(): CloisterEventStore | null {
  return cloisterEventStoreProvider?.() ?? null;
}
