import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookOpen, Download, Loader2 } from 'lucide-react';
import { fetchProjects } from '../CommandDeck/projectsData';

export interface KnowledgeViewerStatus {
  projectKey: string;
  bundleConfigured: boolean;
  installed: boolean;
  starting: boolean;
  running: boolean;
  bundlePath?: string;
  url?: string;
  message?: string;
}

interface KnowledgePageProps {
  projectKey?: string | null;
}

const KNOWLEDGE_VIEWER_EDITABLE = false;

export function knowledgeViewerPostureCopy(editable = KNOWLEDGE_VIEWER_EDITABLE): string {
  return editable
    ? 'Browse, search, and edit this project knowledge bundle.'
    : 'View and search here; edit knowledge through /okf author so changes stay PR-gated.';
}

async function fetchViewerStatus(projectKey: string): Promise<KnowledgeViewerStatus> {
  const response = await fetch(`/api/knowledge-viewer/status?project=${encodeURIComponent(projectKey)}`);
  const body = await response.json() as KnowledgeViewerStatus & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Knowledge viewer status could not be loaded');
  return body;
}

async function mutateViewer(action: 'install' | 'start', projectKey: string): Promise<KnowledgeViewerStatus> {
  const response = await fetch(`/api/knowledge-viewer/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: projectKey }),
  });
  const body = await response.json() as KnowledgeViewerStatus & { error?: string };
  if (!response.ok) throw new Error(body.error || `Knowledge viewer ${action} failed`);
  return body;
}

export function KnowledgePage({ projectKey }: KnowledgePageProps) {
  const queryClient = useQueryClient();
  const requestedStart = useRef<string | null>(null);
  const projectsQuery = useQuery({
    queryKey: ['command-deck-projects'],
    queryFn: fetchProjects,
    enabled: !projectKey,
    staleTime: 30_000,
  });
  const activeProjectKey = useMemo(
    () => projectKey ?? projectsQuery.data?.[0]?.key ?? null,
    [projectKey, projectsQuery.data],
  );
  const statusQuery = useQuery({
    queryKey: ['knowledge-viewer-status', activeProjectKey],
    queryFn: () => fetchViewerStatus(activeProjectKey!),
    enabled: Boolean(activeProjectKey),
    refetchInterval: 2_000,
  });
  const installMutation = useMutation({
    mutationFn: () => mutateViewer('install', activeProjectKey!),
    onSuccess: async () => {
      requestedStart.current = null;
      await queryClient.invalidateQueries({ queryKey: ['knowledge-viewer-status', activeProjectKey] });
    },
  });
  const startMutation = useMutation({
    mutationFn: () => mutateViewer('start', activeProjectKey!),
    onSuccess: (status) => {
      queryClient.setQueryData(['knowledge-viewer-status', activeProjectKey], status);
    },
  });

  const status = statusQuery.data;
  useEffect(() => {
    if (!activeProjectKey || !status?.bundleConfigured || !status.installed || status.running || status.starting) return;
    if (requestedStart.current === activeProjectKey || startMutation.isPending) return;
    requestedStart.current = activeProjectKey;
    startMutation.mutate();
  }, [activeProjectKey, startMutation, status]);

  const loading = projectsQuery.isLoading || (Boolean(activeProjectKey) && statusQuery.isLoading);
  const error = projectsQuery.error ?? statusQuery.error ?? installMutation.error ?? startMutation.error;
  const starting = status?.starting || startMutation.isPending;

  return (
    <main className="h-full overflow-y-auto bg-background p-6" data-testid="knowledge-page">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header>
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-xl font-medium text-foreground">Knowledge</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{knowledgeViewerPostureCopy()}</p>
        </header>

        {loading && <ProgressState title="Loading knowledge configuration" />}

        {!loading && !activeProjectKey && (
          <EmptyState
            title="No project is available"
            description="Register a project before opening its knowledge bundle."
          />
        )}

        {!loading && error && (
          <section className="rounded-lg bg-card p-6" role="alert">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-medium text-foreground">Knowledge viewer unavailable</h2>
                <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
              </div>
            </div>
          </section>
        )}

        {!loading && !error && status && !status.bundleConfigured && (
          <EmptyState
            title="No knowledge bundle configured"
            description="Create or connect the project knowledge bundle, then return here."
            command="/okf init"
          />
        )}

        {!loading && !error && status?.bundleConfigured && !status.installed && (
          <section className="rounded-lg bg-card p-6">
            <h2 className="text-sm font-medium text-foreground">Install the local knowledge viewer</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              OpenKnowledge is installed only after this explicit request. It runs as a separate local program.
            </p>
            <button
              type="button"
              onClick={() => installMutation.mutate()}
              disabled={installMutation.isPending}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {installMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Download className="h-4 w-4" aria-hidden="true" />}
              {installMutation.isPending ? 'Installing viewer' : 'Install viewer'}
            </button>
          </section>
        )}

        {!loading && !error && status?.bundleConfigured && status.installed && starting && (
          <ProgressState title="Starting knowledge viewer" />
        )}

        {!loading && !error && status?.running && (
          <section className="rounded-lg bg-card p-6" data-testid="knowledge-viewer-ready">
            <h2 className="text-sm font-medium text-foreground">Viewer ready</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The local viewer is running. The embedded knowledge workspace loads here.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function ProgressState({ title }: { title: string }) {
  return (
    <section className="rounded-lg bg-card p-6" role="status">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-info" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">This usually takes a few seconds.</p>
        </div>
      </div>
    </section>
  );
}

function EmptyState({ title, description, command }: { title: string; description: string; command?: string }) {
  return (
    <section className="rounded-lg bg-card p-6">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {command && (
        <code className="mt-4 inline-block rounded-sm bg-muted px-2 py-1 font-mono text-xs text-foreground">
          {command}
        </code>
      )}
    </section>
  );
}
