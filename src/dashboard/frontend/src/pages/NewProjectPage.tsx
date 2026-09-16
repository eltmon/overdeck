import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProjectCreateIntent, type ProjectCreateMode } from '../components/project/new/useProjectCreateIntent.js';
import styles from './NewWorkspacePage.module.css';

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
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Create a Project</h1>
        <p className={styles.guide}>
          A project is a repository with its own issues and pipeline. Want another checkout of a project
          you already have? <a href="/workspaces/new">Create a workspace</a> instead.
        </p>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${mode === 'clone' ? styles.active : ''}`}
          onClick={() => setMode('clone')}
        >
          Clone repository
        </button>
        <button
          className={`${styles.tab} ${mode === 'existing' ? styles.active : ''}`}
          onClick={() => setMode('existing')}
        >
          Add existing
        </button>
        <button
          className={`${styles.tab} ${mode === 'new' ? styles.active : ''}`}
          onClick={() => setMode('new')}
        >
          New project
        </button>
      </div>

      <div className={styles.content} onKeyDown={handleKeyDown}>
        {mode === 'clone' && (
          <div className={styles.fields}>
            <div className={styles.field}>
              <label>Clone URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo or owner/repo"
                disabled={creating}
              />
              {findingsFor('url').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label>Parent directory</label>
              <input
                type="text"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder="~/Projects"
                disabled={creating}
              />
              {findingsFor('parentDir').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={intent?.name || 'Project name'}
                disabled={creating}
              />
              {findingsFor('name').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label>Issue prefix</label>
              <input
                type="text"
                value={issuePrefix}
                onChange={(e) => setIssuePrefix(e.target.value)}
                placeholder={intent?.proposedIssuePrefix || 'e.g., PAN'}
                disabled={creating}
                maxLength={10}
              />
              {findingsFor('issuePrefix').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'existing' && (
          <div className={styles.fields}>
            <div className={styles.field}>
              <label>Directory</label>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Choose a directory"
                disabled={creating}
              />
              {findingsFor('path').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={intent?.name || 'Project name'}
                disabled={creating}
              />
              {findingsFor('name').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label>Issue prefix</label>
              <input
                type="text"
                value={issuePrefix}
                onChange={(e) => setIssuePrefix(e.target.value)}
                placeholder={intent?.proposedIssuePrefix || 'e.g., PAN'}
                disabled={creating}
                maxLength={10}
              />
              {findingsFor('issuePrefix').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'new' && (
          <div className={styles.fields}>
            <div className={styles.field}>
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                disabled={creating}
              />
              {findingsFor('name').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label>Parent directory</label>
              <input
                type="text"
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder="~/Projects"
                disabled={creating}
              />
              {findingsFor('parentDir').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>

            <div className={styles.field}>
              <label>Issue prefix</label>
              <input
                type="text"
                value={issuePrefix}
                onChange={(e) => setIssuePrefix(e.target.value)}
                placeholder={intent?.proposedIssuePrefix || 'e.g., PAN'}
                disabled={creating}
                maxLength={10}
              />
              {findingsFor('issuePrefix').map((f) => (
                <div key={f.code} className={styles.finding}>
                  {f.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {intent && (
          <div className={styles.statusStrip}>
            {intent.key && <span>{intent.key}</span>}
            {intent.path && <span>·</span>}
            {intent.path && <span>{intent.path}</span>}
            {intent.provider && <span>·</span>}
            {intent.provider && <span>{intent.provider}.com/{intent.repoSlug}</span>}
            {!intent.provider && intent.cloneUrl && <span>·</span>}
            {!intent.provider && intent.cloneUrl && <span>no remote</span>}
            {intent.defaultBranch && <span>·</span>}
            {intent.defaultBranch && <span>default {intent.defaultBranch}</span>}
            {!intent.defaultBranch && mode === 'clone' && <span>·</span>}
            {!intent.defaultBranch && mode === 'clone' && <span>branch unknown</span>}
            {intent.wouldClone && <span>·</span>}
            {intent.wouldClone && <span>will clone</span>}
            {intent.wouldGitInit && <span>·</span>}
            {intent.wouldGitInit && <span>will git init</span>}
            {intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span>·</span>}
            {intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span>git repository</span>}
            {!intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span>·</span>}
            {!intent.isGitRepository && !intent.wouldClone && !intent.wouldGitInit && <span>not a git repository</span>}
            {intent.willCreateMainWorkspace && <span>·</span>}
            {intent.willCreateMainWorkspace && <span>main workspace will be created</span>}
            {!intent.willCreateMainWorkspace && intent.key && <span>·</span>}
            {!intent.willCreateMainWorkspace && intent.key && <span>main workspace exists</span>}
          </div>
        )}

        {stale && mode === 'clone' && <div className={styles.checking}>checking remote…</div>}

        {error && <div className={styles.error}>{error}</div>}

        {progress && (
          <div className={styles.progress}>
            {progress.phase} {progress.percent !== null ? `${progress.percent}%` : '...'}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button onClick={onCancel} disabled={creating}>
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canCreate || creating}
          className={styles.primary}
        >
          {creating ? 'Creating...' : 'Create project'}
        </button>
      </div>
    </div>
  );
}
