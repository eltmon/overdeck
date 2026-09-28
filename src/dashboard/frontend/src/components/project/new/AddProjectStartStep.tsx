/**
 * The first step of the Add-project dialog: how do you want to add it
 * (PAN-4281 FR-5). "Open a folder" is the primary action and takes focus;
 * ArrowUp/ArrowDown move between the action rows and Enter activates one.
 * Below them it lists repositories already in the default projects folder
 * that are not projects yet; each **Add** registers one through the create
 * core, and those rows join the arrow-key order.
 *
 * Copy here also shows on Simple Home, so it stays clear of the simple-mode
 * banned words (`lib/simple/strings.ts`). The project-versus-workspace
 * guidance is shown only on the full `/projects/new` page for that reason.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithTimeout } from '../../../lib/apiFetch.js';
import { buttonClass } from './ProjectCreateForm.js';
import { resolveThenCreateProject } from './resolveThenCreate.js';
import { PROJECT_SUGGESTIONS_QUERY_KEY, tildePath, useProjectSuggestions } from './useProjectSuggestions.js';
import type { AddProjectMode } from './addProjectDialogStore.js';
import type { CreatedProject } from './projectCreateTypes.js';

interface AddProjectStartStepProps {
  titleId?: string;
  /** Show the "create a workspace" guidance (page variant only). */
  showGuide: boolean;
  onChoose: (mode: AddProjectMode) => void;
  /** A suggestion was added straight from this step. */
  onCreated: (project: CreatedProject) => void;
  onCancel: () => void;
}

type SuggestionState = { kind: 'adding' } | { kind: 'failed'; message: string };

const PRIMARY = {
  mode: 'existing' as const,
  label: 'Open a folder',
  description: 'A project folder, a Git repository, or a folder with many repositories',
};

const OTHER_ACTIONS: ReadonlyArray<{ mode: AddProjectMode; label: string; description: string }> = [
  { mode: 'clone', label: 'Clone from URL', description: 'Download a Git repository' },
  { mode: 'new', label: 'Create new project', description: 'Start an empty Git repository' },
];

const rowClass =
  'block w-full rounded border border-border px-4 py-3 text-left hover:bg-surface-hover ' +
  'focus:outline-none focus:ring-2 focus:ring-accent';

export function AddProjectStartStep({ titleId, showGuide, onChoose, onCreated, onCancel }: AddProjectStartStepProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();
  const suggestions = useProjectSuggestions();
  const [suggestionStates, setSuggestionStates] = useState<Record<string, SuggestionState>>({});

  const addSuggestion = async (path: string) => {
    setSuggestionStates((states) => ({ ...states, [path]: { kind: 'adding' } }));
    const result = await resolveThenCreateProject({ mode: 'existing', path });
    if (result.ok) {
      void queryClient.invalidateQueries({ queryKey: PROJECT_SUGGESTIONS_QUERY_KEY });
      onCreated(result.project);
    } else {
      setSuggestionStates((states) => ({ ...states, [path]: { kind: 'failed', message: result.message } }));
    }
  };

  const registeredProjects = useQuery({
    queryKey: ['registered-projects'],
    queryFn: async (): Promise<unknown[]> => {
      const response = await fetchWithTimeout('/api/registered-projects', { credentials: 'include' });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
  });
  const noProjects = registeredProjects.isSuccess && registeredProjects.data.length === 0;

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  // Arrow keys move focus between the rows, clamped at both ends.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-add-project-row]') ?? []);
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? Math.min(current + 1, rows.length - 1) : Math.max(current - 1, 0);
    rows[next]?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-[42rem] px-6 py-12">
      <h1 id={titleId} className="text-xl font-semibold text-foreground">
        Add a project
      </h1>
      {noProjects && (
        <p className="mt-2 text-sm text-muted-foreground">
          Add a project to start working in it. You can also skip this and just type on Home.
        </p>
      )}
      {showGuide && (
        <p className="mt-2 text-sm text-muted-foreground">
          A project is a repository or folder. To make another checkout of a project you already
          use,{' '}
          <a className="underline" href="/workspaces/new">
            create a workspace
          </a>
          .
        </p>
      )}

      <div ref={listRef} className="mt-8" onKeyDown={handleKeyDown}>
        <button
          ref={primaryRef}
          type="button"
          data-add-project-row
          onClick={() => onChoose(PRIMARY.mode)}
          className={rowClass}
        >
          <span className="flex items-baseline justify-between gap-4">
            <span className="block text-sm font-medium text-foreground">{PRIMARY.label}</span>
            <kbd aria-hidden="true" className="font-mono text-xs text-muted-foreground">
              ⏎
            </kbd>
          </span>
          <span className="block text-sm text-muted-foreground">{PRIMARY.description}</span>
        </button>

        <h2 className="mt-6 mb-2 text-sm font-medium text-muted-foreground">Other ways to add</h2>
        <div className="space-y-3">
          {OTHER_ACTIONS.map((action) => (
            <button
              key={action.mode}
              type="button"
              data-add-project-row
              onClick={() => onChoose(action.mode)}
              className={rowClass}
            >
              <span className="block text-sm font-medium text-foreground">{action.label}</span>
              <span className="block text-sm text-muted-foreground">{action.description}</span>
            </button>
          ))}
        </div>

        {suggestions.repositories.length > 0 && (
          <>
            <h2 className="mt-6 mb-2 text-sm font-medium text-muted-foreground">
              Repositories in {tildePath(suggestions.root ?? '', suggestions.homeDir)}
            </h2>
            <ul className="divide-y divide-border rounded border border-border">
              {suggestions.repositories.map((repo) => {
                const state = suggestionStates[repo.path];
                return (
                  <li key={repo.path} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{repo.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {tildePath(repo.path, suggestions.homeDir)}
                      </span>
                      {state?.kind === 'failed' && (
                        <span role="alert" className="block text-sm text-danger">
                          {state.message}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      data-add-project-row
                      aria-label={`Add ${repo.name}`}
                      disabled={state?.kind === 'adding'}
                      onClick={() => void addSuggestion(repo.path)}
                      className={buttonClass}
                    >
                      {state?.kind === 'adding' ? 'Adding…' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <button type="button" onClick={onCancel} className={`mt-8 ${buttonClass}`}>
        Cancel
      </button>
    </div>
  );
}
