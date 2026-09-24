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
 * Uncommon settings live under Options rather than as required decisions, and
 * Options opens itself when a finding lands inside it.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getNewProjectModeFromSearch } from '../App/routes.js';
import { FolderPicker } from '../components/CommandDeck/FolderPicker.js';
import { useProjectCreateIntent } from '../components/project/new/useProjectCreateIntent.js';
import type {
  ProjectCreateMode,
  ProjectIntentField,
  ProjectIntentFinding,
} from '../components/project/new/projectCreateTypes.js';

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

const CTA_LABEL: Record<ProjectCreateMode, string> = {
  clone: 'Clone repository',
  existing: 'Add project',
  new: 'Create project',
};

/** Fields that live behind the Options disclosure. */
const OPTION_FIELDS: ReadonlyArray<ProjectIntentField> = ['name', 'issuePrefix', 'parentDir'];

const inputClass =
  'w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-accent';
const labelClass = 'mb-1 block text-sm font-medium text-foreground';
const buttonClass =
  'rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-hover ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

function Findings({ findings, id }: { findings: ProjectIntentFinding[]; id: string }) {
  if (findings.length === 0) return null;
  return (
    <div id={id} role="alert" className="mt-1 space-y-1">
      {findings.map((finding) => (
        <p key={finding.code} className="text-sm text-danger">
          {finding.message}
          {finding.detail ? <span className="ml-1 font-mono text-xs opacity-80">{finding.detail}</span> : null}
        </p>
      ))}
    </div>
  );
}

export function NewProjectPage({ onCancel, onCreated }: NewProjectPageProps) {
  // Hand-rolled routing: the dashboard mounts no <Router>, so the preset comes
  // from window.location the way the workspace page reads it (D-14).
  const modePreset = getNewProjectModeFromSearch();
  const [chosen, setChosen] = useState<ProjectCreateMode | null>(modePreset ?? null);

  const ids = useId();
  const urlId = `${ids}-url`;
  const pathId = `${ids}-path`;
  const parentId = `${ids}-parent`;
  const nameId = `${ids}-name`;
  const prefixId = `${ids}-prefix`;
  const optionsId = `${ids}-options`;
  const statusId = `${ids}-status`;

  const create = useProjectCreateIntent({
    initialMode: modePreset ?? 'existing',
    onCreated,
  });
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
    hasOverrides,
    resetOverrides,
    intent,
    checking,
    resolveError,
    submission,
    frozen,
    canCreate,
    findingsFor,
    submit,
    cancel,
    checkAgain,
    finishSetup,
    dismissFailure,
  } = create;

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [picker, setPicker] = useState<null | 'path' | 'parentDir'>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const browseReturnRef = useRef<HTMLButtonElement | null>(null);

  const optionFindings = useMemo(
    () => OPTION_FIELDS.flatMap((field) => findingsFor(field)),
    [findingsFor],
  );

  // A finding the operator cannot see is a dead end, so Options opens itself.
  useEffect(() => {
    if (optionFindings.length > 0) setOptionsOpen(true);
  }, [optionFindings.length]);

  // Focus the field that starts each mode — but never steal focus when a
  // resolve merely returns.
  useEffect(() => {
    if (chosen) firstFieldRef.current?.focus();
    else firstActionRef.current?.focus();
  }, [chosen]);

  useEffect(() => {
    if (submission.kind === 'failed' || submission.kind === 'needs-setup') {
      errorRef.current?.focus();
    }
  }, [submission.kind]);

  const chooseMode = useCallback(
    (next: ProjectCreateMode) => {
      setChosen(next);
      setMode(next);
    },
    [setMode],
  );

  const handleSubmit = useCallback(() => {
    if (canCreate) void submit();
  }, [canCreate, submit]);

  // Ctrl/Cmd+Enter submits once. `isComposing` keeps an IME commit from
  // counting as a submit.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const openPicker = useCallback((field: 'path' | 'parentDir', trigger: HTMLButtonElement | null) => {
    browseReturnRef.current = trigger;
    setPicker(field);
  }, []);

  const closePicker = useCallback(() => {
    setPicker(null);
    // Focus goes back where it came from, not to the top of the page.
    browseReturnRef.current?.focus();
  }, []);

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
  const targetPath = intent?.path ?? null;
  const destinationLine =
    mode === 'existing'
      ? targetPath && `Will add ${targetPath}`
      : targetPath && `Will ${mode === 'clone' ? 'clone' : 'create'} to ${targetPath}`;

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <form
        className="mx-auto w-full max-w-[42rem] px-6 py-12"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold text-foreground">Add a project</h1>
          <button
            type="button"
            disabled={frozen}
            onClick={() => setChosen(null)}
            className="text-sm text-muted-foreground underline disabled:opacity-50"
          >
            Change
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          A project is a repository or folder. To make another checkout of a project you already
          use,{' '}
          <a className="underline" href="/workspaces/new">
            create a workspace
          </a>
          .
        </p>

        <fieldset disabled={frozen} className="mt-8 space-y-5 border-0 p-0">
          {mode === 'clone' && (
            <div>
              <label className={labelClass} htmlFor={urlId}>
                Repository URL
              </label>
              <input
                id={urlId}
                ref={firstFieldRef}
                className={inputClass}
                value={url}
                placeholder="https://github.com/owner/repo or owner/repo"
                aria-invalid={findingsFor('url').length > 0}
                aria-describedby={findingsFor('url').length ? `${urlId}-error` : undefined}
                onChange={(event) => setUrl(event.target.value)}
              />
              <Findings findings={findingsFor('url')} id={`${urlId}-error`} />
            </div>
          )}

          {mode === 'existing' && (
            <div>
              <label className={labelClass} htmlFor={pathId}>
                Folder
              </label>
              <div className="flex gap-2">
                <input
                  id={pathId}
                  ref={firstFieldRef}
                  className={`${inputClass} font-mono`}
                  value={path}
                  placeholder="/home/you/Projects/my-repo"
                  aria-invalid={findingsFor('path').length > 0}
                  aria-describedby={findingsFor('path').length ? `${pathId}-error` : undefined}
                  onChange={(event) => setPath(event.target.value)}
                />
                <button
                  type="button"
                  className={buttonClass}
                  onClick={(event) => openPicker('path', event.currentTarget)}
                >
                  Browse server folders
                </button>
              </div>
              <Findings findings={findingsFor('path')} id={`${pathId}-error`} />
              {intent && !findingsFor('path').length && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {intent.isGitRepository
                    ? 'This folder is a Git repository.'
                    : 'This folder is not a Git repository. It can still be a project.'}
                </p>
              )}
            </div>
          )}

          {mode === 'new' && (
            <div>
              <label className={labelClass} htmlFor={nameId}>
                Project name
              </label>
              <input
                id={nameId}
                ref={firstFieldRef}
                data-testid="new-project-name-input"
                className={inputClass}
                value={name}
                placeholder="my-project"
                aria-invalid={findingsFor('name').length > 0}
                aria-describedby={findingsFor('name').length ? `${nameId}-error` : undefined}
                onChange={(event) => setName(event.target.value)}
              />
              <Findings findings={findingsFor('name')} id={`${nameId}-error`} />
              {intent && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Git repository in <span className="font-mono">{intent.parentDir}</span>
                </p>
              )}
            </div>
          )}

          {mode === 'clone' && (
            <div>
              <label className={labelClass} htmlFor={parentId}>
                Parent folder
              </label>
              <div className="flex gap-2">
                <input
                  id={parentId}
                  className={`${inputClass} font-mono`}
                  value={parentDir}
                  aria-invalid={findingsFor('parentDir').length > 0}
                  onChange={(event) => setParentDir(event.target.value)}
                />
                <button
                  type="button"
                  className={buttonClass}
                  onClick={(event) => openPicker('parentDir', event.currentTarget)}
                >
                  Browse
                </button>
              </div>
              <Findings findings={findingsFor('parentDir')} id={`${parentId}-error`} />
            </div>
          )}

          {destinationLine && (
            <p className="text-sm text-foreground">
              {destinationLine.split(/(\/.*)/)[0]}
              <span className="font-mono">{targetPath}</span>
            </p>
          )}

          {/* Options: a disclosure, not a step. */}
          <div>
            <button
              type="button"
              aria-expanded={optionsOpen}
              aria-controls={optionsId}
              onClick={() => setOptionsOpen((open) => !open)}
              className="text-sm text-muted-foreground underline"
            >
              Options
            </button>
            <div id={optionsId} hidden={!optionsOpen} className="mt-3 space-y-4">
              {mode !== 'new' && (
                <div>
                  <label className={labelClass} htmlFor={nameId}>
                    Project name
                  </label>
                  <input
                    id={nameId}
                    data-testid="new-project-name-input"
                    className={inputClass}
                    value={name}
                    aria-invalid={findingsFor('name').length > 0}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Findings findings={findingsFor('name')} id={`${nameId}-error`} />
                </div>
              )}
              {mode === 'new' && (
                <div>
                  <label className={labelClass} htmlFor={parentId}>
                    Parent folder
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={parentId}
                      className={`${inputClass} font-mono`}
                      value={parentDir}
                      onChange={(event) => setParentDir(event.target.value)}
                    />
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={(event) => openPicker('parentDir', event.currentTarget)}
                    >
                      Browse
                    </button>
                  </div>
                  <Findings findings={findingsFor('parentDir')} id={`${parentId}-error`} />
                </div>
              )}
              <div>
                <label className={labelClass} htmlFor={prefixId}>
                  Issue prefix
                </label>
                <input
                  id={prefixId}
                  className={inputClass}
                  value={issuePrefix}
                  aria-invalid={findingsFor('issuePrefix').length > 0}
                  onChange={(event) => setIssuePrefix(event.target.value)}
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  Used in issue IDs, for example APP-123.
                </p>
                <Findings findings={findingsFor('issuePrefix')} id={`${prefixId}-error`} />
              </div>
              {hasOverrides && (
                <button type="button" className={buttonClass} onClick={resetOverrides}>
                  Reset to detected values
                </button>
              )}
            </div>
          </div>
        </fieldset>

        {picker && (
          <div className="mt-4 rounded border border-border p-3">
            <FolderPicker
              initialPath={picker === 'path' ? path || undefined : parentDir || undefined}
              onSelect={(selected) => {
                if (picker === 'path') setPath(selected);
                else setParentDir(selected);
                closePicker();
              }}
            />
            <button type="button" className={`mt-2 ${buttonClass}`} onClick={closePicker}>
              Close
            </button>
          </div>
        )}

        {/* Status lives below a stable action area so it never moves the buttons. */}
        <div className="mt-8 flex items-center gap-3">
          <button type="submit" disabled={!canCreate} className={buttonClass}>
            {CTA_LABEL[mode]}
          </button>
          {submission.kind === 'running' && (
            <button type="button" className={buttonClass} onClick={() => void cancel()}>
              Cancel clone
            </button>
          )}
          {submission.kind === 'connection-lost' && submission.exhausted && (
            <button type="button" className={buttonClass} onClick={checkAgain}>
              Check again
            </button>
          )}
          {submission.kind === 'needs-setup' && (
            <button type="button" className={buttonClass} onClick={() => void finishSetup()}>
              Finish setup
            </button>
          )}
          {(submission.kind === 'failed' || submission.kind === 'cancelled') && (
            <button type="button" className={buttonClass} onClick={dismissFailure}>
              Back to the form
            </button>
          )}
          {submission.kind === 'editing' && (
            <button type="button" className={buttonClass} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>

        <div id={statusId} aria-live="polite" className="mt-4 min-h-[1.5rem] text-sm">
          {checking && submission.kind === 'editing' && (
            <span className="text-muted-foreground">Checking…</span>
          )}
          {resolveError && <span className="text-danger">{resolveError}</span>}

          {submission.kind === 'submitting' && (
            <span className="text-muted-foreground">Preparing clone…</span>
          )}

          {submission.kind === 'running' && (
            <div>
              <span className="text-foreground">
                {submission.progress.phase === 'registering'
                  ? 'Finishing project setup…'
                  : `${submission.progress.phase}…`}
              </span>
              {submission.progress.percent === null ? (
                // Indeterminate: no fake aria-valuenow.
                <progress className="ml-2 align-middle" aria-label="Clone progress" />
              ) : (
                <progress
                  className="ml-2 align-middle"
                  aria-label="Clone progress"
                  value={submission.progress.percent}
                  max={100}
                />
              )}
            </div>
          )}

          {submission.kind === 'cancelling' && (
            <span className="text-muted-foreground">Cancelling clone…</span>
          )}

          {submission.kind === 'connection-lost' && (
            <div className="text-foreground">
              <p>Connection interrupted. The clone may still be running.</p>
              {!submission.exhausted && <p className="text-muted-foreground">Checking status…</p>}
              {submission.lastProgress && (
                // Labelled as stale, and deliberately not an animated bar.
                <p className="text-muted-foreground">
                  Last update: {submission.lastProgress.phase}
                  {submission.lastProgress.percent !== null
                    ? ` ${submission.lastProgress.percent}%`
                    : ''}
                </p>
              )}
            </div>
          )}

          {submission.kind === 'cancelled' && (
            <span className="text-foreground">The clone was cancelled.</span>
          )}
        </div>

        {(submission.kind === 'failed' || submission.kind === 'needs-setup') && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="mt-4 rounded border border-danger p-3"
          >
            <p className="text-sm text-danger">{submission.failure.message}</p>
            {submission.failure.recovery?.action === 'use-existing' && (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    // Neither action deletes anything: this switches to review
                    // the folder that is already there.
                    const existingPath = submission.failure.recovery?.action === 'use-existing'
                      ? submission.failure.recovery.path
                      : '';
                    dismissFailure();
                    chooseMode('existing');
                    setPath(existingPath);
                  }}
                >
                  Use existing folder
                </button>
              </div>
            )}
            {submission.failure.detail && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">Details</summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {submission.failure.detail}
                </pre>
              </details>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
