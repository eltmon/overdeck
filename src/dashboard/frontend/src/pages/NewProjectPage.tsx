/**
 * `/projects/new` — add a project by cloning, opening a folder, or starting one
 * (PAN-3836 WI-4).
 *
 * The shape follows from three findings in the UX review of the first version:
 *
 *   - It opened straight into Clone with every field for every mode on screen.
 *     Now, with no `?mode=` preset, it asks which of three things you are doing
 *     and then shows only that mode's fields (D-14).
 *   - Defaults were placeholders in empty inputs, so the destination was a guess
 *     until you submitted. They are real server-resolved values now, and the
 *     exact target path is on screen before you commit to it (D-4).
 *   - Progress, errors and the Create button could all be true at once. The
 *     submission state is a single discriminated value, so the action area shows
 *     exactly one truth (§6.2).
 *
 * The chosen-mode form lives in `ProjectCreateForm` (PAN-4281 D24), which the
 * Add-project dialog shares.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getNewProjectModeFromSearch } from '../App/routes.js';
import { useProjectCreateIntent } from '../components/project/new/useProjectCreateIntent.js';
import { ProjectCreateForm, buttonClass } from '../components/project/new/ProjectCreateForm.js';
import type { ProjectCreateMode } from '../components/project/new/projectCreateTypes.js';

interface NewProjectPageProps {
  onCancel: () => void;
  onCreated: (project: { key: string; name: string; path: string }) => void;
}

const MODE_ACTIONS: ReadonlyArray<{
  mode: ProjectCreateMode;
  label: string;
  description: string;
}> = [
  {
    mode: 'existing',
    label: 'Open existing folder',
    description: 'Use a folder already on this server',
  },
  { mode: 'clone', label: 'Clone repository', description: 'Download a Git repository' },
  { mode: 'new', label: 'Create new project', description: 'Start an empty Git repository' },
];

export function NewProjectPage({ onCancel, onCreated }: NewProjectPageProps) {
  // Hand-rolled routing: the dashboard mounts no <Router>, so the preset comes
  // from window.location the way the workspace page reads it (D-14).
  const modePreset = getNewProjectModeFromSearch();
  const [chosen, setChosen] = useState<ProjectCreateMode | null>(modePreset ?? null);

  const create = useProjectCreateIntent({
    initialMode: modePreset ?? 'existing',
    onCreated,
  });
  const { setMode } = create;

  const firstActionRef = useRef<HTMLButtonElement | null>(null);

  // The form focuses its own first field; the entry view focuses its first action.
  useEffect(() => {
    if (!chosen) firstActionRef.current?.focus();
  }, [chosen]);

  const chooseMode = useCallback(
    (next: ProjectCreateMode) => {
      setChosen(next);
      setMode(next);
    },
    [setMode],
  );

  // ─── Entry view ────────────────────────────────────────────────────────────
  if (!chosen) {
    return (
      <div className="h-full w-full overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-[42rem] px-6 py-12">
          <h1 className="text-xl font-semibold text-foreground">Add a project</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A project is a repository or folder. To make another checkout of a project you already
            use,{' '}
            <a className="underline" href="/workspaces/new">
              create a workspace
            </a>
            .
          </p>

          <div className="mt-8 space-y-3">
            {MODE_ACTIONS.map((action, index) => (
              <button
                key={action.mode}
                type="button"
                ref={index === 0 ? firstActionRef : undefined}
                onClick={() => chooseMode(action.mode)}
                className="block w-full rounded border border-border px-4 py-3 text-left hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <span className="block text-sm font-medium text-foreground">{action.label}</span>
                <span className="block text-sm text-muted-foreground">{action.description}</span>
              </button>
            ))}
          </div>

          <button type="button" onClick={onCancel} className={`mt-8 ${buttonClass}`}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ─── Mode form ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <ProjectCreateForm create={create} onChange={() => setChosen(null)} onCancel={onCancel} />
    </div>
  );
}
