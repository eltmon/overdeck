import type { DomainEvent } from '@overdeck/contracts';
import { initEventStore } from '../dashboard/server/event-store.js';
import { getWorkspaceForIssue } from './workspaces/resolver.js';

export type OperatorInterventionKind = 'tell' | 'pause' | 'restart' | 'manual_edit' | 'deep_wipe' | 'unpause' | 'untroubled';

export interface OperatorInterventionInput {
  issueId: string;
  kind: OperatorInterventionKind;
  source: string;
  timestamp?: string;
}

/** PAN-1990 FR-15: additive workspaceId, populated when a workspace row exists for the issue. */
export function operatorInterventionEvent(input: OperatorInterventionInput): Omit<DomainEvent, 'sequence'> {
  return {
    type: 'operator.intervention',
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: {
      issueId: input.issueId,
      workspaceId: getWorkspaceForIssue(input.issueId)?.id,
      kind: input.kind,
      source: input.source,
    },
  } as Omit<DomainEvent, 'sequence'>;
}

export async function appendOperatorInterventionEvent(input: OperatorInterventionInput): Promise<void> {
  const store = await initEventStore();
  await store.appendAsync(operatorInterventionEvent(input));
}
