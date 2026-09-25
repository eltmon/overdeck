/**
 * The Agents Directory (PAN-3920 W6), the Agents page's History view
 * (PAN-4197): a three-pane view of every agent, conversation and subagent —
 * tree (location → project → issue / Conversations), list, and detail. Data
 * comes from GET /api/agent-directory, which recomputes on read and stores
 * nothing. The panes are resizable (react-resizable-panels, layout saved in
 * localStorage under `agents-directory`); the tree pane collapses.
 *
 * Keyboard (FR-6): ↑/↓ move the selection inside the focused pane; ←/→ and
 * Tab/Shift+Tab move focus between panes; Enter on a node focuses the list,
 * on a row focuses the detail; `/` focuses the list filter. Selection lives
 * in the URL (`node`, `entry`, `window`).
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

import { guardedLayoutStorage } from '../panel-layout-storage';

import { DirectoryDetail } from './DirectoryDetail';
import { DirectoryList } from './DirectoryList';
import { DirectoryTree } from './DirectoryTree';
import { buildDirectoryTree, entriesForNode, filterRows, visibleNodes, type DirectoryNode } from './directory-tree';
import { useAgentDirectory } from './useAgentDirectory';
import { useDirectoryUrlState } from './useDirectoryUrlState';

type Pane = 'tree' | 'list' | 'detail';

function containsNode(node: DirectoryNode, nodeId: string): boolean {
  return node.children.some((child) => child.id === nodeId || containsNode(child, nodeId));
}
const PANES: Pane[] = ['tree', 'list', 'detail'];

export function AgentsDirectory() {
  const url = useDirectoryUrlState();
  const { data, isLoading, isError } = useAgentDirectory(url.windowHours);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'agents-directory', storage: guardedLayoutStorage });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const tree = useMemo(() => buildDirectoryTree(entries), [entries]);
  const nodes = useMemo(() => visibleNodes(tree, collapsed), [tree, collapsed]);
  const selectedNodeId = nodes.some(({ node }) => node.id === url.nodeId) ? url.nodeId : nodes[0]?.node.id ?? null;
  const rows = useMemo(
    () => (selectedNodeId ? filterRows(entriesForNode(entries, selectedNodeId), query) : []),
    [entries, selectedNodeId, query],
  );
  const selectedEntryId = rows.some((row) => row.entry.id === url.entryId) ? url.entryId : rows[0]?.entry.id ?? null;
  const selectedEntry = selectedEntryId ? entriesById.get(selectedEntryId) ?? null : null;

  const focusPane = useCallback((pane: Pane) => {
    ({ tree: treeRef, list: listRef, detail: detailRef })[pane].current?.focus();
  }, []);

  const movePaneFocus = useCallback((from: Pane, delta: -1 | 1) => {
    const next = PANES[PANES.indexOf(from) + delta];
    if (next) focusPane(next);
  }, [focusPane]);

  // `/` focuses the filter while focus is inside the directory (outside text
  // inputs). stopPropagation keeps the app-wide `/` search (a document
  // listener, above React's root) from also opening.
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    event.preventDefault();
    event.stopPropagation();
    filterRef.current?.focus();
  };

  const selectEntry = useCallback((entryId: string) => {
    const entry = entriesById.get(entryId);
    if (entry && !rows.some((row) => row.entry.id === entryId)) {
      // Selecting a parent outside the current node (e.g. "Spawned by") jumps
      // to the location node, where every entry is listed.
      url.setNode(`loc:${entry.location}`);
      setQuery('');
    }
    url.setEntry(entryId);
  }, [entriesById, rows, url]);

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const index = nodes.findIndex(({ node }) => node.id === selectedNodeId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nodes[Math.min(nodes.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) url.setNode(next.node.id);
    } else if (event.key === 'Enter' || event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      focusPane('list');
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const index = rows.findIndex((row) => row.entry.id === selectedEntryId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) url.setEntry(next.entry.id);
    } else if (event.key === 'Enter' || event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      focusPane('detail');
    } else if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      movePaneFocus('list', -1);
    }
  };

  const onDetailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      movePaneFocus('detail', -1);
    }
  };

  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      focusPane('list');
    } else if (event.key === 'Escape') {
      setQuery('');
      focusPane('list');
    }
  };

  // WAI-ARIA tree pattern: collapsing a node that contains the selection moves
  // the selection to that node, so the selection never hides and silently
  // falls back to the first visible row. The selected entry is listed under
  // the ancestor too, so it stays selected.
  const toggleNode = (nodeId: string) => {
    const collapsing = !collapsed.has(nodeId);
    if (collapsing && selectedNodeId && selectedNodeId !== nodeId) {
      const target = nodes.find(({ node }) => node.id === nodeId)?.node;
      if (target && containsNode(target, selectedNodeId)) {
        url.setNode(nodeId);
        if (selectedEntryId) url.setEntry(selectedEntryId);
      }
    }
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <div
      data-component="agents-directory"
      onKeyDown={onRootKeyDown}
      className="h-full min-h-0 w-full"
    >
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        id="agents-directory"
        className="h-full min-h-0"
      >
        <Panel id="tree" defaultSize="20%" minSize="12%" collapsible collapsedSize="0%" className="flex h-full min-w-0 flex-col overflow-hidden">
          <DirectoryTree
            ref={treeRef}
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            collapsed={collapsed}
            windowHours={url.windowHours}
            onSelect={url.setNode}
            onToggle={toggleNode}
            onWindowChange={url.setWindow}
            onKeyDown={onTreeKeyDown}
          />
        </Panel>
        <Separator className="w-px bg-border" />
        <Panel id="list" defaultSize="35%" minSize="20%" className="flex h-full min-w-0 flex-col overflow-hidden">
          <DirectoryList
            ref={listRef}
            rows={rows}
            selectedEntryId={selectedEntryId}
            query={query}
            windowHours={url.windowHours}
            loading={isLoading}
            error={isError}
            filterRef={filterRef}
            onQueryChange={setQuery}
            onFilterKeyDown={onFilterKeyDown}
            onSelect={url.setEntry}
            onKeyDown={onListKeyDown}
          />
        </Panel>
        <Separator className="w-px bg-border" />
        <Panel id="detail" defaultSize="45%" minSize="25%" className="flex h-full min-w-0 flex-col overflow-hidden">
          <div
            ref={detailRef}
            role="region"
            aria-label="Agent detail"
            tabIndex={0}
            onKeyDown={onDetailKeyDown}
            className="min-h-0 min-w-0 flex-1 overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <DirectoryDetail entry={selectedEntry} entriesById={entriesById} onSelectEntry={selectEntry} />
          </div>
        </Panel>
      </Group>
    </div>
  );
}
