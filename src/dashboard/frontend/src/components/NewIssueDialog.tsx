import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

export type NewIssueTargetStatus = 'backlog' | 'todo';

export type CreatedIssue = {
  id: string;
  ref?: string;
  identifier?: string;
  title: string;
  description?: string;
  state?: string;
  labels?: string[];
  url?: string;
  tracker?: string;
  createdAt?: string;
  updatedAt?: string;
};

type RegisteredProject = {
  key: string;
  name: string;
  path?: string;
  linearTeam: string | null;
  githubRepo: string | null;
  linearProject: string | null;
};

interface NewIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProjectKey: string;
  targetStatus: NewIssueTargetStatus;
  onCreated: (issue: CreatedIssue) => void;
}

function isCreateSupportedProject(project: RegisteredProject): boolean {
  return Boolean(project.githubRepo || project.linearTeam || project.linearProject);
}

async function fetchRegisteredProjects(): Promise<RegisteredProject[]> {
  const res = await fetch('/api/registered-projects');
  if (!res.ok) return [];
  return res.json();
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') return body.error;
  } catch {
  }
  return response.statusText || 'Failed to create issue';
}

export function NewIssueDialog({ isOpen, onClose, defaultProjectKey, targetStatus, onCreated }: NewIssueDialogProps) {
  const queryClient = useQueryClient();
  const [selectedProjectKey, setSelectedProjectKey] = useState(defaultProjectKey);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: registeredProjects = [] } = useQuery<RegisteredProject[]>({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    enabled: isOpen,
    staleTime: 60000,
  });

  const availableProjects = useMemo(() => {
    const supported = registeredProjects.filter(isCreateSupportedProject);
    if (supported.length > 0) return supported;
    if (!defaultProjectKey) return [];
    return [{
      key: defaultProjectKey,
      name: defaultProjectKey,
      linearTeam: null,
      githubRepo: null,
      linearProject: null,
    }];
  }, [defaultProjectKey, registeredProjects]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedProjectKey((current) => {
      const keys = new Set(availableProjects.map((project) => project.key));
      if (keys.has(defaultProjectKey)) return defaultProjectKey;
      if (keys.has(current)) return current;
      return availableProjects[0]?.key ?? defaultProjectKey;
    });
  }, [availableProjects, defaultProjectKey, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setDescription('');
    setError(null);
    setIsSubmitting(false);
  }, [isOpen, targetStatus, defaultProjectKey]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canSubmit = title.trim().length > 0 && selectedProjectKey.length > 0 && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey: selectedProjectKey,
          targetStatus,
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });

      if (!response.ok) {
        setError(await responseErrorMessage(response));
        return;
      }

      const issue = await response.json() as CreatedIssue;
      onCreated(issue);
      await refreshDashboardState(queryClient);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create issue');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={handleSubmit} className="relative w-full max-w-lg bg-card rounded-xl shadow-2xl border border-border overflow-hidden mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Plus className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">New issue</h2>
              <p className="text-sm text-muted-foreground">Create in {targetStatus === 'backlog' ? 'Backlog' : 'Todo'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-popover rounded-lg transition-colors"
            aria-label="Close new issue dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {availableProjects.length > 1 && (
            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1">Project</span>
              <select
                value={selectedProjectKey}
                onChange={(event) => setSelectedProjectKey(event.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {availableProjects.map((project) => (
                  <option key={project.key} value={project.key}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Issue title"
              autoFocus
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full min-h-28 px-3 py-2 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Optional description"
            />
          </label>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-card/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-popover text-foreground hover:bg-card transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isSubmitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
