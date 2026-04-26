import { Activity } from 'lucide-react';

export interface HealthEvent {
  id: number;
  agentId: string;
  timestamp: string;
  state: 'active' | 'stale' | 'warning' | 'stuck';
  previousState?: string;
  source?: string;
  metadata?: Record<string, any>;
}

interface HealthHistoryTimelineProps {
  events: HealthEvent[];
  startTime: string;
  endTime: string;
}

const STATE_COLORS = {
  active: 'bg-success',
  stale: 'bg-warning',
  warning: 'bg-warning',
  stuck: 'bg-destructive',
};

const STATE_LABELS = {
  active: 'Active',
  stale: 'Stale',
  warning: 'Warning',
  stuck: 'Stuck',
};

const STATE_EMOJI = {
  active: '🟢',
  stale: '🟡',
  warning: '🟠',
  stuck: '🔴',
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

export function HealthHistoryTimeline({
  events,
  startTime,
  endTime,
}: HealthHistoryTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Activity className="w-5 h-5 mr-2" />
        <span>No health events in this time range</span>
      </div>
    );
  }

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const totalDuration = end - start;

  // Calculate position for each event as a percentage of the timeline
  const eventPositions = events.map((event) => {
    const eventTime = new Date(event.timestamp).getTime();
    const position = ((eventTime - start) / totalDuration) * 100;
    return {
      ...event,
      position: Math.max(0, Math.min(100, position)),
    };
  });

  return (
    <div className="space-y-4">
      {/* Timeline visualization */}
      <div className="relative">
        {/* Background track */}
        <div className="h-3 bg-card rounded-full relative overflow-hidden">
          {/* State duration bars */}
          {eventPositions.map((event, index) => {
            const nextEvent = eventPositions[index + 1];
            const endPos = nextEvent ? nextEvent.position : 100;
            const width = endPos - event.position;

            if (width <= 0) return null;

            return (
              <div
                key={event.id}
                className={`absolute h-full ${STATE_COLORS[event.state]} transition-all opacity-60`}
                style={{
                  left: `${event.position}%`,
                  width: `${width}%`,
                }}
                title={`${STATE_LABELS[event.state]}: ${formatTime(event.timestamp)} - ${
                  nextEvent ? formatTime(nextEvent.timestamp) : 'now'
                }`}
              />
            );
          })}

          {/* State change markers */}
          {eventPositions.map((event) => (
            <div
              key={`marker-${event.id}`}
              className="absolute top-0 h-full w-0.5 bg-white opacity-50"
              style={{ left: `${event.position}%` }}
            />
          ))}
        </div>

        {/* Time labels */}
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>{formatTime(startTime)}</span>
          <span>{formatTime(endTime)}</span>
        </div>
      </div>

      {/* Event list */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {events.slice().reverse().map((event, index, reversed) => {
          const prevEvent = reversed[index + 1];
          const duration = prevEvent
            ? new Date(event.timestamp).getTime() - new Date(prevEvent.timestamp).getTime()
            : null;

          return (
            <div
              key={event.id}
              className="flex items-center justify-between text-sm py-2 px-3 bg-card rounded hover:bg-card transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{STATE_EMOJI[event.state]}</span>
                <div>
                  <div className="text-foreground font-medium">{STATE_LABELS[event.state]}</div>
                  {event.previousState && (
                    <div className="text-xs text-muted-foreground">
                      Transitioned from {event.previousState}
                    </div>
                  )}
                  {event.source && (
                    <div className="text-xs text-muted-foreground font-mono">{event.source}</div>
                  )}
                </div>
              </div>

              <div className="text-right">
                <div className="text-muted-foreground">{formatTime(event.timestamp)}</div>
                {duration !== null && (
                  <div className="text-xs text-muted-foreground">
                    Duration: {formatDuration(duration)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 pt-2 text-xs">
        {Object.entries(STATE_LABELS).map(([state, label]) => (
          <div key={state} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-full ${STATE_COLORS[state as keyof typeof STATE_COLORS]}`} />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
