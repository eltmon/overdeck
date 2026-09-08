import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ContextEditableLayerRecord, ContextLayerDraft, ContextLayerTarget, ContextPreviewDiagnostic } from '@overdeck/contracts';
import './ContextPage.css';
import { ContextEditor } from './ContextEditor';
import {
  useContextLayersQuery,
  useContextPreviewMutation,
  useContextSaveMutation,
  useContextSyncMutation,
} from '../../lib/contextApi';

type SelectedLayerKind = ContextLayerTarget['kind'];
type PreviewTab = 'claude-code' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'fullPrompt';
const scopeDescription = { global: 'Every project on this machine', project: 'One project, including its workspaces', workspace: 'One issue workspace' };
const previewOptions: [PreviewTab, string][] = [['claude-code', 'Claude Code'], ['codex', 'Codex'], ['ohmypi', 'oh-my-pi'], ['kimi-code', 'Kimi Code'], ['acp', 'ACP'], ['fullPrompt', 'All harnesses']];

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
      return '~/.overdeck/context/global.md';
    case 'project':
      return layer.file.includes('/.pan/') ? '.pan/context/project.md' : '.overdeck/context/project.md';
    case 'workspace':
      return layer.file.includes('/.pan/') ? '.pan/context/workspace.md' : '.overdeck/context/workspace.md';
  }
}

function layerTitle(kind: SelectedLayerKind): string {
  switch (kind) {
    case 'global':
      return 'Machine context';
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
  const [view, setView] = useState<'edit' | 'preview'>('edit');
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
    setPreviewResponse(null);
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
      toast.success(syncAfterSave ? 'Context saved and outputs refreshed. Applies to new sessions.' : 'Context saved. Applies to new sessions.');
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
    <div className="context-page h-full w-full min-w-0 overflow-auto bg-background text-foreground">
      <header className="border-b border-border px-5 py-4">
        <h1 className="text-xl font-semibold">Agent context</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose where instructions apply, edit their source, and preview what Overdeck adds to a new session.</p>
        <p className="mt-2 text-xs text-muted-foreground">Running conversations keep their existing context. Your CLAUDE.md and AGENTS.md files stay under your control.</p>
      </header>
      <div className="context-layout">
        <aside className="context-sources border-border bg-card/30 p-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Where should this apply?</legend>
            {(['global', 'project', 'workspace'] as const).map((kind) => (
              <label key={kind} className={`flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-muted ${selectedKind === kind ? 'bg-accent text-accent-foreground' : ''}`}>
                <input className="mt-1" type="radio" name="context-layer-kind" value={kind} aria-label={layerTitle(kind)} checked={selectedKind === kind} onChange={() => setSelectedKind(kind)} />
                <span><span className="block font-medium">{layerTitle(kind)}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{scopeDescription[kind]}</span></span>
              </label>
            ))}
          </fieldset>
          {selectedKind !== 'global' && (
            <label className="mt-4 block text-sm">
              <span className="font-medium">Project</span>
              <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2" value={selectedProjectKey} onChange={e => setSelectedProjectKey(e.target.value)} disabled={!data?.projects.length}>
                {data?.projects.length ? data.projects.map(project => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>) : <option value="">No registered projects</option>}
              </select>
            </label>
          )}
          {selectedKind === 'workspace' && (
            <label className="mt-4 block text-sm">
              <span className="font-medium">Workspace</span>
              <select className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2" value={selectedWorkspacePath} onChange={e => setSelectedWorkspacePath(e.target.value)} disabled={!selectedProjectWorkspaces.length}>
                {selectedProjectWorkspaces.length ? selectedProjectWorkspaces.map(workspace => <option key={workspace.path} value={workspace.path}>{workspace.issueId ?? workspace.name}</option>) : <option value="">No workspaces for this project</option>}
              </select>
            </label>
          )}
          <div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">{selectedKind === 'global' ? 'Keep machine context specific' : selectedKind === 'project' ? 'Shared project guidance' : 'Generated workspace context'}</p>
            <p className="mt-1">{selectedKind === 'global' ? 'Use this for local paths or machine quirks. Rules for every machine belong in bundled rules.' : selectedKind === 'project' ? 'Use this for project conventions and requirements. Commit the source file to share it with your team.' : 'Overdeck assembles this from issue metadata, memory, and status. It may not exist until a workspace is created.'}</p>
          </div>
          <details className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Other instruction sources</summary>
            <p className="mt-2">The preview combines your selected scope with applicable machine context and bundled rules. Project and workspace sources join it when selected.</p>
            <p className="mt-2">Bundled rules live in <code className="break-all">sync-sources/rules/</code>. Each rule in the preview names its source.</p>
            <p className="mt-2">Role instructions and the session briefing can add launch context. The harness also loads its own user, project, and organization instructions, memory, and skills. These are not editable here.</p>
          </details>
          <details className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Generated output files</summary>
            <p className="mt-2">Overdeck passes context at launch. Refresh updates its saved global outputs; it does not rewrite native instruction files or update running conversations.</p>
            <ul className="mt-3 space-y-3">
              {data?.targets.map(target => <li key={target.path}><p className="font-medium text-foreground">{target.label}</p><code className="block break-all">{target.path}</code><p>{target.deliveryChannel === 'codex-developer-instructions' ? 'Added as developer instructions.' : 'Appended to the session’s system prompt.'}</p><p>{target.exists ? `${target.byteCount.toLocaleString()} bytes` : 'Created on next refresh.'}</p></li>)}
            </ul>
            <button type="button" className="mt-3 rounded-md border border-border px-3 py-2 text-foreground disabled:opacity-50" disabled={actionPending || isDirty} onClick={() => { setActionError(null); void syncMutation.mutateAsync({ operation: 'sync' }).then(() => refetch()).then(() => toast.success('Outputs refreshed. Applies to new sessions.')).catch(failure => setActionError(errorMessage(failure))); }}>Refresh outputs</button>
            {isDirty && <p className="mt-1">Save your changes before refreshing outputs.</p>}
          </details>
        </aside>
        <section className="context-workbench flex min-w-0 flex-col">
          <header className="border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{layerTitle(selectedKind)}</h2>
              {selectedLayer && <span className="text-xs text-muted-foreground">{isDirty ? 'Edited' : 'Loaded'}</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{selectedKind === 'global' ? scopeDescription.global : selectedKind === 'project' ? selectedProject?.name ?? 'No project selected' : selectedWorkspace?.issueId ?? selectedWorkspace?.name ?? 'No workspace selected'}</p>
            {selectedLayer && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer break-all font-mono">{layerPathLabel(selectedLayer)}</summary><p className="mt-2 break-all font-mono">{selectedLayer.file}</p><p className="mt-1">{selectedLayer.exists ? 'File exists' : 'File has not been created yet'}</p></details>}
            <div className="mt-4 flex gap-2" role="group" aria-label="Context view">
              {(['edit', 'preview'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={`rounded-md px-3 py-2 text-sm font-medium ${view === mode ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{mode === 'edit' ? 'Edit source' : 'Preview for agent'}</button>)}
            </div>
          </header>
          <div className="context-editor flex-1" hidden={view !== 'edit'}>
            {selectedLayer ? <ContextEditor value={editorValue} disabled={actionPending} onChange={value => setDrafts(current => ({ ...current, [selectedKey]: value }))} /> : <div className="p-6 text-sm text-muted-foreground">{selectedKind === 'workspace' ? 'Create a workspace for this project to edit its context.' : 'Register a project in Projects to add project context.'}</div>}
          </div>
          <div className="min-w-0 flex-1" hidden={view !== 'preview'}>
            <div className="border-b border-border px-5 py-4">
              <label className="flex flex-wrap items-center gap-3 text-sm"><span className="font-medium">Preview for</span><select className="rounded-md border border-border bg-background px-3 py-2" aria-label="Preview for" value={previewTab} onChange={e => setPreviewTab(e.target.value as PreviewTab)}>{previewOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{isDirty ? 'Includes your unsaved edits. ' : ''}This previews Overdeck’s context layers. It is not a transcript or a complete view of the harness’s system prompt.</p>
            </div>
            <div className="p-5" aria-live="polite">
              {previewError ? <p role="alert" className="text-sm text-destructive">Could not render preview: {previewError}. Edit the source to try again.</p> : previewText ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{previewText}</pre> : <p className="text-sm text-muted-foreground">{selectedLayer ? 'Rendering preview…' : 'Select an available source to preview its context.'}</p>}
            </div>
          </div>
          <div className="border-t border-border px-5 py-3 text-xs" aria-live="polite">
            {diagnostics.length > 0 ? <ul className="space-y-2">{diagnostics.map((diagnostic, index) => <li key={`${diagnostic.message}-${index}`} className={diagnostic.level === 'error' ? 'text-destructive' : 'text-warning-foreground'}>{diagnosticsLabel(diagnostic)}</li>)}</ul> : <p className="text-muted-foreground">{previewResponse ? 'No validation issues.' : selectedLayer ? 'Validation updates with the preview.' : 'No source selected.'}</p>}
          </div>
          <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-5 py-3">
            <div className="text-xs text-muted-foreground">{actionError ? <span role="alert" className="text-destructive">{actionError}</span> : isDirty ? 'Unsaved changes' : 'No unsaved changes'}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50" disabled={!isDirty || actionPending || !selectedLayer} onClick={() => void saveSelectedLayer(false)}>{saveMutation.isPending && !syncMutation.isPending ? 'Saving…' : 'Save'}</button>
              <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={!isDirty || actionPending || !selectedLayer} onClick={() => void saveSelectedLayer(true)}>{syncMutation.isPending ? 'Refreshing…' : 'Save & refresh outputs'}</button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
