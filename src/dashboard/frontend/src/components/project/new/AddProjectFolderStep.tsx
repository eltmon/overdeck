/**
 * "Open a folder" (PAN-4281 WI-9, FR-8): choose a folder, let resolve look at
 * it, then show what it found.
 *
 *   - pick: type a path, or browse server folders starting at the default
 *     projects folder.
 *   - waiting: resolve is checking the chosen folder.
 *   - review: a Git repository shows the form (with a notice when resolve
 *     snapped a subfolder to its repository root); a folder that holds
 *     repositories shows the nested step; a plain folder is explained first,
 *     with **Add as folder** and **Back**.
 *
 * The nested step renders from here rather than as a dialog step so its Back
 * returns to this picker where the operator left it.
 *
 * Step copy stays clear of the simple-mode banned words; the "create a
 * workspace" guidance shows on the full page only.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { FolderPicker } from '../../CommandDeck/FolderPicker.js';
import { useProjectCreateIntent } from './useProjectCreateIntent.js';
import {
  buttonClass,
  inputClass,
  labelClass,
  ProjectCreateForm,
  ProjectWorkspaceGuide,
} from './ProjectCreateForm.js';
import { tildePath, useProjectSuggestions } from './useProjectSuggestions.js';
import { AddProjectNestedStep } from './AddProjectNestedStep.js';
import type { CreatedProject } from './projectCreateTypes.js';

interface AddProjectFolderStepProps {
  titleId?: string;
  showGuide: boolean;
  onCreated: (project: CreatedProject) => void;
  /** "Change": back to the start step. */
  onChange: () => void;
  onCancel: () => void;
  /** True while an add is running, so the dialog keeps itself open. */
  onBusyChange?: (busy: boolean) => void;
}

type Phase = 'pick' | 'waiting' | 'review';

export function AddProjectFolderStep({
  titleId,
  showGuide,
  onCreated,
  onChange,
  onCancel,
  onBusyChange,
}: AddProjectFolderStepProps) {
  const create = useProjectCreateIntent({ initialMode: 'existing', onCreated });
  const { path, setPath, intent, checking, resolveError, canCreate, submit, submission, frozen } = create;
  const [nestedRunning, setNestedRunning] = useState(false);
  useEffect(() => {
    onBusyChange?.(frozen || nestedRunning);
    return () => onBusyChange?.(false);
  }, [frozen, nestedRunning, onBusyChange]);
  const suggestions = useProjectSuggestions();

  const folderId = useId();
  const [phase, setPhase] = useState<Phase>('pick');
  const [typed, setTyped] = useState('');
  const [pickerStart, setPickerStart] = useState<string | undefined>(undefined);
  const folderRef = useRef<HTMLInputElement | null>(null);
  // The render right after setPath still shows the previous resolve with
  // `checking` false; only a checking→idle transition means this folder's
  // resolve has answered.
  const sawChecking = useRef(false);

  useEffect(() => {
    if (phase === 'pick') folderRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    if (checking) sawChecking.current = true;
    else if (sawChecking.current) setPhase('review');
  }, [phase, checking]);

  const choose = (selected: string) => {
    const folder = selected.trim();
    if (!folder) return;
    setTyped(folder);
    if (folder === path && intent && !checking) {
      // Same folder as the last resolve: nothing new to wait for.
      setPhase('review');
      return;
    }
    sawChecking.current = false;
    setPath(folder);
    setPhase('waiting');
  };

  const backToPicker = () => {
    // Pick up where the operator was, not back at the projects folder.
    setPickerStart(intent?.path ?? (path || undefined));
    setPhase('pick');
  };

  const header = (withChange: boolean) => (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 id={titleId} className="text-xl font-semibold text-foreground">
          Add a project
        </h1>
        {withChange && (
          <button type="button" onClick={onChange} className="text-sm text-muted-foreground underline">
            Change
          </button>
        )}
      </div>
      {showGuide && <ProjectWorkspaceGuide />}
    </>
  );

  if (phase === 'review' && intent && !resolveError) {
    const snap = (intent.notices ?? []).find((notice) => notice.code === 'using-repository-root');
    const banner = snap ? (
      <p role="status" className="mt-2 text-sm text-foreground">
        Using the repository root{' '}
        <span className="font-mono">{tildePath(snap.detail ?? intent.path ?? '', intent.homeDir)}</span>.
      </p>
    ) : null;

    const nested = intent.nestedRepositories ?? [];
    if (!intent.isGitRepository && nested.length > 0 && intent.path) {
      return (
        <AddProjectNestedStep
          titleId={titleId}
          folder={intent.path}
          homeDir={intent.homeDir}
          repositories={nested}
          onCreated={onCreated}
          onBack={backToPicker}
          onCancel={onCancel}
          onRunningChange={setNestedRunning}
        />
      );
    }

    // A plain folder is explained before it is added. Once a submit has
    // started, the form owns progress, failure and setup recovery.
    if (!intent.isGitRepository && (submission.kind === 'editing' || submission.kind === 'submitting')) {
      return (
        <div className="mx-auto w-full max-w-[42rem] px-6 py-12">
          {header(true)}
          <p className="mt-8 font-mono text-sm text-foreground">{tildePath(intent.path ?? path, intent.homeDir)}</p>
          <p className="mt-2 text-sm text-foreground">
            This folder isn&apos;t a Git repository. Agents and terminals work here; branches, isolated
            copies and pull requests won&apos;t.
          </p>
          {intent.findings.length > 0 && (
            <div role="alert" className="mt-2 space-y-1">
              {intent.findings.map((finding) => (
                <p key={finding.code} className="text-sm text-danger">
                  {finding.message}
                </p>
              ))}
            </div>
          )}
          <div className="mt-8 flex items-center gap-3">
            <button type="button" disabled={!canCreate} onClick={() => void submit()} className={buttonClass}>
              {submission.kind === 'submitting' ? 'Adding…' : 'Add as folder'}
            </button>
            <button type="button" disabled={submission.kind === 'submitting'} onClick={backToPicker} className={buttonClass}>
              Back
            </button>
          </div>
        </div>
      );
    }

    return <ProjectCreateForm create={create} titleId={titleId} banner={banner} onChange={onChange} onCancel={onCancel} />;
  }

  return (
    <div className="mx-auto w-full max-w-[42rem] px-6 py-12">
      {header(true)}
      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          choose(typed);
        }}
      >
        <label className={labelClass} htmlFor={folderId}>
          Folder
        </label>
        <div className="flex gap-2">
          <input
            id={folderId}
            ref={folderRef}
            className={`${inputClass} font-mono`}
            value={typed}
            placeholder="/home/you/Projects/my-repo"
            onChange={(event) => setTyped(event.target.value)}
          />
          <button type="submit" disabled={!typed.trim() || phase === 'waiting'} className={buttonClass}>
            Continue
          </button>
        </div>
      </form>
      <div className="mt-4 rounded border border-border p-3">
        <FolderPicker initialPath={pickerStart ?? suggestions.root} onSelect={choose} />
      </div>
      <div aria-live="polite" className="mt-4 min-h-[1.5rem] text-sm">
        {phase === 'waiting' && <span className="text-muted-foreground">Checking…</span>}
        {phase === 'review' && resolveError && <span className="text-danger">{resolveError}</span>}
      </div>
      <button type="button" onClick={onCancel} className={`mt-4 ${buttonClass}`}>
        Cancel
      </button>
    </div>
  );
}
