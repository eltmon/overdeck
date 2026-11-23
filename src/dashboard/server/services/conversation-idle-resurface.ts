/**
 * PAN-5611 FR-1: an accepted operator message ends an 'idle' settle on the
 * messaged conversation and on its display root (handoff and /clear successors
 * are display children of the settled original). Manual and merge settles stay.
 */
import { listConversations, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { displayRootNameOf } from '../../../lib/overdeck/conversation-idle-settle.js';
import { resurfaceIdleSettledConversation } from '../../../lib/overdeck/conversation-triage-store.js';
import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import { emitConversationSchedulesChanged } from '../../../lib/overdeck/conversation-schedules.js';

export interface ResurfaceAfterMessageDeps {
  listRows: () => LegacyConversation[];
  resurface: (name: string) => boolean;
  invalidate: () => void;
  emitChanged: (name: string) => void;
}

const defaultDeps: ResurfaceAfterMessageDeps = {
  listRows: listConversations,
  resurface: (name) => resurfaceIdleSettledConversation(name),
  invalidate: invalidateConversationListEnrichmentCache,
  emitChanged: emitConversationSchedulesChanged,
};

/** PAN-5611 FR-1: resurfaces `name` and its display root when `status` is a real 2xx delivery. Never throws. */
export function resurfaceIdleSettleAfterMessage(name: string, status: number, deps: ResurfaceAfterMessageDeps = defaultDeps): string[] {
  if (status < 200 || status >= 300) return [];
  try {
    const root = displayRootNameOf(name, deps.listRows());
    const targets = root === name ? [name] : [name, root];
    const changed = targets.filter((target) => deps.resurface(target));
    if (changed.length > 0) deps.invalidate();
    for (const changedName of changed) deps.emitChanged(changedName);
    return changed;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[conversations] idle resurface failed for ${name}: ${msg}`);
    return [];
  }
}
