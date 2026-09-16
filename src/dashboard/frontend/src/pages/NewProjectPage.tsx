import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProjectCreateIntent, type ProjectCreateMode } from '../components/project/new/useProjectCreateIntent.js';

interface NewProjectPageProps {
  onCancel: () => void;
  onCreated: (project: { key: string; name: string; path: string }) => void;
}

export function NewProjectPage({ onCancel, onCreated }: NewProjectPageProps) {
  const [searchParams] = useSearchParams();

  const modePreset: ProjectCreateMode = (() => {
    const m = searchParams.get('mode');
    if (m === 'clone' || m === 'existing' || m === 'new') return m;
    return 'clone';
  })();

  void modePreset;

  const {
    mode,
    setMode,
    url,
    setUrl,
    path,
    setPath,
    parentDir,
    setParentDir,
    name,
    setName,
    issuePrefix,
    setIssuePrefix,
    intent,
    stale,
    creating,
    error,
    progress,
    canCreate,
    findingsFor,
    submit,
  } = useProjectCreateIntent({
    onCreated: (project) => {
      onCreated(project);
    },
  });

  const handleSubmit = useCallback(async () => {
    await submit();
  }, [submit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCreate) {
      void handleSubmit();
    }
  }, [canCreate, handleSubmit]);

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <form
        className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-12 lg:px-12 lg:py-16"
        onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) void handleSubmit();
        }}
      >
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Create a Project</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A project is a repository with its own issues and pipeline. Want another checkout of a project
            you already have? <a href="/workspaces/new" className="underline hover:text-foreground">Create a workspace</a> instead.
          </p>
        </div>

        <div className="mb-8 inline-flex rounded-lg border border-input overflow-hidden">
          <button
            type="button"
            className={`px-4 py-2 text-sm transition-colors ${mode === 'clone' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('clone')}
          >
            Clone repository
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm transition-colors ${mode === 'existing' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('existing')}
          >
            Add existing
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm transition-colors ${mode === 'new' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setMode('new')}
          >
            New project
          </button>
        </div>

        <div onKeyDown={handleKeyDown} className="flex-1 mb-8">
        {mode === 'clone' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Clone URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo or owner/repo"
                disabled={creating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('url').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Parent directory</label>
              <input
                type="text"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder="~/Projects"
                disabled={creating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('parentDir').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={intent?.name || 'Project name'}
                disabled={creating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('name').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Issue prefix</label>
              <input
                type="text"
                value={issuePrefix}
                onChange={(e) => setIssuePrefix(e.target.value)}
                placeholder={intent?.proposedIssuePrefix || 'e.g., PAN'}
                disabled={creating}
                maxLength={10}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('issuePrefix').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'existing' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Directory</label>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Choose a directory"
                disabled={creating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('path').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={intent?.name || 'Project name'}
                disabled={creating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('name').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Issue prefix</label>
              <input
                type="text"
                value={issuePrefix}
                onChange={(e) => setIssuePrefix(e.target.value)}
                placeholder={intent?.proposedIssuePrefix || 'e.g., PAN'}
                disabled={creating}
                maxLength={10}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('issuePrefix').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'new' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                disabled={creating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('name').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Parent directory</label>
              <input
                type="text"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder="~/Projects"
                disabled={creating}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('parentDir').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Issue prefix</label>
              <input
                type="text"
                value={issuePrefix}
                onChange={(e) => setIssuePrefix(e.target.value)}
                placeholder={intent?.proposedIssuePrefix || 'e.g., PAN'}
                disabled={creating}
                maxLength={10}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground outline-none focus:border-ring disabled:opacity-50"
              />
              {findingsFor('issuePrefix').map((f) => (
                <div key={f.code} className="mt-1 text-xs text-destructive">
                  {f.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {intent && (
          <div className="mt-8 rounded-lg border border-border bg-card p-3 font-mono text-xs text-muted-foreground">
            {intent.key && <span>{intent.key}</span>}
            {intent.path && <span> · </span>}
            {intent.path && <span>{intent.path}</span>}
            {intent.provider && <span> · </span>}
            {intent.provider && <span>{intent.provider}.com/{intent.repoSlug}</span>}
            {!intent.provider && intent.cloneUrl && <span> · </span>}
            {!intent.provider && intent.cloneUrl && <span>no remote</span>}
            {intent.defaultBranch && <span> · </span>}
            {intent.defaultBranch && <span>default {intent.defaultBranch}</span>}
            {!intent.defaultBranch && mode === 'clone' && <span> · </span>}
            {!intent.defaultBranch && mode === 'clone' && <span>branch unknown</span>}
            {intent.wouldClone && <span> · </span>}
            {intent.wouldClone && <span>will clone</span>}
            {intent.wouldGitInit && <span> · </span>}
            {intent.wouldGitInit && <span>will git init</span>}
            {intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span> · </span>}
            {intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span>git repository</span>}
            {!intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span> · </span>}
            {!intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span>not a git repository</span>}
            {intent.willCreateMainWorkspace && <span> · </span>}
            {intent.willCreateMainWorkspace && <span>main workspace will be created</span>}
            {!intent.willCreateMainWorkspace && intent.key && <span> · </span>}
            {!intent.willCreateMainWorkspace && intent.key && <span>main workspace exists</span>}
          </div>
        )}

        {stale && mode === 'clone' && <div className="mt-4 text-sm text-muted-foreground">checking remote…</div>}

        {error && <div className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {progress && (
          <div className="mt-4 text-sm text-muted-foreground">
            {progress.phase} {progress.percent !== null ? `${progress.percent}%` : '...'}
          </div>
        )}
        </div>

        <div className="flex gap-3 justify-end border-t border-border pt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canCreate || creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
