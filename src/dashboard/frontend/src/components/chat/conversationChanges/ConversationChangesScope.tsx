// The conversation panel's view of what the conversation changed (PAN-5295 D2-1, D2-2, D2-3).
//
// ConversationPanel wraps its content in this scope, which runs the dock's own
// query (`useConversationChanges`, scope 'conversation') once, so the header,
// the turn cards, the file chips and the dock share one cache entry and one
// request. Turn cards and chips read the result through the context; they never
// query themselves.
//
// Inside a Stage with a root, `stage` carries the dock actions. Outside a Stage
// the scope queries with rootId null and never calls useRootContext(), so a
// popout, drawer or directory mount makes no /api/registered-projects or
// /api/workspace-registry request; its cards open the diff window instead.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ConversationChanges } from '@overdeck/contracts';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { toRootPath } from '../../dock/changes-model';
import { useConversationChanges } from '../../dock/useConversationChanges';
import type { DockDiffTarget, OpenDockInput } from '../../dock/workDockStore';
import { rootIdForConversation, useRootContext } from '../../explorer/rootForConversation';
import { useExplorerStore } from '../../explorer/explorerStore';
import { useStageDeck, type OpenBesideInput } from '../../Stage/StageDeckContext';
import { hasConversationChanges, openConversationDiffWindow } from '../diffWindow';

export interface StageChangeActions {
  rootId: string;
  /** Repo path → root path (null when outside the root). */
  rootPathOf(repoPath: string): string | null;
  /** Absolute path → repo path (null when outside repoRoot). */
  repoPathOfAbs(absPath: string): string | null;
  /** The dock's Changes diff view on `target`, stepping through `list` (D2-6). */
  openDiff(target: DockDiffTarget, list: readonly DockDiffTarget[]): void;
  openBeside(rootPath: string, line?: number): void;
  /** The Files tab with the path revealed. */
  reveal(rootPath: string): void;
  /** The Files tab filtered to this conversation's files (D2-7). */
  showInFiles(): void;
}

export interface ConversationChangesContextValue {
  conversation: Conversation;
  changes: ConversationChanges | null;
  rootId: string | null;
  /** Non-null only inside a Stage with a root (deck.openDock && deck.openBeside && rootId). */
  stage: StageChangeActions | null;
  /** The diff window (D2-4), selecting `filePath` (a repo path) when given. */
  openDiffWindow(filePath?: string): void;
}

const ConversationChangesContext = createContext<ConversationChangesContextValue | null>(null);

/** The enclosing panel's changes, or null outside a ConversationChangesScope. */
export function useConversationChangesContext(): ConversationChangesContextValue | null {
  return useContext(ConversationChangesContext);
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The query and the diff-window action both mounts share. */
function useScopeChanges(conversation: Conversation, rootId: string | null) {
  const enabled = hasConversationChanges(conversation);
  const { data } = useConversationChanges(conversation, 'conversation', { rootId, enabled });
  const changes = enabled ? (data ?? null) : null;
  const openDiffWindow = useMemo(
    () => (filePath?: string) => openConversationDiffWindow(conversation, { filePath, rootId }),
    [conversation, rootId],
  );
  return { changes, openDiffWindow };
}

type DeckActions = { openDock: (input: OpenDockInput) => void; openBeside: (input: OpenBesideInput) => string };

function StageChangesScope({ conversation, deck, children }: { conversation: Conversation; deck: DeckActions; children: ReactNode }) {
  const rootContext = useRootContext();
  const rootId = useMemo(() => rootIdForConversation(conversation, rootContext), [conversation, rootContext]);
  const rootAbs = useExplorerStore((s) => (rootId ? (s.roots[rootId]?.dirs['']?.absPath ?? null) : null));
  const { changes, openDiffWindow } = useScopeChanges(conversation, rootId);
  const { openDock, openBeside } = deck;

  const stage = useMemo<StageChangeActions | null>(() => {
    if (!rootId) return null;
    return {
      rootId,
      rootPathOf: (repoPath) => (changes ? toRootPath(changes.repoRoot, rootAbs, repoPath) : null),
      repoPathOfAbs: (absPath) => {
        if (!changes) return null;
        const prefix = `${trimSlash(changes.repoRoot)}/`;
        return absPath.startsWith(prefix) && absPath.length > prefix.length ? absPath.slice(prefix.length) : null;
      },
      openDiff: (target, list) => openDock({ tab: 'changes', changesScope: 'conversation', diff: target, diffList: list }),
      openBeside: (rootPath, line) => {
        openBeside(line === undefined ? { rootId, path: rootPath } : { rootId, path: rootPath, line });
      },
      reveal: (rootPath) => openDock({ tab: 'files', reveal: { rootId, path: rootPath } }),
      showInFiles: () => openDock({ tab: 'files', filesFilter: 'mine' }),
    };
  }, [rootId, rootAbs, changes, openDock, openBeside]);

  const value = useMemo<ConversationChangesContextValue>(
    () => ({ conversation, changes, rootId, stage, openDiffWindow }),
    [conversation, changes, rootId, stage, openDiffWindow],
  );
  return <ConversationChangesContext.Provider value={value}>{children}</ConversationChangesContext.Provider>;
}

function PlainChangesScope({ conversation, children }: { conversation: Conversation; children: ReactNode }) {
  const { changes, openDiffWindow } = useScopeChanges(conversation, null);
  const value = useMemo<ConversationChangesContextValue>(
    () => ({ conversation, changes, rootId: null, stage: null, openDiffWindow }),
    [conversation, changes, openDiffWindow],
  );
  return <ConversationChangesContext.Provider value={value}>{children}</ConversationChangesContext.Provider>;
}

/** Two components, so hooks never branch: StageChangesScope inside a Stage that offers the dock, else PlainChangesScope. */
export function ConversationChangesScope({ conversation, children }: { conversation: Conversation; children: ReactNode }) {
  const deck = useStageDeck();
  const openDock = deck?.openDock;
  const openBeside = deck?.openBeside;
  const actions = useMemo<DeckActions | null>(() => (openDock && openBeside ? { openDock, openBeside } : null), [openDock, openBeside]);
  if (actions) {
    return (
      <StageChangesScope conversation={conversation} deck={actions}>
        {children}
      </StageChangesScope>
    );
  }
  return <PlainChangesScope conversation={conversation}>{children}</PlainChangesScope>;
}
