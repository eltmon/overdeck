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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SESSION_FEED_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

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
        {isStubTab(activeTab) ? (
          <StubTabEmptyState tab={activeTab} />
        ) : (
          <FeedTabContent tab={activeTab} onSelect={onSelect} now={now} />
        )}
      </div>
    </aside>
  );
}

type WiredSessionFeedTab = Exclude<SessionFeedTab, 'files' | 'comments'>;

type StubSessionFeedTab = Extract<SessionFeedTab, 'files' | 'comments'>;

function FeedTabContent({ tab, onSelect, now }: { tab: WiredSessionFeedTab; onSelect: (entry: SessionFeedEntry) => void; now: Date }) {
  const feed = useMergedFeed(tab);
  const groups = useMemo(
    () => groupByContiguousLabel(feed.entries, (entry) => formatBucketLabel(entry.timestamp, now)),
    [feed.entries, now],
  );
  const isEmpty = tab === 'all' ? feed.allEntries.length === 0 : feed.entries.length === 0;

  if (feed.error) return <p className="text-xs text-destructive">{feed.error.message}</p>;
  if (feed.isLoading) return <p className="text-xs text-muted-foreground">Loading activity…</p>;
  if (isEmpty) {
    return (
      <div data-testid={`session-feed-empty-${tab}`} className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        {EMPTY_STATES[tab]}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <BucketSection key={`${group.label}-${group.items[0]?.id ?? 'empty'}`} label={group.label} items={group.items} onSelect={onSelect} now={now} />
      ))}
    </div>
  );
}

function StubTabEmptyState({ tab }: { tab: StubSessionFeedTab }) {
  const description = tab === 'files'
    ? 'Aggregate file changes are not wired into the session feed yet.'
    : 'Issue comments are not cached for the session feed yet.';

  return (
    <div data-testid={`session-feed-empty-${tab}`} className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{EMPTY_STATES[tab]}</p>
      <p className="mt-1">{description}</p>
    </div>
  );
}

function isStubTab(tab: SessionFeedTab): tab is StubSessionFeedTab {
  return tab === 'files' || tab === 'comments';
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
      pushRoute(`/conv/${entry.conversationId}`);
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
    case 'placeholder':
      return;
  }
}

function pushRoute(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
