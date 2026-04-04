import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Brain,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Loader2,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { GraceCountdown } from '../components/GraceCountdown';

interface RunLogEntry {
  runId: string;
  filePath: string;
  metadata: {
    runId: string;
    project: string;
    specialistType: string;
    issueId: string;
    startedAt: string;
    finishedAt?: string;
    status?: 'passed' | 'failed' | 'blocked' | 'incomplete';
    duration?: number;
    notes?: string;
  };
  fileSize: number;
  createdAt: Date;
}

interface GracePeriodState {
  active: boolean;
  startedAt: string;
  duration: number;
  paused: boolean;
  pausedAt?: string;
  remainingTime?: number;
}

async function fetchRunLogs(project: string, type: string): Promise<RunLogEntry[]> {
  const res = await fetch(`/api/specialists/${project}/${type}/runs?limit=50`);
  if (!res.ok) throw new Error('Failed to fetch run logs');
  return res.json();
}

async function fetchContextDigest(project: string, type: string): Promise<string | null> {
  const res = await fetch(`/api/specialists/${project}/${type}/context`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch context digest');
  const data = await res.json();
  return data.digest;
}

async function regenerateContextDigest(project: string, type: string): Promise<string> {
  const res = await fetch(`/api/specialists/${project}/${type}/context/regenerate`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to regenerate context digest');
  const data = await res.json();
  return data.digest;
}

async function fetchGracePeriod(project: string, type: string): Promise<GracePeriodState | null> {
  const res = await fetch(`/api/specialists/${project}/${type}/grace`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch grace period');
  return res.json();
}

const STATUS_ICONS = {
  passed: <CheckCircle className="w-4 h-4 text-green-400" />,
  failed: <XCircle className="w-4 h-4 text-red-400" />,
  blocked: <AlertCircle className="w-4 h-4 text-yellow-400" />,
  incomplete: <Clock className="w-4 h-4 text-content-subtle" />,
};

const STATUS_COLORS = {
  passed: 'bg-green-900 bg-opacity-20 text-green-400 border-green-600',
  failed: 'bg-red-900 bg-opacity-20 text-red-400 border-red-600',
  blocked: 'bg-yellow-900 bg-opacity-20 text-yellow-400 border-yellow-600',
  incomplete: 'bg-surface bg-opacity-20 text-content-subtle border-divider-strong',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const secs = seconds % 60;
  const mins = minutes % 60;

  if (hours > 0) return `${hours}h ${mins}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${seconds}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function SpecialistDetail() {
  const { project, type } = useParams<{ project: string; type: string }>();
  const queryClient = useQueryClient();

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['specialist-runs', project, type],
    queryFn: () => fetchRunLogs(project!, type!),
    enabled: !!project && !!type,
    refetchInterval: 5000,
  });

  const { data: contextDigest } = useQuery({
    queryKey: ['context-digest', project, type],
    queryFn: () => fetchContextDigest(project!, type!),
    enabled: !!project && !!type,
  });

  const { data: gracePeriod } = useQuery({
    queryKey: ['grace-period', project, type],
    queryFn: () => fetchGracePeriod(project!, type!),
    enabled: !!project && !!type,
    refetchInterval: 30000,
  });

  const regenerateMutation = useMutation({
    mutationFn: () => regenerateContextDigest(project!, type!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['context-digest', project, type] });
    },
  });

  if (!project || !type) {
    return <div className="text-red-400">Invalid parameters</div>;
  }

  if (runsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-content-subtle animate-spin" />
      </div>
    );
  }

  const stats = runs?.reduce(
    (acc, run) => {
      if (run.metadata.status === 'passed') acc.passed++;
      if (run.metadata.status === 'failed') acc.failed++;
      if (run.metadata.status === 'blocked') acc.blocked++;
      return acc;
    },
    { passed: 0, failed: 0, blocked: 0 }
  ) || { passed: 0, failed: 0, blocked: 0 };

  return (
    <div className="h-full overflow-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/specialists"
          className="flex items-center gap-2 text-content-subtle hover:text-content mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Specialists
        </Link>

        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold text-content">
              {project} / {type}
            </h1>
            <div className="text-content-subtle">{runs?.length || 0} total runs</div>
          </div>
        </div>
      </div>

      {/* Grace period countdown */}
      {gracePeriod && gracePeriod.active && (
        <div className="mb-6">
          <GraceCountdown project={project} type={type} gracePeriod={gracePeriod} />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-green-900 bg-opacity-20 border border-green-600 rounded-lg">
          <div className="text-green-400 text-2xl font-bold">{stats.passed}</div>
          <div className="text-green-300 text-sm">Passed</div>
        </div>
        <div className="p-4 bg-red-900 bg-opacity-20 border border-red-600 rounded-lg">
          <div className="text-red-400 text-2xl font-bold">{stats.failed}</div>
          <div className="text-red-300 text-sm">Failed</div>
        </div>
        <div className="p-4 bg-yellow-900 bg-opacity-20 border border-yellow-600 rounded-lg">
          <div className="text-yellow-400 text-2xl font-bold">{stats.blocked}</div>
          <div className="text-yellow-300 text-sm">Blocked</div>
        </div>
      </div>

      {/* Context digest */}
      <div className="mb-6 p-4 bg-surface-raised rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium text-content">Context Digest</h2>
          <button
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            className="flex items-center gap-2 px-3 py-1 text-sm text-blue-400 hover:text-blue-300 hover:bg-surface-overlay rounded disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        </div>
        {contextDigest ? (
          <pre className="text-sm text-content-body whitespace-pre-wrap max-h-64 overflow-auto">
            {contextDigest}
          </pre>
        ) : (
          <div className="text-content-muted">No context digest available yet</div>
        )}
      </div>

      {/* Run history */}
      <div>
        <h2 className="text-lg font-medium text-content mb-3">Run History</h2>
        {runs && runs.length > 0 ? (
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run.runId}
                className={`p-4 rounded-lg border ${
                  run.metadata.status ? STATUS_COLORS[run.metadata.status] : 'bg-surface-raised border-divider'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {run.metadata.status && STATUS_ICONS[run.metadata.status]}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-content">{run.metadata.issueId}</span>
                        <span className={run.metadata.status ? STATUS_COLORS[run.metadata.status].split(' ')[2] : 'text-content-subtle'}>
                          {run.metadata.status || 'incomplete'}
                        </span>
                      </div>
                      <div className="text-sm text-content-subtle">
                        {formatDate(run.metadata.startedAt)}
                        {run.metadata.duration && ` • ${formatDuration(run.metadata.duration)}`}
                      </div>
                      {run.metadata.notes && (
                        <div className="text-sm text-content-body mt-1">{run.metadata.notes}</div>
                      )}
                    </div>
                  </div>

                  <Link
                    to={`/specialists/${project}/${type}/runs/${run.runId}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-blue-400 hover:text-blue-300 hover:bg-surface-overlay rounded"
                  >
                    <Eye className="w-4 h-4" />
                    View Log
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-content-muted">
            No runs yet for this specialist
          </div>
        )}
      </div>
    </div>
  );
}
