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
  active: 'bg-green-500',
  stale: 'bg-yellow-500',
  warning: 'bg-orange-500',
  stuck: 'bg-red-500',
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
      <div className="flex items-center justify-center py-8 text-gray-500">
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
        <div className="h-3 bg-gray-800 rounded-full relative overflow-hidden">
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
        <div className="flex justify-between mt-2 text-xs text-gray-500">
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
              className="flex items-center justify-between text-sm py-2 px-3 bg-gray-800 rounded hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{STATE_EMOJI[event.state]}</span>
                <div>
                  <div className="text-white font-medium">{STATE_LABELS[event.state]}</div>
                  {event.previousState && (
                    <div className="text-xs text-gray-500">
                      Transitioned from {event.previousState}
                    </div>
                  )}
                  {event.source && (
                    <div className="text-xs text-gray-600 font-mono">{event.source}</div>
                  )}
                </div>
              </div>

              <div className="text-right">
                <div className="text-gray-400">{formatTime(event.timestamp)}</div>
                {duration !== null && (
                  <div className="text-xs text-gray-600">
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
            <span className="text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
