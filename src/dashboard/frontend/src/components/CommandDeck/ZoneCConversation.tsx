/**
 * ZoneCConversation — agent-selected Zone C: conversation/terminal view.
 *
 * Wraps the existing `<SessionPanel>` so the unified Command Deck has a single
 * Zone C component to swap with `<ZoneCOverview>` based on selection. The
 * `roundMarkers` round-divider plumbing called out in the PRD is intentionally
 * deferred to pan-y6ge so this bead stays a pure structural shell.
 */

import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import { SessionPanel } from './SessionView/SessionPanel';

interface ZoneCConversationProps {
  session: SessionNodeType;
  issueId: string;
}

export function ZoneCConversation({ session, issueId }: ZoneCConversationProps) {
  return <SessionPanel session={session} issueId={issueId} />;
}
