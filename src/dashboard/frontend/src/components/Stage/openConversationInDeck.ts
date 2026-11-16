/**
 * openConversationInDeck — the two deck openers (PAN-5343 H-D6).
 *
 * Both work on the stores through `getState()` only, so the left column can
 * call them from any route, mounted Stage or not:
 *
 * - `showConversation` shows a conversation in the focused leaf. A visible
 *   conversation is only focused; otherwise its agent pane replaces the
 *   focused leaf of a split (the replaced pane stays open as a tab).
 * - `openConversationBeside` adds a conversation next to the panes already on
 *   screen as an equal 2/3/4 grid; at four it replaces the least recently
 *   focused leaf other than the active one, keeping the 2×2 shape.
 */
import { usePanesStore, type PaneId, type WorkspacePane } from '../../lib/panesStore';
import { ALL_PROJECTS_KEY } from '../../lib/deckKeys';
import { useDeckLayoutStore } from '../../lib/deckLayoutStore';
import { collectLeafIds, leafCount, presetLayout, replaceLeaf, type LayoutPreset, type PaneLayout } from '../../lib/paneLayout';

interface DeckSnapshot {
  layout: PaneLayout | null;
  activeId: PaneId | null;
  /** Pane ids on screen: the layout's leaves, else the active pane, else none. */
  visible: PaneId[];
}

/** Hydrate the deck's panes and layout, then read them before any pane is added. */
function readDeck(deckKey: string): DeckSnapshot {
  usePanesStore.getState().ensureHome(deckKey);
  const layout = useDeckLayoutStore.getState().getLayout(deckKey);
  const activeId = usePanesStore.getState().activePaneByWorkspace[deckKey] ?? null;
  const visible = layout && leafCount(layout) > 1 ? collectLeafIds(layout) : activeId ? [activeId] : [];
  return { layout: layout && leafCount(layout) > 1 ? layout : null, activeId, visible };
}

function findAgentPane(deckKey: string, name: string): PaneId | null {
  const panes = usePanesStore.getState().panesByWorkspace[deckKey] ?? [];
  return panes.find((p) => p.paneType === 'agent' && p.conversationId === name)?.paneId ?? null;
}

function findOrAddAgentPane(deckKey: string, name: string, label: string): PaneId {
  return findAgentPane(deckKey, name)
    ?? usePanesStore.getState().addPane(deckKey, { paneType: 'agent', label, conversationId: name });
}

function focus(deckKey: string, paneId: PaneId): PaneId {
  usePanesStore.getState().setActivePane(deckKey, paneId);
  useDeckLayoutStore.getState().noteFocus(deckKey, paneId);
  return paneId;
}

/** Show `name` in the deck's focused leaf. Returns its agent pane id. */
export function showConversation(deckKey: string, name: string, label: string): PaneId {
  const { layout, activeId, visible } = readDeck(deckKey);
  const existing = findAgentPane(deckKey, name);
  if (existing && visible.includes(existing)) return focus(deckKey, existing);
  const paneId = findOrAddAgentPane(deckKey, name, label);
  if (layout) {
    const target = activeId && visible.includes(activeId) ? activeId : visible[0];
    useDeckLayoutStore.getState().setLayout(deckKey, replaceLeaf(layout, target, paneId));
  }
  return focus(deckKey, paneId);
}

/**
 * The visible leaf to replace when four are on screen: the least recently
 * focused one other than the active pane. A leaf never focused this session
 * counts as oldest; ties go to the later leaf in leaf order.
 */
function leastRecentlyFocused(deckKey: string, visible: PaneId[], activeId: PaneId | null): PaneId {
  const history = useDeckLayoutStore.getState().focusHistoryByDeck[deckKey] ?? [];
  let pick = visible[0];
  let pickAge = -1;
  for (const id of visible) {
    if (id === activeId) continue;
    const index = history.indexOf(id);
    const age = index === -1 ? Number.POSITIVE_INFINITY : index;
    if (age >= pickAge) {
      pick = id;
      pickAge = age;
    }
  }
  return pick;
}

/** Open `name` beside the panes on screen. Returns its agent pane id. */
export function openConversationBeside(deckKey: string, name: string, label: string): PaneId {
  const { layout, activeId, visible } = readDeck(deckKey);
  const existing = findAgentPane(deckKey, name);
  if (existing && visible.includes(existing)) return focus(deckKey, existing);
  const paneId = findOrAddAgentPane(deckKey, name, label);
  const setLayout = useDeckLayoutStore.getState().setLayout;
  if (visible.length >= 4 && layout) {
    setLayout(deckKey, replaceLeaf(layout, leastRecentlyFocused(deckKey, visible, activeId), paneId));
  } else if (visible.length >= 1) {
    setLayout(deckKey, presetLayout([...visible, paneId], (visible.length + 1) as LayoutPreset));
  }
  return focus(deckKey, paneId);
}

/**
 * PAN-5343 H-D12: a /conv/<id> deep link while the All projects deck is
 * selected. Shows the conversation in that deck, then applies the message
 * target and view mode the same way `openConversationTab` does.
 */
export function showConversationInAllDeck(
  name: string,
  label: string,
  target?: { messageId: string; messageIndex?: number; nonce: number; subagentId?: string },
  viewMode?: WorkspacePane['viewMode'],
): PaneId {
  const paneId = showConversation(ALL_PROJECTS_KEY, name, label);
  const effectiveViewMode = viewMode ?? (target ? 'conversation' : undefined);
  const patch: Partial<WorkspacePane> = {
    ...(effectiveViewMode ? { viewMode: effectiveViewMode } : {}),
    ...(target
      ? {
          targetMessageId: target.messageId,
          targetMessageIndex: target.messageIndex,
          targetMessageNonce: target.nonce,
          targetSubagentId: target.subagentId,
        }
      : {}),
  };
  if (Object.keys(patch).length > 0) usePanesStore.getState().updatePane(ALL_PROJECTS_KEY, paneId, patch);
  return paneId;
}
