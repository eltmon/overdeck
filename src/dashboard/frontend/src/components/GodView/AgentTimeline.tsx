import { useQuery } from '@tanstack/react-query';
import { Circle } from 'lucide-react';

interface TimelineEvent {
  timestamp: string;
  type: string;
  message: string;
}

interface AgentTimelineProps {
  agentId: string;
}

const TYPE_COLORS: Record<string, string> = {
  started: 'var(--gv-green)',
  stopped: 'var(--gv-text-dim)',
  error: 'var(--gv-pink)',
  commit: 'var(--gv-blue)',
  activity: 'var(--gv-text-secondary)',
};

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

export function AgentTimeline({ agentId }: AgentTimelineProps) {
  const { data } = useQuery({
    queryKey: ['agent-timeline', agentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}/timeline?limit=20`);
      if (!res.ok) return { timeline: [] };
      return res.json() as Promise<{ timeline: TimelineEvent[] }>;
    },
    refetchInterval: 30000,
    enabled: !!agentId,
  });

  const events = data?.timeline || [];

  if (events.length === 0) {
    return (
      <div className="text-[10px]" style={{ color: 'var(--gv-text-dim)' }}>
        No timeline events
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0 overflow-y-auto max-h-40">
      {events.map((event, i) => {
        const color = TYPE_COLORS[event.type] || TYPE_COLORS.activity;
        return (
          <div key={i} className="flex items-start gap-2 relative">
            {/* Vertical line */}
            {i < events.length - 1 && (
              <div
                className="absolute left-[5px] top-4 bottom-0 w-px"
                style={{ backgroundColor: 'var(--gv-border)' }}
              />
            )}
            <Circle
              className="w-2.5 h-2.5 shrink-0 mt-0.5 relative z-10"
              style={{ color, fill: color }}
            />
            <div className="flex flex-col gap-0.5 pb-2 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] gv-mono" style={{ color: 'var(--gv-text-dim)' }}>
                  {formatTime(event.timestamp)}
                </span>
                <span className="text-[9px] uppercase font-semibold" style={{ color }}>
                  {event.type}
                </span>
              </div>
              <span
                className="text-[10px] truncate leading-tight"
                style={{ color: 'var(--gv-text-secondary)' }}
              >
                {event.message}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
