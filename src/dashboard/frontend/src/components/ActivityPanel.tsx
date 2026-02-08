import { useQuery } from '@tanstack/react-query';
import { Terminal, CheckCircle, XCircle, Loader2, X } from 'lucide-react';

interface ActivityEntry {
  id: string;
  timestamp: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
}

interface ActivityPanelProps {
  onClose: () => void;
}

async function fetchActivity(): Promise<ActivityEntry[]> {
  const res = await fetch('/api/activity');
  if (!res.ok) throw new Error('Failed to fetch activity');
  return res.json();
}

function StatusIcon({ status }: { status: ActivityEntry['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />;
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

export function ActivityPanel({ onClose }: ActivityPanelProps) {
  const { data: activities, isLoading } = useQuery({
    queryKey: ['activity'],
    queryFn: fetchActivity,
    refetchInterval: 1000, // Poll every second for live updates
  });

  return (
    <div className="flex flex-col h-full bg-surface-raised border-l border-divider">
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-blue-400" />
          <h2 className="font-medium text-content">Activity Log</h2>
        </div>
        <button onClick={onClose} className="text-content-subtle hover:text-content p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-content-subtle">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : !activities || activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-content-muted">
            <Terminal className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No activity yet</p>
            <p className="text-xs mt-1">Start an agent or create a workspace to see output here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {activities.map((activity) => (
              <div key={activity.id} className="p-3">
                {/* Activity header */}
                <div className="flex items-center gap-2 mb-2">
                  <StatusIcon status={activity.status} />
                  <code className="text-sm text-content font-mono flex-1 truncate">
                    {activity.command}
                  </code>
                  <span className="text-xs text-content-muted">{formatTime(activity.timestamp)}</span>
                </div>

                {/* Output */}
                <pre className="bg-surface rounded p-2 text-xs text-content-body font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {activity.output.length > 0
                    ? activity.output.join('\n')
                    : activity.status === 'running'
                    ? 'Waiting for output...'
                    : 'No output'}
                </pre>

                {/* Status badge */}
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      activity.status === 'running'
                        ? 'bg-blue-900/50 text-blue-400'
                        : activity.status === 'completed'
                        ? 'bg-green-900/50 text-green-400'
                        : 'bg-red-900/50 text-red-400'
                    }`}
                  >
                    {activity.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
