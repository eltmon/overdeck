import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, XCircle, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirm } from './DialogProvider';

interface ProjectSpecialistMetadata {
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: 'passed' | 'failed' | 'blocked' | null;
  currentRun: string | null;
}

interface ProjectSpecialist {
  projectKey: string;
  specialistType: string;
  metadata: ProjectSpecialistMetadata;
  isRunning: boolean;
  tmuxSession: string;
}

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

async function fetchProjectSpecialists(): Promise<ProjectSpecialist[]> {
  const res = await fetch('/api/specialists/projects');
  if (!res.ok) throw new Error('Failed to fetch project specialists');
  return res.json();
}

async function fetchRunLogs(project: string, type: string, limit: number = 10): Promise<RunLogEntry[]> {
  const res = await fetch(`/api/specialists/${project}/${type}/runs?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch run logs');
  return res.json();
}

async function terminateSpecialist(project: string, type: string, runId: string): Promise<void> {
  const res = await fetch(`/api/specialists/${project}/${type}/runs/${runId}/terminate`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to terminate specialist');
}

const STATUS_ICONS = {
  passed: <CheckCircle className="w-4 h-4 text-success" />,
  failed: <XCircle className="w-4 h-4 text-destructive" />,
  blocked: <AlertCircle className="w-4 h-4 text-warning" />,
  incomplete: <Clock className="w-4 h-4 text-muted-foreground" />,
};

const STATUS_COLORS = {
  passed: 'text-success',
  failed: 'text-destructive',
  blocked: 'text-warning',
  incomplete: 'text-muted-foreground',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return 'Just now';
}

interface ProjectSpecialistCardProps {
  specialist: ProjectSpecialist;
}

function ProjectSpecialistCard({ specialist }: ProjectSpecialistCardProps) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data: runs } = useQuery({
    queryKey: ['specialist-runs', specialist.projectKey, specialist.specialistType],
    queryFn: () => fetchRunLogs(specialist.projectKey, specialist.specialistType, 5),
    enabled: expanded,
  });

  const terminateMutation = useMutation({
    mutationFn: () =>
      terminateSpecialist(
        specialist.projectKey,
        specialist.specialistType,
        specialist.metadata.currentRun!
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-specialists'] });
      queryClient.invalidateQueries({
        queryKey: ['specialist-runs', specialist.projectKey, specialist.specialistType],
      });
    },
  });

  const handleTerminate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: 'Terminate Specialist', message: `Terminate ${specialist.specialistType} for ${specialist.projectKey}?`, variant: 'destructive', confirmLabel: 'Terminate' })) {
      terminateMutation.mutate();
    }
  };

  return (
    <div className="p-4 bg-card rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-signal-review" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                {specialist.projectKey}/{specialist.specialistType}
              </span>
              {specialist.isRunning && (
                <Loader2 className="w-4 h-4 text-success animate-spin" />
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {specialist.metadata.runCount} runs
              {specialist.metadata.lastRunAt && (
                <span className="ml-2">
                  • Last: {formatDate(specialist.metadata.lastRunAt)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {specialist.metadata.lastRunStatus && (
            <div className="flex items-center gap-1">
              {STATUS_ICONS[specialist.metadata.lastRunStatus]}
              <span className={`text-sm ${STATUS_COLORS[specialist.metadata.lastRunStatus]}`}>
                {specialist.metadata.lastRunStatus}
              </span>
            </div>
          )}

          {specialist.isRunning && specialist.metadata.currentRun && (
            <button
              onClick={handleTerminate}
              disabled={terminateMutation.isPending}
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-popover rounded"
              title="Terminate"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 text-muted-foreground hover:text-primary hover:bg-popover rounded"
          >
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2">
          <div className="text-sm text-muted-foreground font-medium mb-2">Recent Runs</div>
          {runs && runs.length > 0 ? (
            <div className="space-y-1">
              {runs.map((run) => (
                <Link
                  key={run.runId}
                  to={`/specialists/${specialist.projectKey}/${specialist.specialistType}/runs/${run.runId}`}
                  className="flex items-center justify-between p-2 bg-card hover:bg-popover rounded text-xs transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {run.metadata.status && STATUS_ICONS[run.metadata.status]}
                    <span className="text-foreground font-mono">{run.metadata.issueId}</span>
                    <span className="text-muted-foreground">{formatDate(run.metadata.startedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {run.metadata.duration && (
                      <span className="text-muted-foreground">{formatDuration(run.metadata.duration)}</span>
                    )}
                    {run.metadata.status && (
                      <span className={STATUS_COLORS[run.metadata.status]}>
                        {run.metadata.status}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-2">No runs yet</div>
          )}

          <Link
            to={`/specialists/${specialist.projectKey}/${specialist.specialistType}`}
            className="block text-sm text-primary hover:text-primary/80 mt-2"
          >
            View all runs →
          </Link>
        </div>
      )}
    </div>
  );
}

export function ProjectSpecialistPanel() {
  const [selectedProject, setSelectedProject] = useState<string | 'all'>('all');

  const { data: specialists, isLoading } = useQuery({
    queryKey: ['project-specialists'],
    queryFn: fetchProjectSpecialists,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!specialists || specialists.length === 0) {
    return (
      <div className="text-center py-8">
        <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <div className="text-muted-foreground">No per-project specialists configured yet</div>
        <div className="text-sm text-muted-foreground mt-1">
          Specialists will appear here when they run for the first time
        </div>
      </div>
    );
  }

  const projects = Array.from(new Set(specialists.map((s) => s.projectKey)));
  const filteredSpecialists =
    selectedProject === 'all'
      ? specialists
      : specialists.filter((s) => s.projectKey === selectedProject);

  return (
    <div className="space-y-4">
      {/* Project selector */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Project:</label>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="px-3 py-1 bg-popover text-foreground rounded border border-border focus:border-primary focus:outline-none"
        >
          <option value="all">All Projects</option>
          {projects.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
        <div className="text-sm text-muted-foreground ml-auto">
          {filteredSpecialists.length} specialist{filteredSpecialists.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Specialists list */}
      <div className="space-y-3">
        {filteredSpecialists.map((specialist) => (
          <ProjectSpecialistCard
            key={`${specialist.projectKey}-${specialist.specialistType}`}
            specialist={specialist}
          />
        ))}
      </div>
    </div>
  );
}
