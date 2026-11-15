/**
 * ConversationLinkOpenerContext (PAN-5339 WI-2/D8).
 *
 * Split out of ConversationLinkOpener.tsx so a conversation-reference link
 * (rendered from inside ChatMarkdown) can read the opener without pulling in
 * `useOpenConversation` and the deck navigation machinery it imports — that
 * chain loops back through ConversationPanel/MessagesTimeline into
 * ChatMarkdown itself (lint:circular). Only `ConversationLinkOpenerProvider`,
 * mounted once near the app root, needs the real hook.
 */
import { createContext, useContext } from 'react';
import type { Conversation } from '../CommandDeck/ConversationList';

export type ConversationLinkOpener = (conversation: Conversation) => void;

export const ConversationLinkOpenerContext = createContext<ConversationLinkOpener | null>(null);

export function useConversationLinkOpener(): ConversationLinkOpener | null {
  return useContext(ConversationLinkOpenerContext);
}
