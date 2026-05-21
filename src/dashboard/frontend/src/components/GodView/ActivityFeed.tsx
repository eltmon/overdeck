import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { DashboardState } from '../../lib/store';
import { selectGodViewActivityFeed, type GodViewActivityEvent } from '../../hooks/useGodViewSocket';
import { useDashboardStore } from '../../lib/store';
import { formatRelativeTime } from '../../lib/formatRelativeTime';

async function fetchActivityREST(): Promise<GodViewActivityEvent[]> {
  const res = await fetch('/api/activity');
  if (!res.ok) throw new Error('Failed to fetch activity');
  return res.json() as Promise<GodViewActivityEvent[]>;
}

const EVENT_ICONS: Record<GodViewActivityEvent['level'], React.ReactNode> = {
  success: <CheckCircle2 className="w-3 h-3 shrink-0" />,
  error: <XCircle className="w-3 h-3 shrink-0" />,
  warn: <AlertTriangle className="w-3 h-3 shrink-0" />,
  info: <Info className="w-3 h-3 shrink-0" />,
};

const EVENT_COLORS: Record<GodViewActivityEvent['level'], string> = {
  success: 'var(--gv-green)',
  info: 'var(--gv-blue)',
  error: 'var(--gv-pink)',
  warn: 'var(--gv-amber)',
};

function isActivityForIssue(event: GodViewActivityEvent, issueId: string): boolean {
  if (event.issueId) {
    return event.issueId.toUpperCase() === issueId.toUpperCase();
  }

  if (!event.agentId) return false;
  return event.agentId.toLowerCase() === `agent-${issueId.toLowerCase()}`;
}

export const selectIssueActivityFeed =
  (issueId: string) =>
  (s: DashboardState): GodViewActivityEvent[] =>
    selectGodViewActivityFeed(s).filter((event) => isActivityForIssue(event, issueId));

interface ActivityFeedProps {
  issueId?: string;
}

export function ActivityFeed({ issueId }: ActivityFeedProps = {}) {
  const recentActivity = useDashboardStore(issueId ? selectIssueActivityFeed(issueId) : selectGodViewActivityFeed);
  const { data: restActivity = [] } = useQuery({
    queryKey: ['god-view-activity'],
    queryFn: fetchActivityREST,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const events = useMemo<GodViewActivityEvent[]>(() => {
    const byId = new Map<string, GodViewActivityEvent>();
    for (const event of recentActivity ?? []) byId.set(event.id, event);
    for (const event of restActivity) {
      if (!issueId || isActivityForIssue(event, issueId)) byId.set(event.id, event);
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [issueId, recentActivity, restActivity]);

  return (
    <div className="flex flex-col gap-1 overflow-y-auto flex-1">
      <h3
        className="text-xs font-bold uppercase tracking-widest px-1 shrink-0"
        style={{ color: 'var(--gv-text-secondary)' }}
      >
        Activity
      </h3>
      <div className="flex flex-col gap-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="text-xs text-center py-4" style={{ color: 'var(--gv-text-dim)' }}>
            Awaiting events...
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {events.map((event: GodViewActivityEvent) => {
              const color = EVENT_COLORS[event.level] || EVENT_COLORS.info;
              const icon = EVENT_ICONS[event.level] || EVENT_ICONS.info;
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-start gap-1.5 px-1 py-1 rounded"
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                >
                  <span className="mt-0.5 shrink-0" style={{ color }}>
                    {icon}
                  </span>
                  <div className="flex flex-col min-w-0 gap-0.5">
                    <div className="flex items-center gap-1">
                      <span
                        className="text-[10px] font-semibold gv-mono truncate"
                        style={{ color }}
                        title={event.source}
                      >
                        {event.source}
                      </span>
                      <span className="text-[9px] shrink-0" style={{ color: 'var(--gv-text-dim)' }}>
                        {formatRelativeTime(event.timestamp, new Date())}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 min-w-0">
                      {event.issueId && (
                        <span
                          className="text-[9px] px-1 py-0.5 rounded shrink-0 gv-mono"
                          style={{
                            color: 'var(--gv-text-secondary)',
                            background: 'rgba(255,255,255,0.04)',
                          }}
                        >
                          {event.issueId}
                        </span>
                      )}
                      <span
                        className="text-[10px] truncate leading-tight"
                        style={{ color: 'var(--gv-text-secondary)' }}
                        title={event.message}
                      >
                        {event.message}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
