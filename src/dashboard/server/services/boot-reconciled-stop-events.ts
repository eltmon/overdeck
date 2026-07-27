import type { DomainEvent } from '@overdeck/contracts';
import type { EventStore } from '../event-store.js';

export interface BootReconciledStop {
  id: string;
  previousStatus: string;
}

const appendByStore = new WeakMap<object, Map<string, Promise<boolean>>>();

async function appendStopOnce(
  store: Pick<EventStore, 'appendAsync'>,
  stop: BootReconciledStop,
  errorMessage: string,
): Promise<void> {
  const pendingByKey = appendByStore.get(store) ?? new Map<string, Promise<boolean>>();
  appendByStore.set(store, pendingByKey);
  const key = `${stop.id}:${stop.previousStatus}`;
  const existing = pendingByKey.get(key);
  if (existing && await existing) return;

  const pending = (async () => {
    try {
      const sequence = await store.appendAsync({
        type: 'agent.status_changed',
        timestamp: new Date().toISOString(),
        payload: {
          agentId: stop.id,
          status: 'stopped',
          previousStatus: stop.previousStatus,
          hasLiveTmuxSession: false,
        },
      } as Omit<DomainEvent, 'sequence'>);
      if (sequence <= 0) throw new Error(`Event append returned invalid sequence ${sequence}`);
      return true;
    } catch (err) {
      console.error(errorMessage, err);
      return false;
    }
  })();
  pendingByKey.set(key, pending);
  if (!await pending && pendingByKey.get(key) === pending) pendingByKey.delete(key);
}

export async function emitBootReconciledStopEvents(
  store: Pick<EventStore, 'appendAsync'>,
  stopped: ReadonlyArray<BootReconciledStop>,
  presentAgents: Readonly<Record<string, unknown>>,
  errorMessage: string,
): Promise<void> {
  for (const stop of stopped) {
    if (!presentAgents[stop.id]) continue;
    await appendStopOnce(store, stop, errorMessage);
  }
}
