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

export function NewWorkspacePage() {
  const [projectPreset] = useState(() => getNewWorkspaceProjectFromSearch() ?? '');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [projectTargets, setProjectTargets] = useState<ProjectTargets | null>(null);
  const intent = useWorkspaceCreateIntent({ initialProjectKey: projectPreset });

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

  return (
    <div data-testid="new-workspace-page" className="h-full w-full overflow-y-auto bg-background">
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-12 lg:px-12 lg:py-16">
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
        <div data-testid="new-workspace-hairline-top" data-region="hairline-top" className="mb-5 border-t border-border" />
        <div data-testid="new-workspace-status-strip" data-region="status-strip" className="mb-5 min-h-12" />
        <div data-testid="new-workspace-hairline-bottom" data-region="hairline-bottom" className="mb-8 border-t border-border" />
        <div data-testid="new-workspace-idea-grid" data-region="idea-grid" className="min-h-48 flex-1" />
      </main>

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
