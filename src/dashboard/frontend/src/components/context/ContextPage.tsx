import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ContextEditableLayerRecord, ContextLayerDraft, ContextLayerTarget, ContextPreviewDiagnostic } from '@panctl/contracts';
import { ContextEditor } from './ContextEditor';
import {
  useContextLayersQuery,
  useContextPreviewMutation,
  useContextSaveMutation,
  useContextSyncMutation,
} from '../../lib/contextApi';

type SelectedLayerKind = ContextLayerTarget['kind'];
type PreviewTab = 'claude-code' | 'pi' | 'fullPrompt';

function targetKey(target: ContextLayerTarget): string {
  switch (target.kind) {
    case 'global':
      return 'global';
    case 'project':
      return `project:${target.projectKey}`;
    case 'workspace':
      return `workspace:${target.projectKey}:${target.workspacePath}`;
  }
}

function targetForLayer(layer: ContextEditableLayerRecord): ContextLayerTarget {
  switch (layer.kind) {
    case 'global':
      return { kind: 'global' };
    case 'project':
      return { kind: 'project', projectKey: layer.projectKey };
    case 'workspace':
      return { kind: 'workspace', projectKey: layer.projectKey, workspacePath: layer.workspacePath };
  }
}

function layerPathLabel(layer: ContextEditableLayerRecord): string {
  switch (layer.kind) {
    case 'global':
      return '~/.panopticon/context/global.md';
    case 'project':
      return '.pan/context/project.md';
    case 'workspace':
      return '.pan/context/workspace.md';
  }
}

function layerTitle(kind: SelectedLayerKind): string {
  switch (kind) {
    case 'global':
      return 'Global context';
    case 'project':
      return 'Project context';
    case 'workspace':
      return 'Workspace context';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function ErrorMessage({ error }: { error: unknown }) {
  return (
    <div className="h-full w-full p-6">
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load context layers: {errorMessage(error)}
      </div>
    </div>
  );
}

function diagnosticsLabel(diagnostic: ContextPreviewDiagnostic): string {
  const layer = diagnostic.layer ? targetKey(diagnostic.layer) : 'preview';
  return `${diagnostic.level.toUpperCase()} · ${layer}: ${diagnostic.message}`;
}

export function ContextPage() {
  const { data, isLoading, error, refetch } = useContextLayersQuery();
  const previewMutation = useContextPreviewMutation();
  const saveMutation = useContextSaveMutation();
  const syncMutation = useContextSyncMutation();
  const previewContext = previewMutation.mutateAsync;
  const [selectedKind, setSelectedKind] = useState<SelectedLayerKind>('global');
  const [selectedProjectKey, setSelectedProjectKey] = useState('');
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [previewTab, setPreviewTab] = useState<PreviewTab>('claude-code');
  const [previewResponse, setPreviewResponse] = useState<Awaited<ReturnType<typeof previewMutation.mutateAsync>> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedProjectWorkspaces = useMemo(() => {
    return data?.workspaces.filter((workspace) => workspace.projectKey === selectedProjectKey) ?? [];
  }, [data?.workspaces, selectedProjectKey]);

  useEffect(() => {
    if (!data) return;
    const firstProjectKey = data.projects[0]?.projectKey ?? '';
    setSelectedProjectKey((current) => data.projects.some((project) => project.projectKey === current) ? current : firstProjectKey);
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const validWorkspace = selectedProjectWorkspaces.some((workspace) => workspace.path === selectedWorkspacePath);
    setSelectedWorkspacePath(validWorkspace ? selectedWorkspacePath : selectedProjectWorkspaces[0]?.path ?? '');
  }, [data, selectedProjectWorkspaces, selectedWorkspacePath]);

  const selectedTarget = useMemo<ContextLayerTarget | null>(() => {
    if (selectedKind === 'global') return { kind: 'global' };
    if (!selectedProjectKey) return null;
    if (selectedKind === 'project') return { kind: 'project', projectKey: selectedProjectKey };
    if (!selectedWorkspacePath) return null;
    return { kind: 'workspace', projectKey: selectedProjectKey, workspacePath: selectedWorkspacePath };
  }, [selectedKind, selectedProjectKey, selectedWorkspacePath]);

  const selectedLayer = useMemo(() => {
    if (!data || !selectedTarget) return null;
    const key = targetKey(selectedTarget);
    return data.layers.find((layer) => targetKey(targetForLayer(layer)) === key) ?? null;
  }, [data, selectedTarget]);

  const draftPayload = useMemo<ContextLayerDraft[]>(() => {
    if (!data) return [];
    return data.layers.flatMap((layer) => {
      const target = targetForLayer(layer);
      const content = drafts[targetKey(target)];
      return content === undefined ? [] : [{ target, content }];
    });
  }, [data, drafts]);

  const selectedKey = selectedTarget ? targetKey(selectedTarget) : '';
  const editorValue = selectedLayer ? drafts[selectedKey] ?? selectedLayer.content : '';
  const selectedProject = data?.projects.find((project) => project.projectKey === selectedProjectKey) ?? null;
  const selectedWorkspace = data?.workspaces.find((workspace) => workspace.path === selectedWorkspacePath) ?? null;
  const isDirty = !!selectedLayer && drafts[selectedKey] !== undefined && drafts[selectedKey] !== selectedLayer.content;
  const actionPending = saveMutation.isPending || syncMutation.isPending;

  useEffect(() => {
    if (!selectedTarget || !selectedLayer) {
      setPreviewResponse(null);
      return;
    }

    let cancelled = false;
    setPreviewError(null);
    const timer = window.setTimeout(() => {
      void previewContext({
        operation: 'preview',
        selectedLayer: selectedTarget,
        drafts: draftPayload,
      }).then((response) => {
        if (!cancelled) setPreviewResponse(response);
      }).catch((previewFailure: unknown) => {
        if (!cancelled) setPreviewError(errorMessage(previewFailure));
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draftPayload, previewContext, selectedLayer, selectedTarget]);

  async function saveSelectedLayer(syncAfterSave: boolean) {
    if (!selectedTarget || !selectedLayer) return;
    setActionError(null);
    try {
      await saveMutation.mutateAsync({ operation: 'save', target: selectedTarget, content: editorValue });
      if (syncAfterSave) {
        await syncMutation.mutateAsync({ operation: 'sync' });
      }
      await refetch();
      setDrafts((current) => {
        const { [selectedKey]: _saved, ...remaining } = current;
        return remaining;
      });
      toast.success(syncAfterSave ? 'Context saved and synced' : 'Context saved');
    } catch (failure) {
      const message = errorMessage(failure);
      setActionError(message);
      toast.error(message);
    }
  }

  if (isLoading) {
    return <div className="h-full w-full p-6 text-sm text-muted-foreground">Loading context layers…</div>;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  const previewText = previewResponse?.previews[previewTab] ?? '';
  const diagnostics = previewResponse?.diagnostics ?? [];

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-card/40 p-4">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Context</p>
          <h1 className="mt-1 text-lg font-semibold">Layer editor</h1>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Edit the context markdown Panopticon injects into coding-agent sessions.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layer</legend>
          {(['global', 'project', 'workspace'] as const).map((kind) => (
            <label key={kind} className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-sm">
              <input
                type="radio"
                name="context-layer-kind"
                value={kind}
                checked={selectedKind === kind}
                onChange={() => setSelectedKind(kind)}
              />
              <span>{layerTitle(kind)}</span>
            </label>
          ))}
        </fieldset>

        <div className="mt-5 space-y-4">
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Project</span>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={selectedProjectKey}
              onChange={(event) => setSelectedProjectKey(event.target.value)}
              disabled={!data?.projects.length || selectedKind === 'global'}
            >
              {data?.projects.length ? data.projects.map((project) => (
                <option key={project.projectKey} value={project.projectKey}>{project.name}</option>
              )) : <option value="">No registered projects</option>}
            </select>
          </label>

          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>Workspace</span>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={selectedWorkspacePath}
              onChange={(event) => setSelectedWorkspacePath(event.target.value)}
              disabled={selectedKind !== 'workspace' || selectedProjectWorkspaces.length === 0}
            >
              {selectedProjectWorkspaces.length ? selectedProjectWorkspaces.map((workspace) => (
                <option key={workspace.path} value={workspace.path}>{workspace.issueId ?? workspace.name}</option>
              )) : <option value="">No workspaces for this project</option>}
            </select>
          </label>
        </div>

        <div className="mt-5 rounded-lg border border-border bg-background/70 p-3 text-xs text-muted-foreground">
          {selectedLayer ? (
            <dl className="space-y-2">
              <div>
                <dt className="font-medium text-foreground">Layer file</dt>
                <dd className="mt-1 font-mono">{layerPathLabel(selectedLayer)}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Resolved path</dt>
                <dd className="mt-1 break-all font-mono">{selectedLayer.file}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Status</dt>
                <dd className="mt-1">{selectedLayer.exists ? 'File exists' : 'File has not been created yet'}</dd>
              </div>
            </dl>
          ) : (
            <p>Select a project or workspace to edit its context layer.</p>
          )}
        </div>

        {selectedKind === 'workspace' ? (
          <p className="mt-4 rounded-lg border border-info/30 bg-info/10 p-3 text-xs leading-5 text-info-foreground">
            <span className="font-semibold">Workspace context:</span> .pan/context/workspace.md is auto-assembled for each workspace and may not exist until a workspace is created.
          </p>
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{layerTitle(selectedKind)}</h2>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {selectedKind === 'global'
                    ? 'Applies to every registered project.'
                    : selectedKind === 'project'
                      ? selectedProject?.path ?? 'No project selected'
                      : selectedWorkspace?.path ?? 'No workspace selected'}
                </p>
              </div>
              {selectedLayer ? (
                <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
                  {isDirty ? 'Edited' : 'Loaded'}
                </span>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1">
            {selectedLayer ? (
              <ContextEditor
                value={editorValue}
                disabled={actionPending}
                onChange={(value) => setDrafts((current) => ({ ...current, [selectedKey]: value }))}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                No context layer is available for the current selection.
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="min-w-0 text-xs text-muted-foreground">
              {actionError ? <span className="text-destructive">{actionError}</span> : isDirty ? 'Unsaved changes' : 'No unsaved changes'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!isDirty || actionPending || !selectedLayer}
                onClick={() => void saveSelectedLayer(false)}
              >
                {saveMutation.isPending && !syncMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!isDirty || actionPending || !selectedLayer}
                onClick={() => void saveSelectedLayer(true)}
              >
                {actionPending && syncMutation.isPending ? 'Syncing…' : 'Save & Sync'}
              </button>
            </div>
          </footer>
        </div>

        <aside className="flex w-[28rem] shrink-0 flex-col overflow-hidden border-l border-border bg-card/30">
          <div className="shrink-0 border-b border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Preview</p>
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {([
                ['claude-code', 'Claude Code output'],
                ['pi', 'Pi output'],
                ['fullPrompt', 'Full injected prompt'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  className={`rounded-md px-2 py-1.5 text-xs transition-colors ${previewTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setPreviewTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {previewError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{previewError}</div>
            ) : previewMutation.isPending && !previewText ? (
              <p className="text-sm text-muted-foreground">Rendering preview…</p>
            ) : previewText ? (
              <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-xs leading-5 text-foreground">{previewText}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">Preview updates after the editor changes.</p>
            )}
          </div>

          <div className="max-h-40 shrink-0 overflow-auto border-t border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Validation</p>
            {diagnostics.length > 0 ? (
              <ul className="mt-2 space-y-2 text-xs">
                {diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.message}-${index}`} className={diagnostic.level === 'error' ? 'text-destructive' : 'text-warning-foreground'}>
                    {diagnosticsLabel(diagnostic)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No validation issues.</p>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
