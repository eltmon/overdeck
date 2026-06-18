import type { DomainEvent } from '@overdeck/contracts';
import { initEventStore } from '../dashboard/server/event-store.js';

export type OperatorInterventionKind = 'tell' | 'pause' | 'restart' | 'manual_edit' | 'deep_wipe' | 'unpause' | 'untroubled';

export interface OperatorInterventionInput {
  issueId: string;
  kind: OperatorInterventionKind;
  source: string;
  timestamp?: string;
}

export function operatorInterventionEvent(input: OperatorInterventionInput): Omit<DomainEvent, 'sequence'> {
  return {
    type: 'operator.intervention',
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: {
      issueId: input.issueId,
      kind: input.kind,
      source: input.source,
    },
  } as Omit<DomainEvent, 'sequence'>;
}

export async function appendOperatorInterventionEvent(input: OperatorInterventionInput): Promise<void> {
  const store = await initEventStore();
  await store.appendAsync(operatorInterventionEvent(input));
}
