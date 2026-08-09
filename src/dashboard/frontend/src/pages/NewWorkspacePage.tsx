import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { getNewWorkspaceProjectFromSearch } from '../App/routes.js';
import { FolderPicker } from '../components/CommandDeck/FolderPicker.js';
import { NewProjectModal } from '../components/CommandDeck/NewProjectModal.js';
import { useWorkspaceCreateIntent } from '../components/workspace/new/useWorkspaceCreateIntent.js';
import { fetchWithTimeout } from '../lib/apiFetch.js';

interface ProjectTargets {
  primaryPath: string;
  targets: Array<{ path: string }>;
}

interface NewWorkspacePageProps {
  onCreated?: (workspaceId: string) => void;
}

export function NewWorkspacePage({ onCreated }: NewWorkspacePageProps) {
  const [projectPreset] = useState(() => getNewWorkspaceProjectFromSearch() ?? '');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [projectTargets, setProjectTargets] = useState<ProjectTargets | null>(null);
  const [mainWorkspaceMissing, setMainWorkspaceMissing] = useState(false);
  const intent = useWorkspaceCreateIntent({ initialProjectKey: projectPreset, onCreated });

  useEffect(() => {
    intent.setTargetPath('');
    setProjectTargets(null);
    setTargetMenuOpen(false);
    setBrowsing(false);
    if (!intent.projectKey) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchWithTimeout(
          `/api/workspace-registry/project-targets?project=${encodeURIComponent(intent.projectKey)}`,
          { credentials: 'include' },
        );
        if (cancelled || !response.ok) return;
        const targets = (await response.json()) as ProjectTargets;
        if (cancelled) return;
        setProjectTargets(targets);
        intent.setTargetPath(targets.primaryPath);
      } catch {
        // Browse remains available when the registered target request fails.
      }
    })();

    return () => { cancelled = true; };
  }, [intent.projectKey, intent.setTargetPath]);

  useEffect(() => {
    setMainWorkspaceMissing(false);
    if (!intent.projectKey) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchWithTimeout(
          `/api/workspace-registry?project=${encodeURIComponent(intent.projectKey)}&kind=main&includeArchived=true`,
          { credentials: 'include' },
        );
        if (cancelled || !response.ok) return;
        const data = (await response.json()) as { workspaces?: unknown[] };
        if (!cancelled) setMainWorkspaceMissing((data.workspaces ?? []).length === 0);
      } catch {
        // Hiding the action is safer than offering a bootstrap we could not verify.
      }
    })();

    return () => { cancelled = true; };
  }, [intent.projectKey]);

  const targetOptions = useMemo(() => {
    if (!projectTargets) return [];
    const seen = new Set<string>();
    return [projectTargets.primaryPath, ...projectTargets.targets.map((target) => target.path)].filter((path) => {
      if (!path || seen.has(path)) return false;
      seen.add(path);
      return true;
    });
  }, [projectTargets]);

  const targetLabel = intent.mode === 'isolated'
    ? intent.intent?.path ?? 'Resolved isolated path'
    : intent.targetPath || intent.intent?.path || 'Choose target directory';
  const findings = (['name', 'project', 'targetPath', 'parentBranch'] as const)
    .flatMap((field) => intent.findingsFor(field));

  return (
    <div data-testid="new-workspace-page" className="h-full w-full overflow-y-auto bg-background">
      <form
        className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-12 lg:px-12 lg:py-16"
        onSubmit={(event) => {
          event.preventDefault();
          if (intent.canCreate) void intent.submitIntent();
        }}
      >
        <div
          data-testid="new-workspace-project-chip-row"
          data-region="project-chip-row"
          data-selected-project={intent.projectKey}
          className="mb-8 min-h-9"
        />

        <input
          data-testid="new-workspace-hero-title"
          data-region="hero-title"
          aria-label="Workspace name"
          className="display-xl mb-7 w-full border-0 bg-transparent p-0 text-foreground caret-primary outline-none placeholder:text-muted-foreground/40"
          value={intent.name}
          onChange={(event) => intent.setName(event.target.value)}
          placeholder="Untitled workspace"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />

        <div data-testid="new-workspace-target-row" data-region="target-row" className="relative mb-10 flex min-h-9 flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="new-workspace-target-chip"
            disabled={intent.mode === 'isolated'}
            aria-expanded={targetMenuOpen}
            onClick={() => setTargetMenuOpen((open) => !open)}
            className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 font-mono text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{targetLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>

          <div className="inline-flex h-9 overflow-hidden rounded-lg border border-input" aria-label="Workspace mode">
            {(['shared', 'isolated'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`new-workspace-mode-${mode}`}
                aria-pressed={intent.mode === mode}
                onClick={() => intent.setMode(mode)}
                className={`px-3 text-sm transition-colors ${intent.mode === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {mode === 'shared' ? 'Shared directory' : 'Isolated worktree'}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="new-workspace-advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((open) => !open)}
            className="eyebrow inline-flex items-center gap-1 bg-transparent px-1 py-2 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            Advanced
          </button>

          {targetMenuOpen && intent.mode === 'shared' && (
            <div data-testid="new-workspace-target-menu" className="absolute left-0 top-11 z-20 min-w-72 rounded-lg border border-border bg-popover p-1 shadow-lg">
              {targetOptions.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => {
                    intent.setTargetPath(path);
                    setTargetMenuOpen(false);
                    setBrowsing(false);
                  }}
                  className="block w-full rounded-md px-3 py-2 text-left font-mono text-xs text-popover-foreground hover:bg-accent"
                >
                  {path}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setBrowsing(true);
                  setTargetMenuOpen(false);
                }}
                className="block w-full rounded-md px-3 py-2 text-left font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Browse…
              </button>
            </div>
          )}

          {showAdvanced && (
            <input
              data-testid="new-workspace-parent-branch-input"
              aria-label="Parent branch"
              value={intent.parentBranch}
              onChange={(event) => intent.setParentBranch(event.target.value)}
              placeholder={intent.intent?.parentBranch ?? 'parent branch'}
              className="h-9 min-w-56 rounded-lg border border-input bg-transparent px-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          )}

          {browsing && intent.mode === 'shared' && (
            <div className="w-full rounded-lg border border-border bg-card p-3">
              <FolderPicker
                initialPath={intent.targetPath || undefined}
                onSelect={(path) => {
                  intent.setTargetPath(path);
                  setBrowsing(false);
                }}
              />
            </div>
          )}
        </div>

        {mainWorkspaceMissing && intent.projectKey && (
          <div data-testid="new-workspace-bootstrap-main" className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
            <span className="text-sm text-muted-foreground">This project has no main workspace registered yet.</span>
            <button
              type="button"
              data-testid="new-workspace-bootstrap-main-button"
              disabled={intent.creating}
              onClick={() => {
                void intent.submitIntent({ project: intent.projectKey, bootstrapMain: true }).then((workspaceId) => {
                  if (workspaceId) setMainWorkspaceMissing(false);
                });
              }}
              className="shrink-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              Register main workspace
            </button>
          </div>
        )}

        <div data-testid="new-workspace-hairline-top" data-region="hairline-top" className="mb-5 border-t border-border" />
        <div data-testid="new-workspace-status-strip" data-region="status-strip" className="mb-5 flex min-h-12 flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center font-mono text-xs text-muted-foreground">
            <span className="mr-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
            <span>Memory enabled</span>
            {(findings.length > 0 || intent.error) ? (
              <>
                <span className="mx-2 opacity-50">·</span>
                <span data-testid="new-workspace-status-finding" className="text-destructive-foreground">
                  {findings.map((finding) => finding.message).join(' · ') || intent.error}
                </span>
              </>
            ) : (
              <>
                <span className="mx-2 opacity-50">·</span>
                <span>{intent.mode === 'isolated' ? 'Isolated worktree' : 'Files shared'}</span>
                <span className="mx-2 opacity-50">·</span>
                <span>{intent.intent?.isGitRepository ? 'git repository' : 'no git detected'}</span>
                {intent.parentBranch && (
                  <>
                    <span className="mx-2 opacity-50">·</span>
                    <span>parent {intent.parentBranch}</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="new-workspace-cancel"
              onClick={() => window.history.back()}
              className="eyebrow bg-transparent px-2 py-2 text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="new-workspace-submit"
              disabled={!intent.canCreate}
              className="inline-flex h-12 items-center gap-3 rounded-xl bg-primary/15 px-5 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start workspace
              <span className="inline-grid h-6 min-w-6 place-items-center rounded-md bg-foreground/10 px-1.5 font-mono text-xs">↵</span>
            </button>
          </div>
        </div>
        <div data-testid="new-workspace-hairline-bottom" data-region="hairline-bottom" className="mb-8 border-t border-border" />
        <div data-testid="new-workspace-idea-grid" data-region="idea-grid" className="min-h-48 flex-1" />
      </form>

      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(project) => {
          intent.setProjectKey(project.key);
          setNewProjectOpen(false);
        }}
      />
    </div>
  );
}
