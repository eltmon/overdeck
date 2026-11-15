/**
 * useOpenConversation — open a conversation in its project's deck (PAN-5293
 * WI-5, moved from CommandDeck's handleSelectConversation). Selects it,
 * opens or focuses its agent pane in the project it resolves to (the
 * No-project bucket when unscoped), and calls `openInDeck` with its route
 * key, so a re-click resyncs the /conv URL. `null` clears the selection.
 */

import { useCallback } from 'react';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { openConversationTab } from '../../CommandDeck/openConversationTab';
import { NO_PROJECT_KEY } from '../../CommandDeck/projectsData';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import { conversationRouteKey } from '../../../lib/linkedConversation';
import { useDeckNavigation } from './deckNavigation';
import { useProjectScope } from './useProjectScope';

export function useOpenConversation(
  deckKey: string | null,
  options?: { conversations?: Conversation[]; onOpened?: (name: string) => void },
): (name: string | null) => void {
  const { openInDeck, selectProject } = useDeckNavigation();
  const { conversations, resolveConversationProjectName } = useProjectScope(deckKey, options?.conversations);
  const onOpened = options?.onOpened;

  return useCallback((name: string | null) => {
    const selection = useCommandDeckSelection.getState();
    selection.setSelectedConversation(name);
    if (selection.selectedFeature) selection.selectSession(selection.selectedFeature, null);
    if (!name) return;
    selection.setSelectedFeature(null);
    const conv = conversations.find((c) => c.name === name);
    // Unscoped conversations live in the No-project bucket.
    const projectName = resolveConversationProjectName(conv) ?? NO_PROJECT_KEY;
    openConversationTab(projectName, name, conv?.title ?? 'Agent');
    // A click is an explicit intent to open this conversation, so drive the
    // /conv/<id> URL directly. Re-clicking the already-selected conversation
    // leaves `selectedConversation` unchanged, so the deck's state->URL sync
    // effect never re-runs — without this the URL would stay on
    // /command-deck/<project>. onOpened lets the deck keep its prevSelectedRef
    // in sync so that effect skips the redundant follow-up call.
    if (conv) {
      onOpened?.(name);
      openInDeck({ projectKey: projectName, conversationRouteKey: conversationRouteKey(conv) });
    } else if (projectName !== deckKey) {
      // Not in the list yet: still show the bucket that holds its pane.
      selectProject(projectName, { updateUrl: false });
    }
  }, [conversations, resolveConversationProjectName, openInDeck, selectProject, onOpened, deckKey]);
}
