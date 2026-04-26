/**
 * ZoneCConversation — agent-selected Zone C: conversation/terminal view.
 *
 * Wraps the existing `<SessionPanel>` so the unified Command Deck has a single
 * Zone C component to swap with `<ZoneCOverview>` based on selection.
 *
 * Round-divider plumbing (pan-y6ge, pan-0h5k): callers can supply a `roundMarkers`
 * array that is forwarded all the way down to `<MessagesTimeline>`. Derivation
 * from roundMetadata is handled inside `<ConversationPanel>` via `deriveRoundMarkers`.
 * This component remains pass-through so external callers can still override markers.
 */

import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import type { RoundMarker } from '../chat/MessagesTimeline';
import { SessionPanel } from './SessionView/SessionPanel';

interface ZoneCConversationProps {
  session: SessionNodeType;
  issueId: string;
  roundMarkers?: ReadonlyArray<RoundMarker>;
}

export function ZoneCConversation({ session, issueId, roundMarkers }: ZoneCConversationProps) {
  return <SessionPanel session={session} issueId={issueId} roundMarkers={roundMarkers} />;
}
