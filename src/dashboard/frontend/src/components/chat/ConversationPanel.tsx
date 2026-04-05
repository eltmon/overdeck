import type { Conversation } from '../MissionControl/ConversationList';
import { ConversationTerminal } from '../MissionControl/ConversationTerminal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationPanelProps {
  conversation: Conversation;
}

// ─── Component ────────────────────────────────────────────────────────────────

// ConversationPanel wraps ConversationTerminal. It will grow to include a
// structured conversation view (ChatMarkdown, MessagesTimeline, ComposerFooter)
// with a toggle between [Conversation] and [Terminal] views.
export function ConversationPanel({ conversation }: ConversationPanelProps) {
  return <ConversationTerminal conversation={conversation} />;
}
