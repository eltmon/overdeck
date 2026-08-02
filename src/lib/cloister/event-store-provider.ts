import type { DomainEvent } from '@overdeck/contracts';

export interface CloisterEventStore {
  append(event: Omit<DomainEvent, 'sequence'>): number;
  subscribe?: (fn: (event: { type: string; payload?: unknown }) => void) => () => void;
}

let cloisterEventStoreProvider: (() => CloisterEventStore) | null = null;

export function setCloisterEventStoreProvider(provider: (() => CloisterEventStore) | null): void {
  cloisterEventStoreProvider = provider;
}

export function getCloisterEventStore(): CloisterEventStore | null {
  return cloisterEventStoreProvider?.() ?? null;
}
