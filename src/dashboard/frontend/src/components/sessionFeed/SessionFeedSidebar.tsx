import { AnimatePresence, motion } from 'framer-motion';
import { History, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatBucketLabel, groupByContiguousLabel } from '../../lib/sessionFeedLabels';
import { BucketSection } from './BucketSection';
import type { SessionFeedEntry, SessionFeedTab } from './types';
import { useMergedFeed } from './useMergedFeed';
import { useDashboardStore, selectPendingInputSubjects, selectIssues } from '../../lib/store';
import { describePendingInput } from '../../lib/pendingInput';
import { useAskUserQuestionUiStore } from '../../lib/askUserQuestionUiStore';

// ActivityPanel.tsx is the raw activity log; CommandDeck/ActivityFeedSidebar.tsx is per-issue observations; this SessionFeedSidebar is the cross-session feed.
export const SESSION_FEED_TAB_STORAGE_KEY = 'panopticon.ui.sessionFeedSidebarTab';

interface SessionFeedSidebarProps {
  onClose?: () => void;
  onSelect?: (entry: SessionFeedEntry) => void;
  now?: Date;
  /** PAN-1561: project-scoped mode — filter the feed to these issue ids. */
  issueIds?: readonly string[];
  /** PAN-1561: No-project mode — show only activity with no associated issue. */
  unscoped?: boolean;
  /** Heading text (defaults to "Activity Feed"). */
  heading?: string;
  /** Embedded as a deck column — fills its container, no close button. */
  embedded?: boolean;
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

export function SessionFeedSidebar({ onClose, onSelect = navigateToFeedEntry, now = new Date(), issueIds, unscoped, heading = 'Activity Feed', embedded = false }: SessionFeedSidebarProps) {
  const [activeTab, setActiveTab] = useState<SessionFeedTab>(readStoredTab);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SESSION_FEED_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  return (
    <aside className={`flex h-full min-h-0 flex-col bg-background ${embedded ? 'w-full' : 'w-80 shrink-0 border-l border-border'}`} aria-label="Session activity feed">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="h-4 w-4" aria-hidden="true" />
          {heading}
        </div>
        {onClose && (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Close activity feed"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </header>

      <NeedsYouSection issueIds={issueIds} unscoped={unscoped} />

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
          <FeedTabContent tab={activeTab} onSelect={onSelect} now={now} issueIds={issueIds} unscoped={unscoped} />
        )}
      </div>
    </aside>
  );
}

/**
 * NeedsYouSection — pinned, always-visible list of every subject blocked
 * waiting on the operator across ALL surfaces (AskUserQuestion, plan-mode,
 * session-resume, and PermissionRequest), not just AskUserQuestions. The
 * durable counterpart to the transient toast / desktop notification: even after
 * a dialog is dismissed, the item stays reachable here until it is actually
 * resolved. Clicking re-opens/focuses the subject (App.tsx routes AUQ to its
 * dialog; other kinds focus the subject so its own responder — PlanCard /
 * ChannelPermissionDialog — is reachable). Scoped to `issueIds` (Project
 * Activity) unless `unscoped` (home Activity Feed). PAN-1395 / PAN-1520.
 */
function NeedsYouSection({ issueIds, unscoped }: { issueIds?: readonly string[]; unscoped?: boolean }) {
  const subjects = useDashboardStore(selectPendingInputSubjects);
  const issues = useDashboardStore(selectIssues);
  const requestReopen = useAskUserQuestionUiStore((s) => s.requestReopen);
  // PAN-1563 — honor the same answered/dismissed state the dialog uses so an
  // answered or dismissed item disappears from here too, not just the modal.
  const answeredToolUseIds = useAskUserQuestionUiStore((s) => s.answeredToolUseIds);
  const dismissedSubjectIds = useAskUserQuestionUiStore((s) => s.dismissedSubjectIds);

  // Resolve a friendly title per issue id so the entry reads like a human label
  // (e.g. the issue title) rather than the raw id. PAN-1520.
  const titleByIssueId = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues as Array<{ id?: string; title?: string }>) {
      if (i?.id && i.title) m.set(i.id, i.title);
    }
    return m;
  }, [issues]);

  const scoped = useMemo(() => {
    if (unscoped || !issueIds || issueIds.length === 0) return subjects;
    const wanted = new Set(issueIds.map((id) => id.toLowerCase()));
    return subjects.filter((s) => s.issueId && wanted.has(s.issueId.toLowerCase()));
  }, [subjects, issueIds, unscoped]);

  // PAN-1563 — build the visible rows: drop answered/dismissed subjects, then
  // collapse duplicates. Several agents on one issue (e.g. the review convoy:
  // correctness/security/performance/requirements) each surface a subject that
  // renders identically ("PAN-1190 · Waiting on your input"), so the operator
  // saw the same card N times. A distinct AskUserQuestion has its own toolUseId
  // and survives; otherwise we dedupe on the displayed label+detail so genuinely
  // different prompts are kept but indistinguishable rows collapse to one.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{
      key: string;
      agentId: string;
      label: string;
      detail: string;
      count: number;
      title: string;
    }> = [];
    for (const subject of scoped) {
      const toolUseId = subject.pendingAskUserQuestion?.toolUseId;
      if (toolUseId && answeredToolUseIds.has(toolUseId)) continue;
      if (dismissedSubjectIds.has(subject.agentId)) continue;
      const q = subject.pendingAskUserQuestion;
      const count = q?.questions?.length ?? 0;
      const detail = q?.questions?.[0]?.question ?? describePendingInput(subject.kinds);
      const label = (subject.issueId && titleByIssueId.get(subject.issueId)) || subject.issueId || subject.agentId;
      const dedupKey = toolUseId ?? `${subject.issueId ?? subject.agentId}::${label}::${detail}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push({ key: dedupKey, agentId: subject.agentId, label, detail, count, title: describePendingInput(subject.kinds) });
    }
    return out;
  }, [scoped, answeredToolUseIds, dismissedSubjectIds, titleByIssueId]);

  // Keep the section mounted while any raw subject exists so AnimatePresence can
  // animate the last answered/dismissed card out before the box collapses.
  if (scoped.length === 0) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/5 px-2 py-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        Needs you
      </div>
      <div className="flex flex-col gap-1">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.button
              key={row.key}
              layout
              initial={{ opacity: 0, height: 0, y: -4 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              type="button"
              onClick={() => requestReopen(row.agentId)}
              className="flex w-full flex-col items-start gap-0.5 overflow-hidden rounded border border-amber-500/30 bg-background px-2 py-1.5 text-left transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
              title={row.title}
            >
              <span className="text-xs font-medium text-foreground">
                {row.label}
                {row.count > 1 ? ` · ${row.count} questions` : ''}
              </span>
              <span className="w-full truncate text-xs text-muted-foreground">{row.detail}</span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

type WiredSessionFeedTab = Exclude<SessionFeedTab, 'files' | 'comments'>;

type StubSessionFeedTab = Extract<SessionFeedTab, 'files' | 'comments'>;

function FeedTabContent({ tab, onSelect, now, issueIds, unscoped }: { tab: WiredSessionFeedTab; onSelect: (entry: SessionFeedEntry) => void; now: Date; issueIds?: readonly string[]; unscoped?: boolean }) {
  const feed = useMergedFeed(tab);
  // PAN-1561 scoping: `unscoped` keeps only entries with no issue (the No-project
  // bucket); otherwise `issueIds` keeps entries for those issues (case-insensitive).
  const idSet = useMemo(
    () => (issueIds ? new Set(issueIds.map((id) => id.toLowerCase())) : null),
    [issueIds],
  );
  const scope = useMemo(() => {
    const keep = (e: SessionFeedEntry) =>
      unscoped ? e.issueId == null : !idSet || (!!e.issueId && idSet.has(e.issueId.toLowerCase()));
    return {
      entries: unscoped || idSet ? feed.entries.filter(keep) : feed.entries,
      allEntries: unscoped || idSet ? feed.allEntries.filter(keep) : feed.allEntries,
    };
  }, [feed.entries, feed.allEntries, idSet, unscoped]);
  const scopedEntries = scope.entries;
  const scopedAll = scope.allEntries;
  const groups = useMemo(
    () => groupByContiguousLabel(scopedEntries, (entry) => formatBucketLabel(entry.timestamp, now)),
    [scopedEntries, now],
  );
  const isEmpty = tab === 'all' ? scopedAll.length === 0 : scopedEntries.length === 0;

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
    case 'placeholder':
      return;
  }
}

function pushRoute(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
