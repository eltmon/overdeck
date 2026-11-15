/**
 * deckNavigation — the one navigation door into the Command Deck (PAN-5293 F-D2).
 *
 * The left column and the extracted deck handlers open a conversation, an
 * issue cockpit or a project deck through `openInDeck(target)`. App.tsx owns
 * the implementation (it holds the route state) and provides it here, with
 * `selectProject` (App's `handleSelectProject`).
 *
 * Callers open or focus the Stage pane through `panesStore` first, then call
 * `openInDeck`, which only switches the project, shows the deck and writes
 * the URL. The decision rules are the pure `deckNavigationActions`, so they
 * are testable without App.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Tab } from '../../Header';

export type DeckTarget =
  /** A conversation: the URL becomes `/conv/<routeKey>`. */
  | { projectKey: string; conversationRouteKey: string }
  /** An issue cockpit: the URL becomes `/command-deck/<project>/<issue>`. */
  | { projectKey: string; issueId: string }
  /** A project deck whose pane the caller already chose: `/command-deck/<project>`. */
  | { projectKey: string };

export interface DeckNavigation {
  openInDeck(target: DeckTarget): void;
  /** App's `handleSelectProject`: opens the project's deck on its Home pane. */
  selectProject(projectName: string | null, opts?: { updateUrl?: boolean }): void;
}

export type DeckNavAction =
  | { kind: 'select-project'; projectKey: string }
  | { kind: 'show-deck' }
  | { kind: 'conversation-route'; routeKey: string }
  | { kind: 'cockpit-route'; projectKey: string; issueId: string }
  | { kind: 'project-route'; projectKey: string };

export interface DeckNavigationState {
  activeTab: Tab;
  selectedProjectKey: string | null;
}

/**
 * The steps `openInDeck` performs for `target` from `state` (PRD §6.2):
 * 1. A different project is selected first (no Home reset: the pane is chosen).
 * 2. Off the deck: show the deck, then write the target's route.
 * 3. On the deck: a conversation still writes its route (re-click resync); an
 *    issue or project does nothing more, because CommandDeck's selection
 *    URL-sync effect writes the cockpit URL.
 */
export function deckNavigationActions(state: DeckNavigationState, target: DeckTarget): DeckNavAction[] {
  const actions: DeckNavAction[] = [];
  if (target.projectKey !== state.selectedProjectKey) {
    actions.push({ kind: 'select-project', projectKey: target.projectKey });
  }
  const onDeck = state.activeTab === 'command-deck';
  if ('conversationRouteKey' in target) {
    if (!onDeck) actions.push({ kind: 'show-deck' });
    actions.push({ kind: 'conversation-route', routeKey: target.conversationRouteKey });
    return actions;
  }
  if (onDeck) return actions;
  actions.push({ kind: 'show-deck' });
  if ('issueId' in target) {
    actions.push({ kind: 'cockpit-route', projectKey: target.projectKey, issueId: target.issueId });
  } else {
    actions.push({ kind: 'project-route', projectKey: target.projectKey });
  }
  return actions;
}

export const DeckNavigationContext = createContext<DeckNavigation | null>(null);

export function DeckNavigationProvider({ value, children }: { value: DeckNavigation; children: ReactNode }) {
  return <DeckNavigationContext.Provider value={value}>{children}</DeckNavigationContext.Provider>;
}

export function useDeckNavigation(): DeckNavigation {
  const navigation = useContext(DeckNavigationContext);
  if (!navigation) {
    throw new Error('useDeckNavigation() must be called inside a DeckNavigationProvider');
  }
  return navigation;
}

export type DeckNavigationCall =
  | { method: 'openInDeck'; target: DeckTarget }
  | { method: 'selectProject'; projectName: string | null; opts?: { updateUrl?: boolean } };

/**
 * Test provider: records every call in `calls` (when given) and forwards it
 * to the matching `navigation` override (when given).
 */
export function TestDeckNavigationProvider({
  children,
  calls,
  navigation,
}: {
  children: ReactNode;
  calls?: DeckNavigationCall[];
  navigation?: Partial<DeckNavigation>;
}) {
  const value = useMemo<DeckNavigation>(() => ({
    openInDeck: (target) => {
      calls?.push({ method: 'openInDeck', target });
      navigation?.openInDeck?.(target);
    },
    selectProject: (projectName, opts) => {
      calls?.push({ method: 'selectProject', projectName, opts });
      navigation?.selectProject?.(projectName, opts);
    },
  }), [calls, navigation]);
  return <DeckNavigationProvider value={value}>{children}</DeckNavigationProvider>;
}
