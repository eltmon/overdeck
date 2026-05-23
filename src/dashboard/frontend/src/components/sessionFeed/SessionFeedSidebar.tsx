import { History, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatBucketLabel, groupByContiguousLabel } from '../../lib/sessionFeedLabels';
import { BucketSection } from './BucketSection';
import type { SessionFeedEntry, SessionFeedTab } from './types';
import { useMergedFeed } from './useMergedFeed';

// ActivityPanel.tsx is the raw activity log; CommandDeck/ActivityFeedSidebar.tsx is per-issue observations; this SessionFeedSidebar is the cross-session feed.
export const SESSION_FEED_TAB_STORAGE_KEY = 'panopticon.ui.sessionFeedSidebarTab';

interface SessionFeedSidebarProps {
  onClose: () => void;
  onSelect?: (entry: SessionFeedEntry) => void;
  now?: Date;
}

const TABS: Array<{ id: SessionFeedTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'chats', label: 'Chats' },
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' },
  { id: 'comments', label: 'Comments' },
  { id: 'activity', label: 'Activity' },
];

const EMPTY_STATES: Record<SessionFeedTab, string> = {
  all: 'No session activity yet.',
  chats: 'No chats yet.',
  files: 'Files feed coming soon.',
  git: 'No git activity yet.',
  comments: 'Comments feed coming soon.',
  activity: 'No activity updates yet.',
};

let loggedGitNavigationNoop = false;

export function SessionFeedSidebar({ onClose, onSelect = navigateToFeedEntry, now = new Date() }: SessionFeedSidebarProps) {
  const [activeTab, setActiveTab] = useState<SessionFeedTab>(readStoredTab);
  const feed = useMergedFeed(activeTab);
  const groups = useMemo(
    () => groupByContiguousLabel(feed.entries, (entry) => formatBucketLabel(entry.timestamp, now)),
    [feed.entries, now],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SESSION_FEED_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const isEmpty = activeTab === 'all' ? feed.allEntries.length === 0 : feed.entries.length === 0;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-background" aria-label="Session activity feed">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="h-4 w-4" aria-hidden="true" />
          Activity Feed
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Close activity feed"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div role="tablist" aria-label="Session feed tabs" className="grid grid-cols-3 gap-1 border-b border-border p-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id
              ? 'rounded-md bg-accent px-2 py-1 text-xs font-medium text-foreground'
              : 'rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {feed.error && <p className="text-xs text-destructive">{feed.error.message}</p>}
        {!feed.error && feed.isLoading && <p className="text-xs text-muted-foreground">Loading activity…</p>}
        {!feed.error && !feed.isLoading && isEmpty && (
          <div data-testid={`session-feed-empty-${activeTab}`} className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {EMPTY_STATES[activeTab]}
          </div>
        )}
        {!feed.error && !feed.isLoading && !isEmpty && (
          <div className="space-y-4">
            {groups.map((group) => (
              <BucketSection key={`${group.label}-${group.items[0]?.id ?? 'empty'}`} label={group.label} items={group.items} onSelect={onSelect} now={now} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function readStoredTab(): SessionFeedTab {
  if (typeof window === 'undefined') return 'all';
  const value = window.localStorage.getItem(SESSION_FEED_TAB_STORAGE_KEY);
  return isSessionFeedTab(value) ? value : 'all';
}

function isSessionFeedTab(value: string | null): value is SessionFeedTab {
  return value === 'all'
    || value === 'chats'
    || value === 'files'
    || value === 'git'
    || value === 'comments'
    || value === 'activity';
}

function navigateToFeedEntry(entry: SessionFeedEntry) {
  if (typeof window === 'undefined') return;

  switch (entry.kind) {
    case 'conversation':
      pushRoute(`/conv/${encodeURIComponent(entry.conversationName)}`);
      return;
    case 'activity':
      if (entry.issueId) pushRoute(`/command-deck?issue=${encodeURIComponent(entry.issueId)}&tab=activity`);
      return;
    case 'git':
      if (!loggedGitNavigationNoop) {
        console.debug('Session feed git entries do not have a destination yet.');
        loggedGitNavigationNoop = true;
      }
      return;
    case 'file_change':
    case 'comment':
      return;
  }
}

function pushRoute(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
