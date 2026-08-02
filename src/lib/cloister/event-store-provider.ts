/** Process-local event-store provider shared by Cloister services and patrol modules. */
import type { DomainEvent } from '@overdeck/contracts';

export interface CloisterEventStoreEvent {
  type: string;
  payload?: unknown;
}

export interface CloisterEventStore {
  append(event: Omit<DomainEvent, 'sequence'>): number;
  subscribe?: (fn: (event: CloisterEventStoreEvent) => void) => () => void;
}

let cloisterEventStoreProvider: (() => CloisterEventStore) | null = null;

export function setCloisterEventStoreProvider(provider: (() => CloisterEventStore) | null): void {
  cloisterEventStoreProvider = provider;
}

/** Return the injected event store, or null in CLI and isolated test contexts. */
export function getCloisterEventStore(): CloisterEventStore | null {
  return cloisterEventStoreProvider?.() ?? null;
}
