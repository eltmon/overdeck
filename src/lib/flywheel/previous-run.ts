/**
 * The previous Flywheel run (PAN-5666).
 *
 * `pan flywheel start` retires the old `conv-flywheel` row under
 * `conv-flywheel~<id8>` instead of deleting it (see `retireConversation`), so
 * the run before this one keeps its transcript. This module reads that
 * transcript and derives `previousRun`: its last tick marker, the open
 * needs-you items at that tick, and whether it stopped cleanly. Nothing is
 * stored; the retired row and its transcript are the only sources.
 *
 * A new run's Orient reads `previousRun` from `pan flywheel status --json`,
 * carries its needs-you items forward and drains its in-flight list first.
 * Until the new run writes its first tick, the page shows the previous run's
 * needs-you items (`needsYouTick` in `@overdeck/contracts`).
 */

import type { FlywheelPreviousRun } from '@overdeck/contracts';

import type { LegacyConversation } from '../overdeck/conversations.js';
import { FLYWHEEL_CONVERSATION_SESSION } from './constants.js';
import { findLastTick, resolveNeedsYouItems, type TickMarkerMessage } from './tick-marker.js';

/**
 * Retired rows read per status, newest first. A start that failed or a run
 * that never ticked leaves a tickless row, so the walk skips past it.
 */
export const PREVIOUS_RUN_SCAN_LIMIT = 3;

export interface PreviousRunDeps {
  /** The retired `conv-flywheel~…` rows, newest first. */
  listRetiredConversations?: () => readonly LegacyConversation[] | Promise<readonly LegacyConversation[]>;
  readTranscript: (conv: LegacyConversation) => Promise<readonly TickMarkerMessage[]>;
}

async function defaultListRetiredConversations(): Promise<readonly LegacyConversation[]> {
  const { listRetiredConversations } = await import('../overdeck/conversations.js');
  return listRetiredConversations(FLYWHEEL_CONVERSATION_SESSION, PREVIOUS_RUN_SCAN_LIMIT);
}

/**
 * The newest retired flywheel run that wrote a tick, or null. Never throws:
 * a read that fails reads as "no previous run" so the status still renders.
 */
export async function derivePreviousRun(
  current: LegacyConversation | null,
  deps: PreviousRunDeps,
): Promise<FlywheelPreviousRun | null> {
  let rows: readonly LegacyConversation[];
  try {
    rows = await (deps.listRetiredConversations ?? defaultListRetiredConversations)();
  } catch {
    return null;
  }
  for (const conv of rows.slice(0, PREVIOUS_RUN_SCAN_LIMIT)) {
    // A retired row has its own session id and no session, so it cannot
    // resolve to the current run's transcript; this guards the invariant.
    if (current?.claudeSessionId && conv.claudeSessionId === current.claudeSessionId) continue;
    let messages: readonly TickMarkerMessage[];
    try {
      messages = await deps.readTranscript(conv);
    } catch {
      continue;
    }
    const tick = findLastTick(messages);
    if (!tick) continue;
    return {
      conversation: { name: conv.name, id: conv.id, createdAt: conv.createdAt, endedAt: conv.endedAt ?? null },
      lastTick: { ...tick, needsYouItems: resolveNeedsYouItems(messages) },
      stoppedCleanly: tick.phase === 'stopping',
    };
  }
  return null;
}
