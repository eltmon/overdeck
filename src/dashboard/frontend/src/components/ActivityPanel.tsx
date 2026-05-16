/**
 * ActivityPanel — Live activity log with 3 streams: Normal, Detailed, TTS (PAN-520)
 *
 * Data flow:
 *   emitActivityEntry()     → event store → WebSocket → recentActivity     (Normal)
 *   emitActivityDetailed()  → event store → WebSocket → detailedActivity   (Detailed)
 *   emitActivityTts()       → event store → WebSocket → ttsActivity        (TTS)
 *
 * Also polls GET /api/activity/* as fallback for bootstrap.
 */

import { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Terminal, XCircle, Loader2, X, Info, AlertTriangle, CheckCircle2, Volume2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardStore } from '../lib/store';

export interface ActivityEntry {
  id: string;
  timestamp: string;
  source: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string | null;
  issueId?: string | null;
  category?: string | null;
  triggeringEvent?: string | null;
}

export interface TtsEntry {
  id: string;
  timestamp: string;
  utterance: string;
  priority?: number | null;
  issueId?: string | null;
}

type ActivityStream = 'normal' | 'detailed' | 'tts';

interface ActivityPanelProps {
  onClose: () => void;
}

async function fetchActivityREST(): Promise<ActivityEntry[]> {
  const res = await fetch('/api/activity');
  if (!res.ok) throw new Error('Failed to fetch activity');
  return res.json() as Promise<ActivityEntry[]>;
}

async function fetchDetailedActivityREST(): Promise<ActivityEntry[]> {
  const res = await fetch('/api/activity/detailed');
  if (!res.ok) throw new Error('Failed to fetch detailed activity');
  return res.json() as Promise<ActivityEntry[]>;
}

async function fetchTtsActivityREST(): Promise<TtsEntry[]> {
  const res = await fetch('/api/activity/tts');
  if (!res.ok) throw new Error('Failed to fetch TTS activity');
  return res.json() as Promise<TtsEntry[]>;
}

async function fetchGitActivity(): Promise<ActivityEntry[]> {
  const res = await fetch('/api/git-activity');
  if (!res.ok) return [];
  return res.json() as Promise<ActivityEntry[]>;
}

async function replayTtsUtterance(text: string): Promise<void> {
  const res = await fetch('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await res.json().catch(() => undefined) as { spoken?: unknown; result?: unknown; error?: unknown } | undefined;
  const error = typeof body?.error === 'string' ? body.error : undefined;
  const result = typeof body?.result === 'string' ? body.result : undefined;

  if (!res.ok) throw new Error(error || result || 'TTS daemon unavailable');
  if (body?.spoken !== true) throw new Error(error || (result ? `TTS did not speak (${result})` : 'TTS daemon unavailable'));
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
  plan:        'bg-indigo-500/20 text-indigo-400',
  work:        'bg-blue-500/20 text-blue-400',
  review:     'bg-green-500/20 text-green-400',
  test:       'bg-orange-500/20 text-orange-400',
  ship:       'bg-purple-500/20 text-purple-400',
  cloister:   'bg-blue-500/20 text-blue-400',
  dashboard:  'bg-gray-500/20 text-gray-400',
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
type CategoryFilter = 'all' | 'git' | 'role' | 'sync';

interface FilterState {
  level: LevelFilter;
  source: SourceFilter;
  category: CategoryFilter;
  search: string;
  pinWarnings: boolean;
}

/** Infer category from source if not explicitly set */
export function inferCategory(entry: ActivityEntry): string {
  if (entry.category) return entry.category;
  const src = entry.source ?? '';
  if (src === 'git') return 'git';
  if (src === 'plan' || src === 'work' || src === 'review' || src === 'test' || src === 'ship') return 'role';
  if (src.includes('sync') || src.includes('pull')) return 'sync';
  return 'other';
}

/** Merge activity arrays from multiple sources, deduplicating by id, sorted newest-first */
export function mergeActivitiesById(...sources: ActivityEntry[][]): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>();
  for (const arr of sources) {
    for (const a of arr ?? []) byId.set(a.id, a);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/** Apply pinWarnings: move warn/error entries to the top while preserving order within groups */
export function applyPinWarnings(matched: ActivityEntry[], pinWarnings: boolean): ActivityEntry[] {
  if (!pinWarnings) return matched;
  const pinned = matched.filter((a) => a.level === 'warn' || a.level === 'error');
  const rest = matched.filter((a) => a.level !== 'warn' && a.level !== 'error');
  return [...pinned, ...rest];
}

function ActivityItem({ activity }: { activity: ActivityEntry }) {
  return (
    <div className="p-3 hover:bg-card/50 transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-2 mb-1">
        <LevelIcon level={activity.level} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <SourceBadge source={activity.source} />
            <span className={levelBadgeClass(activity.level)}>{activity.level}</span>
            {inferCategory(activity) !== 'other' && (
              <span className="text-xs text-muted-foreground bg-card/60 px-1 py-0.5 rounded font-mono">
                {inferCategory(activity)}
              </span>
            )}
            {activity.issueId && (
              <span className="text-xs font-mono text-muted-foreground bg-card px-1.5 py-0.5 rounded">
                {activity.issueId}
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums" title={activity.timestamp}>
          {formatTimestamp(activity.timestamp)}
        </span>
      </div>

      {/* Message */}
      <p className="text-sm text-foreground font-medium leading-snug mb-1">
        {activity.message}
      </p>

      {/* Details (collapsible) */}
      {activity.details && (
        <details className="mt-1 group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
            Details
          </summary>
          <pre className="mt-1 bg-card rounded p-2 text-xs text-foreground font-mono overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
            {activity.details.replace(/\x1b\[[0-9;]*m/g, '')}
          </pre>
        </details>
      )}

      {/* Triggering event (detailed stream only) */}
      {activity.triggeringEvent && (
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          event: {activity.triggeringEvent}
        </p>
      )}
    </div>
  );
}

function TtsItem({ entry }: { entry: TtsEntry }) {
  const replayMutation = useMutation({
    mutationFn: replayTtsUtterance,
    onError: (error: Error) => toast.error(`Failed to replay TTS: ${error.message}`),
  });

  return (
    <div className="p-3 hover:bg-card/50 transition-colors">
      <div className="flex items-start gap-2">
        <Volume2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground font-medium leading-snug">
            {entry.utterance}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {entry.issueId && (
              <span className="text-xs font-mono text-muted-foreground bg-card px-1.5 py-0.5 rounded">
                {entry.issueId}
              </span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums" title={entry.timestamp}>
              {formatTimestamp(entry.timestamp)}
            </span>
            {entry.priority !== undefined && entry.priority !== null && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                entry.priority === 0 ? 'bg-destructive/20 text-destructive'
                : entry.priority === 1 ? 'bg-warning/20 text-warning-foreground'
                : 'bg-primary/20 text-primary'
              }`}>
                P{entry.priority}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => replayMutation.mutate(entry.utterance)}
          disabled={replayMutation.isPending}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-popover hover:text-foreground disabled:opacity-50"
          aria-label={`Replay TTS utterance: ${entry.utterance}`}
          title="Replay TTS utterance"
          data-testid={`tts-activity-replay-${entry.id}`}
        >
          {replayMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function ActivityPanel({ onClose }: ActivityPanelProps) {
  const [activeStream, setActiveStream] = useState<ActivityStream>('normal');
  const [filters, setFilters] = useState<FilterState>({
    level: 'all',
    source: 'all',
    category: 'all',
    search: '',
    pinWarnings: true,
  });
  const [showFilters, setShowFilters] = useState(false);

  // Real-time data from Zustand store
  const recentActivityRaw = useDashboardStore((s) => s.recentActivity) as unknown as ActivityEntry[];
  const detailedActivityRaw = useDashboardStore((s) => s.detailedActivity) as unknown as ActivityEntry[];
  const ttsActivityRaw = useDashboardStore((s) => s.ttsActivity) as unknown as TtsEntry[];

  // REST fallback polling
  const { data: restActivities = [], isLoading: restLoading } = useQuery({
    queryKey: ['activity'],
    queryFn: fetchActivityREST,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const { data: restDetailed = [], isLoading: detailedLoading } = useQuery({
    queryKey: ['activity-detailed'],
    queryFn: fetchDetailedActivityREST,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const { data: restTts = [], isLoading: ttsLoading } = useQuery({
    queryKey: ['activity-tts'],
    queryFn: fetchTtsActivityREST,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const { data: gitActivities = [] } = useQuery({
    queryKey: ['git-activity'],
    queryFn: fetchGitActivity,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  // Merge real-time + REST for each stream
  const normalActivities = useMemo<ActivityEntry[]>(
    () => mergeActivitiesById(recentActivityRaw ?? [], restActivities, gitActivities),
    [recentActivityRaw, restActivities, gitActivities]
  );

  const detailedActivities = useMemo<ActivityEntry[]>(
    () => mergeActivitiesById(detailedActivityRaw ?? [], restDetailed),
    [detailedActivityRaw, restDetailed]
  );

  const ttsActivities = useMemo<TtsEntry[]>(
    () => {
      const byId = new Map<string, TtsEntry>();
      for (const arr of [ttsActivityRaw ?? [], restTts]) {
        for (const a of arr ?? []) byId.set(a.id, a);
      }
      return Array.from(byId.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    },
    [ttsActivityRaw, restTts]
  );

  // Current stream data
  const currentActivities = activeStream === 'normal' ? normalActivities
    : activeStream === 'detailed' ? detailedActivities
    : [];

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const a of currentActivities) if (a.source) set.add(a.source);
    return Array.from(set).sort();
  }, [currentActivities]);

  const filtered = useMemo(() => {
    if (activeStream === 'tts') return [];
    const matched = (currentActivities as ActivityEntry[]).filter((a) => {
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
    return applyPinWarnings(matched, filters.pinWarnings);
  }, [currentActivities, filters, activeStream]);

  const isLoading = (activeStream === 'normal' && restLoading && normalActivities.length === 0)
    || (activeStream === 'detailed' && detailedLoading && detailedActivities.length === 0)
    || (activeStream === 'tts' && ttsLoading && ttsActivities.length === 0);

  const totalCount = activeStream === 'normal' ? normalActivities.length
    : activeStream === 'detailed' ? detailedActivities.length
    : ttsActivities.length;

  const displayCount = activeStream === 'tts' ? ttsActivities.length : filtered.length;

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h2 className="font-medium text-foreground">Activity Log</h2>
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground bg-card px-1.5 py-0.5 rounded-full">
              {displayCount !== totalCount ? `${displayCount}/${totalCount}` : totalCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeStream !== 'tts' && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`text-xs px-2 py-1 rounded ${showFilters ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              title="Toggle filters"
            >
              Filter
            </button>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stream tabs */}
      <div className="flex border-b border-border shrink-0">
        {(['normal', 'detailed', 'tts'] as ActivityStream[]).map((stream) => (
          <button
            key={stream}
            onClick={() => { setActiveStream(stream); setShowFilters(false); }}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeStream === stream
                ? 'bg-primary/10 text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
            }`}
          >
            {stream === 'normal' ? 'Normal'
              : stream === 'detailed' ? 'Detailed'
              : 'TTS'}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      {showFilters && activeStream !== 'tts' && (
        <div className="px-4 py-2 border-b border-border flex flex-wrap gap-2 shrink-0 bg-card/80">
          <select
            value={filters.level}
            onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value as LevelFilter }))}
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
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
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="all">All types</option>
            <option value="git">Git</option>
            <option value="role">Roles</option>
            <option value="sync">Sync</option>
          </select>

          <select
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value as SourceFilter }))}
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
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
            className="text-xs bg-card border border-border rounded px-2 py-1 text-foreground flex-1 min-w-24 placeholder:text-muted-foreground"
          />

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
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
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : activeStream === 'tts' ? (
          ttsActivities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Volume2 className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No TTS utterances yet</p>
              <p className="text-xs mt-1">Major milestones will be spoken aloud</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {ttsActivities.map((entry) => (
                <TtsItem key={entry.id} entry={entry} />
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <Terminal className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">{currentActivities.length === 0 ? 'No activity yet' : 'No matches for filters'}</p>
            {currentActivities.length === 0 && (
              <p className="text-xs mt-1">Agent events and restarts will appear here</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((activity) => (
              <ActivityItem key={activity.id} activity={activity} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
