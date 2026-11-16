/**
 * LeftColumn — the one left column that replaces the Sidebar and the Command
 * Deck's own column (PAN-5293 F-D3, F-D18). Top to bottom: project switcher,
 * nav, New conversation, then one scroll area with the Conversations, Issues
 * and Workspaces sections, then the footer. It shows the selected project's
 * lists on every route.
 *
 * Width 264 px by default, drag-resizable 240–640 px on its right edge,
 * collapsible to 48 px with `[`, all persisted per viewer. Below 900 px it is
 * a drawer: hidden until "Open navigation", closed by its overlay or by any
 * navigation. It also mounts DeckDataHost (the session-tree subscription)
 * and DeckDialogsHost (fork modal, Plan dialog).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Tab } from '../Header';
import { useShortcut, type ShortcutDef } from '../../lib/shortcuts/registry';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { ProjectSwitcher } from './ProjectSwitcher';
import { LeftNav } from './LeftNav';
import { NewConversationButton } from './NewConversationButton';
import { ConversationsSection } from './ConversationsSection';
import { IssuesSection } from './IssuesSection';
import { WorkspacesSection } from './WorkspacesSection';
import { LeftColumnFooter } from './LeftColumnFooter';
import { useDeckNavigation } from './deck/deckNavigation';
import { DeckDataHost } from './deck/DeckDataHost';
import { DeckDialogsHost } from './deck/DeckDialogsHost';
import { ALL_PROJECTS_KEY } from '../../lib/deckKeys';

export const LEFT_COLUMN_WIDTH_KEY = 'overdeck.ui.leftColumnWidth';
export const LEFT_COLUMN_COLLAPSED_KEY = 'overdeck.ui.leftColumnCollapsed';
export const LEFT_COLUMN_DEFAULT_WIDTH = 264;
export const LEFT_COLUMN_MIN_WIDTH = 240;
export const LEFT_COLUMN_MAX_WIDTH = 640;
export const LEFT_COLUMN_COLLAPSED_WIDTH = 48;
/** Below this window width the column is a drawer. */
export const LEFT_COLUMN_DRAWER_QUERY = '(max-width: 899px)';
/** The app bar's "Open navigation" button (AppChrome) dispatches this window event. */
export const OPEN_LEFT_COLUMN_EVENT = 'overdeck:open-left-column';

const clampWidth = (width: number) => Math.max(LEFT_COLUMN_MIN_WIDTH, Math.min(LEFT_COLUMN_MAX_WIDTH, width));

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(LEFT_COLUMN_WIDTH_KEY));
    return saved ? clampWidth(saved) : LEFT_COLUMN_DEFAULT_WIDTH;
  } catch {
    return LEFT_COLUMN_DEFAULT_WIDTH;
  }
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(LEFT_COLUMN_COLLAPSED_KEY) === 'true'; } catch { return false; }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

export interface LeftColumnProps {
  activeTab: Tab;
  selectedProject: string | null;
  onTabChange: (tab: Tab) => void;
  onNewProject: () => void;
  onNewWorkspace: (projectKey?: string) => void;
  onOpenUpdater: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenShortcuts: () => void;
}

export function LeftColumn({
  activeTab, selectedProject, onTabChange, onNewProject, onNewWorkspace, onOpenUpdater, onSelectWorkspace, onOpenShortcuts,
}: LeftColumnProps) {
  const { selectProject } = useDeckNavigation();
  const [width, setWidth] = useState(readWidth);
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed);
  const isDrawer = useMediaQuery(LEFT_COLUMN_DRAWER_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The drawer always shows the full column.
  const collapsed = collapsedPref && !isDrawer;

  const toggleCollapsed = useCallback(() => {
    setCollapsedPref((prev) => {
      const next = !prev;
      try { localStorage.setItem(LEFT_COLUMN_COLLAPSED_KEY, String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);
  useShortcut(useMemo((): ShortcutDef => ({
    id: 'frame.collapse', keys: { mac: '[', other: '[' }, scope: 'not-editing', label: 'Collapse left column',
    group: 'General', run: () => toggleCollapsed(),
  }), [toggleCollapsed]));

  useEffect(() => {
    const open = () => setDrawerOpen(true);
    window.addEventListener(OPEN_LEFT_COLUMN_EVENT, open);
    return () => window.removeEventListener(OPEN_LEFT_COLUMN_EVENT, open);
  }, []);

  // Any navigation closes the drawer: a route, project or selection change.
  const selectedConversation = useCommandDeckSelection((s) => s.selectedConversation);
  const selectedFeature = useCommandDeckSelection((s) => s.selectedFeature);
  useEffect(() => {
    setDrawerOpen(false);
  }, [activeTab, selectedProject, selectedConversation, selectedFeature]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;
  const handleResizeStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current };
    const onMove = (move: MouseEvent) => {
      if (!dragRef.current) return;
      setWidth(clampWidth(dragRef.current.startWidth + move.clientX - dragRef.current.startX));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      try { localStorage.setItem(LEFT_COLUMN_WIDTH_KEY, String(widthRef.current)); } catch { /* storage unavailable */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }, []);

  const shownWidth = collapsed ? LEFT_COLUMN_COLLAPSED_WIDTH : width;
  const hidden = isDrawer && !drawerOpen;

  return (
    <>
      <DeckDataHost />
      <DeckDialogsHost selectedProject={selectedProject} />
      {isDrawer && drawerOpen && (
        <div data-testid="left-column-overlay" className="fixed inset-0 z-40 bg-black/40" onClick={() => setDrawerOpen(false)} />
      )}
      <aside
        data-testid="left-column"
        data-collapsed={collapsed ? 'true' : undefined}
        aria-label="Navigation"
        aria-hidden={hidden || undefined}
        style={{ width: shownWidth, minWidth: shownWidth }}
        // A display class, not the hidden attribute: Tailwind's `flex` would override [hidden].
        className={`${hidden ? 'hidden' : 'flex'} h-full shrink-0 flex-col border-r border-border bg-card ${isDrawer ? 'fixed inset-y-0 left-0 z-50 shadow-overlay' : 'relative'}`}
      >
        <div className={`flex shrink-0 flex-col gap-1 ${collapsed ? 'items-center px-1 py-2' : 'p-2'}`}>
          <ProjectSwitcher
            selectedProject={selectedProject}
            onSelectProject={(name) => selectProject(name)}
            onNewProject={onNewProject}
            onNewWorkspace={onNewWorkspace}
            collapsed={collapsed}
          />
          <LeftNav
            activeTab={activeTab}
            selectedProject={selectedProject}
            onTabChange={onTabChange}
            onOpenProjectHome={() => selectProject(selectedProject)}
            collapsed={collapsed}
          />
          <NewConversationButton selectedProject={selectedProject} collapsed={collapsed} />
        </div>
        {!collapsed && (
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="left-column-lists">
            {selectedProject === null ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Pick a project to see its conversations and issues</p>
            ) : (
              <>
                <ConversationsSection selectedProject={selectedProject} />
                {/* PAN-5343 H-D4: issues and workspaces belong to one project, so the All projects deck hides them. */}
                {selectedProject !== ALL_PROJECTS_KEY && (
                  <>
                    <IssuesSection selectedProject={selectedProject} />
                    <WorkspacesSection selectedProject={selectedProject} onSelectWorkspace={onSelectWorkspace} onNewWorkspace={onNewWorkspace} />
                  </>
                )}
              </>
            )}
          </div>
        )}
        {collapsed && <div className="flex-1" />}
        <LeftColumnFooter
          activeTab={activeTab}
          onTabChange={onTabChange}
          onOpenUpdater={onOpenUpdater}
          onOpenShortcuts={onOpenShortcuts}
          collapsed={collapsed}
        />
        {!collapsed && !isDrawer && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation"
            data-testid="left-column-resize"
            onMouseDown={handleResizeStart}
            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
          />
        )}
      </aside>
    </>
  );
}
