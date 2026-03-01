import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, XCircle, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

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
  passed: <CheckCircle className="w-4 h-4 text-green-400" />,
  failed: <XCircle className="w-4 h-4 text-red-400" />,
  blocked: <AlertCircle className="w-4 h-4 text-yellow-400" />,
  incomplete: <Clock className="w-4 h-4 text-content-subtle" />,
};

const STATUS_COLORS = {
  passed: 'text-green-400',
  failed: 'text-red-400',
  blocked: 'text-yellow-400',
  incomplete: 'text-content-subtle',
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
  const { confirm: confirmDialog } = useConfirmDialog();

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
    const ok = await confirmDialog({
      title: `Terminate ${specialist.specialistType}?`,
      description: `This will terminate ${specialist.specialistType} for ${specialist.projectKey}.`,
      confirmLabel: 'Terminate',
      variant: 'destructive',
    });
    if (ok) terminateMutation.mutate();
  };

  return (
    <div className="p-4 bg-surface-raised rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-purple-400" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-content">
                {specialist.projectKey}/{specialist.specialistType}
              </span>
              {specialist.isRunning && (
                <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
              )}
            </div>
            <div className="text-sm text-content-subtle">
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
              className="p-2 text-content-subtle hover:text-red-400 hover:bg-surface-overlay rounded"
              title="Terminate"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 text-content-subtle hover:text-blue-400 hover:bg-surface-overlay rounded"
          >
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2">
          <div className="text-sm text-content-subtle font-medium mb-2">Recent Runs</div>
          {runs && runs.length > 0 ? (
            <div className="space-y-1">
              {runs.map((run) => (
                <Link
                  key={run.runId}
                  to={`/specialists/${specialist.projectKey}/${specialist.specialistType}/runs/${run.runId}`}
                  className="flex items-center justify-between p-2 bg-gray-750 hover:bg-surface-overlay rounded text-xs transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {run.metadata.status && STATUS_ICONS[run.metadata.status]}
                    <span className="text-content font-mono">{run.metadata.issueId}</span>
                    <span className="text-content-muted">{formatDate(run.metadata.startedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {run.metadata.duration && (
                      <span className="text-content-subtle">{formatDuration(run.metadata.duration)}</span>
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
            <div className="text-sm text-content-muted py-2">No runs yet</div>
          )}

          <Link
            to={`/specialists/${specialist.projectKey}/${specialist.specialistType}`}
            className="block text-sm text-blue-400 hover:text-blue-300 mt-2"
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
        <Loader2 className="w-6 h-6 text-content-subtle animate-spin" />
      </div>
    );
  }

  if (!specialists || specialists.length === 0) {
    return (
      <div className="text-center py-8">
        <Brain className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <div className="text-content-subtle">No per-project specialists configured yet</div>
        <div className="text-sm text-content-muted mt-1">
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
        <label className="text-sm text-content-subtle">Project:</label>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="px-3 py-1 bg-surface-overlay text-content rounded border border-divider-strong focus:border-blue-500 focus:outline-none"
        >
          <option value="all">All Projects</option>
          {projects.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
        <div className="text-sm text-content-muted ml-auto">
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
