import { motion, AnimatePresence } from 'framer-motion';
import { GitCommit, TestTube, AlertTriangle, ArrowRightLeft, Activity } from 'lucide-react';
import type { DashboardState } from '../../lib/store';
import { selectGodViewActivityFeed, type GodViewActivityEvent } from '../../hooks/useGodViewSocket';
import { useDashboardStore } from '../../lib/store';

const EVENT_ICONS: Record<string, React.ReactNode> = {
  commit: <GitCommit className="w-3 h-3 shrink-0" />,
  test: <TestTube className="w-3 h-3 shrink-0" />,
  error: <AlertTriangle className="w-3 h-3 shrink-0" />,
  handoff: <ArrowRightLeft className="w-3 h-3 shrink-0" />,
  activity: <Activity className="w-3 h-3 shrink-0" />,
};

const EVENT_COLORS: Record<string, string> = {
  commit: 'var(--gv-green)',
  test: 'var(--gv-blue)',
  error: 'var(--gv-pink)',
  handoff: 'var(--gv-amber)',
  activity: 'var(--gv-text-secondary)',
};

function timeAgo(ts: string) {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

export const selectIssueActivityFeed =
  (issueId: string) =>
  (s: DashboardState): GodViewActivityEvent[] =>
    selectGodViewActivityFeed(s).filter((event) => {
      if (event.issueId) {
        return event.issueId.toUpperCase() === issueId.toUpperCase();
      }

      // Older activity events only carry agentId, so keep the historical fallback.
      // System/global events that lack both issueId and agentId fall through.
      if (!event.agentId) return false;
      return event.agentId.toLowerCase() === `agent-${issueId.toLowerCase()}`;
    });

interface ActivityFeedProps {
  issueId?: string;
}

export function ActivityFeed({ issueId }: ActivityFeedProps = {}) {
  const events = useDashboardStore(issueId ? selectIssueActivityFeed(issueId) : selectGodViewActivityFeed);

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
            {events.map((event: GodViewActivityEvent, i: number) => {
              const color = EVENT_COLORS[event.type] || EVENT_COLORS.activity;
              const icon = EVENT_ICONS[event.type] || EVENT_ICONS.activity;
              return (
                <motion.div
                  key={`${event.agentId}-${event.timestamp}-${i}`}
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
                      >
                        {event.agentId}
                      </span>
                      <span className="text-[9px] shrink-0" style={{ color: 'var(--gv-text-dim)' }}>
                        {timeAgo(event.timestamp)}
                      </span>
                    </div>
                    <span
                      className="text-[10px] truncate leading-tight"
                      style={{ color: 'var(--gv-text-secondary)' }}
                    >
                      {event.message}
                    </span>
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
