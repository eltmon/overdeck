import { beforeEach, describe, expect, it } from 'vitest';
import { flushPanesPersistence, usePanesStore, type WorkspacePane } from '../../../lib/panesStore';
import { resetDeckLayoutStore, selectDeckLayout, useDeckLayoutStore } from '../../../lib/deckLayoutStore';
import { collectLeafIds, presetLayout, presetOf, type PaneLayout } from '../../../lib/paneLayout';
import { openConversationBeside, showConversation } from '../openConversationInDeck';

const ALL = '__all-projects__';

function agent(id: string): WorkspacePane {
  return { paneId: id, paneType: 'agent', label: id, createdAt: 1, conversationId: `conv-${id}` };
}

function panes(deck = ALL): WorkspacePane[] {
  return usePanesStore.getState().panesByWorkspace[deck] ?? [];
}
function layout(deck = ALL): PaneLayout | null {
  return selectDeckLayout(deck)(useDeckLayoutStore.getState());
}
function activeId(deck = ALL): string | null {
  return usePanesStore.getState().activePaneByWorkspace[deck] ?? null;
}

/** Seed a deck in storage only (neither store has it in memory). */
function seed(deck: string, stored: WorkspacePane[], active: string | null, tree: PaneLayout | null): void {
  localStorage.setItem(`pan-panes:${deck}`, JSON.stringify(stored));
  if (active) localStorage.setItem(`pan-active-pane:${deck}`, active);
  if (tree) localStorage.setItem(`pan-layout:${deck}`, JSON.stringify(tree));
}

beforeEach(() => {
  flushPanesPersistence();
  localStorage.clear();
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
  resetDeckLayoutStore();
});

describe('showConversation (PAN-5343 H-D6)', () => {
  it('replaces the focused leaf of a 2-leaf deck and keeps the old pane as a tab', () => {
    seed(ALL, [agent('a'), agent('b')], 'a', presetLayout(['a', 'b'], 2));
    const id = showConversation(ALL, 'conv-new', 'New');
    expect(collectLeafIds(layout()!)).toEqual([id, 'b']);
    expect(panes().map((p) => p.paneId)).toContain('a');
    expect(activeId()).toBe(id);
  });

  it('replaces the first leaf when the active pane is not a leaf', () => {
    seed(ALL, [agent('a'), agent('b'), agent('c')], 'c', presetLayout(['a', 'b'], 2));
    const id = showConversation(ALL, 'conv-new', 'New');
    expect(collectLeafIds(layout()!)).toEqual([id, 'b']);
  });

  it('with no split just adds and focuses the pane', () => {
    const id = showConversation(ALL, 'conv-x', 'X');
    expect(panes().map((p) => p.paneId)).toEqual([id]);
    expect(layout()).toBeNull();
    expect(activeId()).toBe(id);
  });
});

describe('openConversationBeside (PAN-5343 H-D6)', () => {
  it('from an empty deck adds the pane alone', () => {
    const id = openConversationBeside(ALL, 'conv-x', 'X');
    expect(panes().map((p) => p.paneId)).toEqual([id]);
    expect(layout()).toBeNull();
    expect(activeId()).toBe(id);
  });

  it('from one visible pane builds Two side by side', () => {
    seed(ALL, [agent('a')], 'a', null);
    const id = openConversationBeside(ALL, 'conv-new', 'New');
    expect(layout()).toEqual(presetLayout(['a', id], 2));
    expect(activeId()).toBe(id);
  });

  it('from two visible panes builds Three columns', () => {
    seed(ALL, [agent('a'), agent('b')], 'a', presetLayout(['a', 'b'], 2));
    const id = openConversationBeside(ALL, 'conv-new', 'New');
    expect(layout()).toEqual(presetLayout(['a', 'b', id], 3));
  });

  it('from three visible panes builds Grid of four', () => {
    seed(ALL, [agent('a'), agent('b'), agent('c')], 'a', presetLayout(['a', 'b', 'c'], 3));
    const id = openConversationBeside(ALL, 'conv-new', 'New');
    expect(layout()).toEqual(presetLayout(['a', 'b', 'c', id], 4));
  });

  it('with four leaves replaces the least recently focused non-active leaf', () => {
    seed(ALL, [agent('a'), agent('b'), agent('c'), agent('d')], 'a', presetLayout(['a', 'b', 'c', 'd'], 4));
    const { noteFocus } = useDeckLayoutStore.getState();
    // History, most recent first: a, c, d, b → b is the oldest.
    for (const id of ['b', 'd', 'c', 'a']) noteFocus(ALL, id);
    const id = openConversationBeside(ALL, 'conv-new', 'New');
    expect(collectLeafIds(layout()!)).toEqual(['a', id, 'c', 'd']);
    expect(presetOf(layout())).toBe(4);
    expect(panes().map((p) => p.paneId)).toContain('b');
  });

  it('with four leaves and no focus history (after a reload) replaces the last non-active leaf', () => {
    seed(ALL, [agent('a'), agent('b'), agent('c'), agent('d')], 'd', presetLayout(['a', 'b', 'c', 'd'], 4));
    const id = openConversationBeside(ALL, 'conv-new', 'New');
    expect(collectLeafIds(layout()!)).toEqual(['a', 'b', id, 'd']);
    expect(presetOf(layout())).toBe(4);
  });

  it('in a project deck with Home active builds Home beside the conversation', () => {
    usePanesStore.getState().ensureHome('overdeck');
    const homeId = panes('overdeck')[0].paneId;
    const id = openConversationBeside('overdeck', 'conv-x', 'X');
    expect(layout('overdeck')).toEqual(presetLayout([homeId, id], 2));
  });
});

describe('already visible (PAN-5343 H-D6)', () => {
  it.each([
    ['showConversation', showConversation],
    ['openConversationBeside', openConversationBeside],
  ] as const)('%s only focuses a visible conversation', (_name, open) => {
    const tree = presetLayout(['a', 'b'], 2);
    seed(ALL, [agent('a'), agent('b')], 'a', tree);
    expect(open(ALL, 'conv-b', 'b')).toBe('b');
    expect(layout()).toEqual(tree);
    expect(activeId()).toBe('b');
    expect(panes()).toHaveLength(2);
  });
});

describe('hydration (PAN-5343 H-D6)', () => {
  it('beside hydrates panes and layout from storage and adds no Home pane', () => {
    seed(ALL, [agent('a'), agent('b')], 'b', presetLayout(['a', 'b'], 2));
    const id = openConversationBeside(ALL, 'conv-new', 'New');
    expect(layout()).toEqual(presetLayout(['a', 'b', id], 3));
    expect(panes().map((p) => p.paneId)).toEqual(['a', 'b', id]);
    expect(panes().some((p) => p.paneType === 'home')).toBe(false);
  });

  it('show hydrates panes and layout from storage and adds no Home pane', () => {
    seed(ALL, [agent('a'), agent('b')], 'b', presetLayout(['a', 'b'], 2));
    const id = showConversation(ALL, 'conv-new', 'New');
    expect(layout()).toEqual(presetLayout(['a', id], 2));
    expect(panes().map((p) => p.paneId)).toEqual(['a', 'b', id]);
    expect(panes().some((p) => p.paneType === 'home')).toBe(false);
  });

  it('records the opened pane in the focus history', () => {
    const id = openConversationBeside(ALL, 'conv-x', 'X');
    expect(useDeckLayoutStore.getState().focusHistoryByDeck[ALL]?.[0]).toBe(id);
  });
});
