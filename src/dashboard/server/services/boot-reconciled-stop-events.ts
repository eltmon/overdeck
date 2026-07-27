import type { DomainEvent } from '@overdeck/contracts';
import type { EventStore } from '../event-store.js';

export interface BootReconciledStop {
  id: string;
  previousStatus: string;
}

export async function emitBootReconciledStopEvents(
  store: Pick<EventStore, 'appendAsync'>,
  stopped: ReadonlyArray<BootReconciledStop>,
  presentAgents: Readonly<Record<string, unknown>>,
  errorMessage: string,
): Promise<void> {
  for (const { id, previousStatus } of stopped) {
    if (!presentAgents[id]) continue;
    try {
      await store.appendAsync({
        type: 'agent.status_changed',
        timestamp: new Date().toISOString(),
        payload: {
          agentId: id,
          status: 'stopped',
          previousStatus,
          hasLiveTmuxSession: false,
        },
      } as Omit<DomainEvent, 'sequence'>);
    } catch (err) {
      console.error(errorMessage, err);
    }
  }
}
