/**
 * A folder that holds repositories (PAN-4281 WI-10, FR-9, D18, D20): add each
 * checked repository as its own project, or add the folder as one multi-repo
 * project spanning them.
 *
 * Both go through `resolveThenCreateProject`, the one create core. The batch
 * runs one repository at a time; a failing row keeps its message and the rest
 * continue. When every row succeeds the dialog reports the last project once
 * and closes; otherwise it stays open with per-row results and a Done button.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buttonClass } from './ProjectCreateForm.js';
import { resolveThenCreateProject } from './resolveThenCreate.js';
import { PROJECT_SUGGESTIONS_QUERY_KEY, tildePath } from './useProjectSuggestions.js';
import type { CreatedProject, NestedRepository } from './projectCreateTypes.js';

interface AddProjectNestedStepProps {
  titleId?: string;
  folder: string;
  homeDir: string | undefined;
  repositories: NestedRepository[];
  onCreated: (project: CreatedProject) => void;
  /** Back to choosing a folder. */
  onBack: () => void;
  onCancel: () => void;
  /** True while adds are running, so the dialog keeps itself open. */
  onRunningChange?: (running: boolean) => void;
}

type RowState = { kind: 'adding' } | { kind: 'added' } | { kind: 'failed'; message: string };

export function AddProjectNestedStep({
  titleId,
  folder,
  homeDir,
  repositories,
  onCreated,
  onBack,
  onCancel,
  onRunningChange,
}: AddProjectNestedStepProps) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(repositories.map((repo) => repo.path)));
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  /** Set after a batch with a failure: the last project that did get added. */
  const [finished, setFinished] = useState<{ lastAdded: CreatedProject | null } | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  useEffect(() => {
    onRunningChange?.(running);
    return () => onRunningChange?.(false);
  }, [running, onRunningChange]);

  const selected = repositories.filter((repo) => checked.has(repo.path));
  const count = selected.length;
  const disabled = count === 0 || running || finished !== null;

  const toggle = (path: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const addEach = async () => {
    setRunning(true);
    let lastAdded: CreatedProject | null = null;
    let failed = false;
    for (const repo of selected) {
      setRows((current) => ({ ...current, [repo.path]: { kind: 'adding' } }));
      const result = await resolveThenCreateProject({ mode: 'existing', path: repo.path });
      if (result.ok) {
        lastAdded = result.project;
        setRows((current) => ({ ...current, [repo.path]: { kind: 'added' } }));
      } else {
        failed = true;
        setRows((current) => ({ ...current, [repo.path]: { kind: 'failed', message: result.message } }));
      }
    }
    setRunning(false);
    void queryClient.invalidateQueries({ queryKey: PROJECT_SUGGESTIONS_QUERY_KEY });
    if (!failed && lastAdded) onCreated(lastAdded);
    else setFinished({ lastAdded });
  };

  const addAsOne = async () => {
    setRunning(true);
    setFolderError(null);
    const result = await resolveThenCreateProject({
      mode: 'existing',
      path: folder,
      repos: selected.map((repo) => repo.name),
    });
    setRunning(false);
    if (result.ok) {
      void queryClient.invalidateQueries({ queryKey: PROJECT_SUGGESTIONS_QUERY_KEY });
      onCreated(result.project);
    } else {
      setFolderError(result.message);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[42rem] px-6 py-12">
      <h1 id={titleId} className="text-xl font-semibold text-foreground">
        Add a project
      </h1>
      <p className="mt-2 text-sm text-foreground">
        Found {repositories.length} {repositories.length === 1 ? 'repository' : 'repositories'} in{' '}
        <span className="font-mono">{tildePath(folder, homeDir)}</span>
      </p>

      <ul className="mt-6 divide-y divide-border rounded border border-border">
        {repositories.map((repo) => {
          const row = rows[repo.path];
          return (
            <li key={repo.path} className="flex items-center gap-3 px-4 py-2">
              <input
                type="checkbox"
                id={`nested-${repo.path}`}
                checked={checked.has(repo.path)}
                disabled={running || finished !== null}
                onChange={() => toggle(repo.path)}
              />
              <label htmlFor={`nested-${repo.path}`} className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{repo.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {tildePath(repo.path, homeDir)}
                </span>
              </label>
              {row && (
                <span
                  data-testid="nested-row-status"
                  className={`text-sm ${row.kind === 'failed' ? 'text-danger' : 'text-muted-foreground'}`}
                >
                  {row.kind === 'adding' ? 'Adding…' : row.kind === 'added' ? 'Added' : row.message}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-8 flex flex-wrap items-start gap-3">
        <button type="button" disabled={disabled} onClick={() => void addEach()} className={buttonClass}>
          Add {count} {count === 1 ? 'project' : 'projects'}
        </button>
        <div>
          <button type="button" disabled={disabled} onClick={() => void addAsOne()} className={buttonClass}>
            Add this folder as one project
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            One multi-repo project spanning the checked repositories.
          </p>
        </div>
      </div>
      {folderError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {folderError}
        </p>
      )}

      <div className="mt-8 flex gap-3">
        {finished ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => (finished.lastAdded ? onCreated(finished.lastAdded) : onCancel())}
          >
            Done
          </button>
        ) : (
          <>
            <button type="button" disabled={running} onClick={onBack} className={buttonClass}>
              Back
            </button>
            <button type="button" disabled={running} onClick={onCancel} className={buttonClass}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
