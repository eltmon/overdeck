/**
 * ActivityPanel — Live activity log with rich formatting and filtering (PAN-520)
 *
 * Data flow:
 *   emitActivityEntry() → event store → WebSocket → EventRouter
 *   → Zustand store (recentActivity[]) → ActivityPanel (via selector)
 *
 * Also polls GET /api/activity as a fallback for bootstrap.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Terminal, XCircle, Loader2, X, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useDashboardStore } from '../lib/store';

interface ActivityEntry {
  id: string;
  timestamp: string;
  source: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string | null;
  issueId?: string | null;
  /** Logical category for filtering: 'git', 'specialist', 'sync', or undefined */
  category?: string | null;
}

interface ActivityPanelProps {
  onClose: () => void;
}

async function fetchActivityREST(): Promise<ActivityEntry[]> {
  const res = await fetch('/api/activity');
  if (!res.ok) throw new Error('Failed to fetch activity');
  return res.json() as Promise<ActivityEntry[]>;
}

async function fetchGitActivity(): Promise<ActivityEntry[]> {
  const res = await fetch('/api/git-activity');
  if (!res.ok) return [];
  return res.json() as Promise<ActivityEntry[]>;
}

function LevelIcon({ level }: { level: ActivityEntry['level'] }) {
  switch (level) {
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />;
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
    case 'warn':
      return <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />;
    default:
      return <Info className="w-3.5 h-3.5 text-primary shrink-0" />;
  }
}

function levelBadgeClass(level: ActivityEntry['level']): string {
  switch (level) {
    case 'success': return 'bg-success/20 text-success text-xs px-1.5 py-0.5 rounded font-medium';
    case 'error':   return 'bg-destructive/20 text-destructive text-xs px-1.5 py-0.5 rounded font-medium';
    case 'warn':    return 'bg-warning/20 text-warning-foreground text-xs px-1.5 py-0.5 rounded font-medium';
    default:        return 'bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded font-medium';
  }
}

const SOURCE_COLORS: Record<string, string> = {
  'merge-agent':       'bg-purple-500/20 text-purple-400',
  'cloister':         'bg-blue-500/20 text-blue-400',
  'review-specialist':'bg-green-500/20 text-green-400',
  'test-specialist':   'bg-orange-500/20 text-orange-400',
  'dashboard':        'bg-gray-500/20 text-gray-400',
  'deploy-script':    'bg-cyan-500/20 text-cyan-400',
};

function SourceBadge({ source }: { source: string }) {
  const colorClass = SOURCE_COLORS[source] ?? 'bg-gray-500/20 text-gray-400';
  return (
    <span className={`${colorClass} text-xs px-1.5 py-0.5 rounded font-mono truncate max-w-28`}>
      {source}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 60_000) {
    const s = Math.floor(diff / 1000);
    return s <= 5 ? 'just now' : `${s}s ago`;
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return date.toLocaleString();
}

type LevelFilter = 'all' | ActivityEntry['level'];
type SourceFilter = 'all' | string;
type CategoryFilter = 'all' | 'git' | 'specialist' | 'sync';

interface FilterState {
  level: LevelFilter;
  source: SourceFilter;
  category: CategoryFilter;
  search: string;
  pinWarnings: boolean;
}

/** Infer category from source if not explicitly set */
function inferCategory(entry: ActivityEntry): string {
  if (entry.category) return entry.category;
  const src = entry.source ?? '';
  if (src === 'git') return 'git';
  if (src.includes('specialist') || src.includes('merge-agent') || src.includes('review') || src.includes('test')) return 'specialist';
  if (src.includes('sync') || src.includes('pull')) return 'sync';
  return 'other';
}

export function ActivityPanel({ onClose }: ActivityPanelProps) {
  const [filters, setFilters] = useState<FilterState>({
    level: 'all',
    source: 'all',
    category: 'all',
    search: '',
    pinWarnings: true,
  });
  const [showFilters, setShowFilters] = useState(false);

  const recentActivityRaw = useDashboardStore((s) => s.recentActivity) as unknown as ActivityEntry[];

  const { data: restActivities = [], isLoading: restLoading } = useQuery({
    queryKey: ['activity'],
    queryFn: fetchActivityREST,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const { data: gitActivities = [] } = useQuery({
    queryKey: ['git-activity'],
    queryFn: fetchGitActivity,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const activities = useMemo<ActivityEntry[]>(() => {
    const byId = new Map<string, ActivityEntry>();
    for (const a of recentActivityRaw ?? []) byId.set(a.id, a);
    for (const a of restActivities) byId.set(a.id, a);
    for (const a of gitActivities) byId.set(a.id, a);
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [recentActivityRaw, restActivities, gitActivities]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) if (a.source) set.add(a.source);
    return Array.from(set).sort();
  }, [activities]);

  const filtered = useMemo(() => {
    const matched = activities.filter((a) => {
      if (filters.level !== 'all' && a.level !== filters.level) return false;
      if (filters.source !== 'all' && a.source !== filters.source) return false;
      if (filters.category !== 'all' && inferCategory(a) !== filters.category) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!a.message.toLowerCase().includes(q) &&
            !a.source.toLowerCase().includes(q) &&
            !(a.details ?? '').toLowerCase().includes(q) &&
            !(a.issueId ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
    if (!filters.pinWarnings) return matched;
    // Pin warn/error to top, preserve timestamp order within each group
    const pinned = matched.filter((a) => a.level === 'warn' || a.level === 'error');
    const rest = matched.filter((a) => a.level !== 'warn' && a.level !== 'error');
    return [...pinned, ...rest];
  }, [activities, filters]);

  const isLoading = restLoading && activities.length === 0;

  return (
    <div className="flex flex-col h-full bg-surface-raised border-l border-divider">
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h2 className="font-medium text-content">Activity Log</h2>
          {activities.length > 0 && (
            <span className="text-xs text-content-muted bg-surface px-1.5 py-0.5 rounded-full">
              {filtered.length !== activities.length ? `${filtered.length}/${activities.length}` : activities.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`text-xs px-2 py-1 rounded ${showFilters ? 'bg-primary/20 text-primary' : 'text-content-muted hover:text-content'} transition-colors`}
            title="Toggle filters"
          >
            Filter
          </button>
          <button onClick={onClose} className="text-content-subtle hover:text-content p-1 ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="px-4 py-2 border-b border-divider flex flex-wrap gap-2 shrink-0 bg-surface-raised/80">
          <select
            value={filters.level}
            onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value as LevelFilter }))}
            className="text-xs bg-surface border border-divider rounded px-2 py-1 text-content"
          >
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>

          <select
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value as CategoryFilter }))}
            className="text-xs bg-surface border border-divider rounded px-2 py-1 text-content"
          >
            <option value="all">All types</option>
            <option value="git">Git</option>
            <option value="specialist">Specialist</option>
            <option value="sync">Sync</option>
          </select>

          <select
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value as SourceFilter }))}
            className="text-xs bg-surface border border-divider rounded px-2 py-1 text-content"
          >
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="text-xs bg-surface border border-divider rounded px-2 py-1 text-content flex-1 min-w-24 placeholder:text-content-muted"
          />

          <label className="flex items-center gap-1.5 text-xs text-content-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filters.pinWarnings}
              onChange={(e) => setFilters((f) => ({ ...f, pinWarnings: e.target.checked }))}
              className="accent-warning"
            />
            Pin warnings
          </label>

          {(filters.level !== 'all' || filters.source !== 'all' || filters.category !== 'all' || filters.search) && (
            <button
              onClick={() => setFilters({ level: 'all', source: 'all', category: 'all', search: '', pinWarnings: filters.pinWarnings })}
              className="text-xs text-content-muted hover:text-content underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-content-subtle">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-content-muted">
            <Terminal className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">{activities.length === 0 ? 'No activity yet' : 'No matches for filters'}</p>
            {activities.length === 0 && (
              <p className="text-xs mt-1">Agent events and restarts will appear here</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((activity) => (
              <div key={activity.id} className="p-3 hover:bg-surface/50 transition-colors">
                {/* Header row */}
                <div className="flex items-start gap-2 mb-1">
                  <LevelIcon level={activity.level} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <SourceBadge source={activity.source} />
                      <span className={levelBadgeClass(activity.level)}>{activity.level}</span>
                      {inferCategory(activity) !== 'other' && (
                        <span className="text-xs text-content-muted bg-surface/60 px-1 py-0.5 rounded font-mono">
                          {inferCategory(activity)}
                        </span>
                      )}
                      {activity.issueId && (
                        <span className="text-xs font-mono text-content-muted bg-surface px-1.5 py-0.5 rounded">
                          {activity.issueId}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-content-muted shrink-0 tabular-nums" title={activity.timestamp}>
                    {formatTimestamp(activity.timestamp)}
                  </span>
                </div>

                {/* Message */}
                <p className="text-sm text-content font-medium leading-snug mb-1">
                  {activity.message}
                </p>

                {/* Details (collapsible) */}
                {activity.details && (
                  <details className="mt-1">
                    <summary className="text-xs text-content-muted cursor-pointer hover:text-content">
                      Details
                    </summary>
                    <pre className="mt-1 bg-surface rounded p-2 text-xs text-content-body font-mono overflow-x-auto whitespace-pre-wrap">
                      {activity.details}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
