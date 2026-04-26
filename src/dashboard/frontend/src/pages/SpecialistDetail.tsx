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
  passed: <CheckCircle className="w-4 h-4 text-success" />,
  failed: <XCircle className="w-4 h-4 text-destructive" />,
  blocked: <AlertCircle className="w-4 h-4 text-warning" />,
  incomplete: <Clock className="w-4 h-4 text-muted-foreground" />,
};

const STATUS_COLORS = {
  passed: 'badge-bg-success text-success border-success/40',
  failed: 'badge-bg-destructive text-destructive border-destructive/40',
  blocked: 'badge-bg-warning text-warning border-warning/40',
  incomplete: 'bg-card bg-opacity-20 text-muted-foreground border-border',
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
    return <div className="text-destructive">Invalid parameters</div>;
  }

  if (runsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
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
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Specialists
        </Link>

        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8 text-signal-review" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {project} / {type}
            </h1>
            <div className="text-muted-foreground">{runs?.length || 0} total runs</div>
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
        <div className="p-4 badge-bg-success border border-success/40 rounded-lg">
          <div className="text-success text-2xl font-bold">{stats.passed}</div>
          <div className="text-success/80 text-sm">Passed</div>
        </div>
        <div className="p-4 badge-bg-destructive border border-destructive/40 rounded-lg">
          <div className="text-destructive text-2xl font-bold">{stats.failed}</div>
          <div className="text-destructive/80 text-sm">Failed</div>
        </div>
        <div className="p-4 badge-bg-warning border border-warning/40 rounded-lg">
          <div className="text-warning text-2xl font-bold">{stats.blocked}</div>
          <div className="text-warning/80 text-sm">Blocked</div>
        </div>
      </div>

      {/* Context digest */}
      <div className="mb-6 p-4 bg-card rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium text-foreground">Context Digest</h2>
          <button
            onClick={() => regenerateMutation.mutate()}
            disabled={regenerateMutation.isPending}
            className="flex items-center gap-2 px-3 py-1 text-sm text-primary hover:text-primary/80 hover:bg-popover rounded disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        </div>
        {contextDigest ? (
          <pre className="text-sm text-foreground whitespace-pre-wrap max-h-64 overflow-auto">
            {contextDigest}
          </pre>
        ) : (
          <div className="text-muted-foreground">No context digest available yet</div>
        )}
      </div>

      {/* Run history */}
      <div>
        <h2 className="text-lg font-medium text-foreground mb-3">Run History</h2>
        {runs && runs.length > 0 ? (
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run.runId}
                className={`p-4 rounded-lg border ${
                  run.metadata.status ? STATUS_COLORS[run.metadata.status] : 'bg-card border-border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {run.metadata.status && STATUS_ICONS[run.metadata.status]}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-foreground">{run.metadata.issueId}</span>
                        <span className={run.metadata.status ? STATUS_COLORS[run.metadata.status].split(' ')[2] : 'text-muted-foreground'}>
                          {run.metadata.status || 'incomplete'}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(run.metadata.startedAt)}
                        {run.metadata.duration && ` • ${formatDuration(run.metadata.duration)}`}
                      </div>
                      {run.metadata.notes && (
                        <div className="text-sm text-foreground mt-1">{run.metadata.notes}</div>
                      )}
                    </div>
                  </div>

                  <Link
                    to={`/specialists/${project}/${type}/runs/${run.runId}`}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-primary hover:text-primary/80 hover:bg-popover rounded"
                  >
                    <Eye className="w-4 h-4" />
                    View Log
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No runs yet for this specialist
          </div>
        )}
      </div>
    </div>
  );
}
