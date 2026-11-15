/**
 * ConversationLinkOpener (PAN-5339 WI-2/D8).
 *
 * Mounted once near the app root, this exposes the deck's conversation
 * opener to any conversation-reference link, regardless of which deck pane
 * rendered the transcript it's in. `null` outside the provider (e.g. a
 * pop-out window, `/m`, or the issue drawer) tells a link to fall back to a
 * plain new-tab open (FR-8).
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Conversation } from '../CommandDeck/ConversationList';
import { useOpenConversation } from '../frame/deck/useOpenConversation';

export type ConversationLinkOpener = (conversation: Conversation) => void;

export const ConversationLinkOpenerContext = createContext<ConversationLinkOpener | null>(null);

export function ConversationLinkOpenerProvider({ children }: { children: ReactNode }) {
  const open = useOpenConversation(null);
  return <ConversationLinkOpenerContext.Provider value={open}>{children}</ConversationLinkOpenerContext.Provider>;
}

export function useConversationLinkOpener(): ConversationLinkOpener | null {
  return useContext(ConversationLinkOpenerContext);
}
