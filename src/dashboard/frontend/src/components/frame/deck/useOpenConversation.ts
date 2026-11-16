/**
 * useOpenConversation — open a conversation in its project's deck (PAN-5293
 * WI-5, moved from CommandDeck's handleSelectConversation). Selects it,
 * opens or focuses its agent pane in the project it resolves to (the
 * No-project bucket when unscoped), and calls `openInDeck` with its route
 * key, so a re-click resyncs the /conv URL. `null` clears the selection.
 *
 * The callback also accepts a `Conversation` object directly (PAN-5339 WI-2),
 * so a conversation-reference link can open an archived or otherwise
 * unlisted conversation: when the name isn't in the live list, the passed
 * object stands in for it so its own `projectKey`/`cwd` still resolve.
 *
 * PAN-5343 H-D5/H-D6: in the All projects deck a plain open shows the
 * conversation in the focused leaf of that deck (`showConversation`) and
 * never switches projects. `useOpenConversationBeside` opens it beside the
 * panes on screen, in the All deck or in the conversation's own project deck.
 */

import { useCallback } from 'react';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { openConversationTab } from '../../CommandDeck/openConversationTab';
import { ALL_PROJECTS_KEY, NO_PROJECT_KEY } from '../../CommandDeck/projectsData';
import { openConversationBeside, showConversation } from '../../Stage/openConversationInDeck';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import { conversationRouteKey } from '../../../lib/linkedConversation';
import { useDeckNavigation } from './deckNavigation';
import { useProjectScope } from './useProjectScope';

export function useOpenConversation(
  deckKey: string | null,
  options?: { conversations?: Conversation[]; onOpened?: (name: string) => void },
): (target: string | Conversation | null) => void {
  const { openInDeck, selectProject } = useDeckNavigation();
  const { conversations, resolveConversationProjectName } = useProjectScope(deckKey, options?.conversations);
  const onOpened = options?.onOpened;

  return useCallback((target: string | Conversation | null) => {
    const name = typeof target === 'string' || target === null ? target : target.name;
    const selection = useCommandDeckSelection.getState();
    selection.setSelectedConversation(name);
    if (selection.selectedFeature) selection.selectSession(selection.selectedFeature, null);
    if (!name) return;
    selection.setSelectedFeature(null);
    const conv = conversations.find((c) => c.name === name) ?? (typeof target === 'object' && target ? target : undefined);
    if (deckKey === ALL_PROJECTS_KEY) {
      showConversation(ALL_PROJECTS_KEY, name, conv?.title ?? 'Agent');
      if (conv) {
        onOpened?.(name);
        openInDeck({ projectKey: ALL_PROJECTS_KEY, conversationRouteKey: conversationRouteKey(conv) });
      }
      return;
    }
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

/**
 * PAN-5343 H-D5: open a conversation beside the panes on screen — in the All
 * projects deck when it is selected, else in the conversation's own project
 * deck (which, in a project deck, is the selected deck).
 */
export function useOpenConversationBeside(deckKey: string | null): (name: string) => void {
  const { openInDeck } = useDeckNavigation();
  const { conversations, resolveConversationProjectName } = useProjectScope(deckKey);

  return useCallback((name: string) => {
    const selection = useCommandDeckSelection.getState();
    selection.setSelectedConversation(name);
    if (selection.selectedFeature) selection.selectSession(selection.selectedFeature, null);
    selection.setSelectedFeature(null);
    const conv = conversations.find((c) => c.name === name);
    const deck = deckKey === ALL_PROJECTS_KEY ? ALL_PROJECTS_KEY : resolveConversationProjectName(conv) ?? NO_PROJECT_KEY;
    openConversationBeside(deck, name, conv?.title ?? 'Agent');
    if (conv) openInDeck({ projectKey: deck, conversationRouteKey: conversationRouteKey(conv) });
  }, [conversations, resolveConversationProjectName, openInDeck, deckKey]);
}
