/**
 * "Add this project to <machine>" (PAN-4651 FR-4, D-4651-14): clone a linked
 * machine's project to this machine and copy the chosen git-ignored files.
 * `.env`, `.envrc` and `.dev.vars` start checked; every other offered file
 * starts unchecked. Files are written 0600 and never overwrite an existing
 * file. The dialog follows the add job until it is done or failed.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { apiError, isOk } from '../Settings/anywhere/anywhereApi';
import {
  addProjectHere,
  type AddProjectJob,
  FLEET_PROJECTS_QUERY_KEY,
  loadAddProjectJob,
  loadOwnerProjectSource,
} from '../Settings/anywhere/machinesApi';

export const ADD_JOB_POLL_MS = 1_000;

export interface AddProjectTarget {
  /** The linked machine that has the project (label or environment id). */
  machine: string;
  machineLabel: string;
  projectKey: string;
  projectName: string;
  /** This machine's label, for the title. */
  thisLabel: string;
}

const STEP_TEXT: Record<AddProjectJob['step'], string> = { clone: 'Cloning…', files: 'Copying files…', done: 'Done', failed: 'Failed' };

export function AddProjectToMachineDialog({ target, onClose }: { target: AddProjectTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: source, error: sourceError } = useQuery({
    queryKey: ['fleet-project-source', target.machine, target.projectKey],
    queryFn: () => loadOwnerProjectSource(target.machine, target.projectKey),
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<AddProjectJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source && selected === null) setSelected(new Set(source.ignoredFiles.filter((file) => file.preselected).map((file) => file.path)));
  }, [source, selected]);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await loadAddProjectJob(jobId);
        if (stopped) return;
        setJob(next);
        if (next.step === 'done') {
          toast.success(`Added ${target.projectName} to ${target.thisLabel}`);
          void queryClient.invalidateQueries({ queryKey: FLEET_PROJECTS_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: ['registered-projects'] });
          void queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] });
          return;
        }
        if (next.step === 'failed') return;
      } catch (err) {
        if (!stopped) setError((err as Error).message);
        return;
      }
      if (!stopped) setTimeout(() => void tick(), ADD_JOB_POLL_MS);
    };
    void tick();
    return () => { stopped = true; };
  }, [jobId, queryClient, target.projectName, target.thisLabel]);

  const toggle = (path: string) => setSelected((current) => {
    const next = new Set(current ?? []);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const submit = async () => {
    setError(null);
    const result = await addProjectHere({ machine: target.machine, projectKey: target.projectKey, files: [...(selected ?? [])] });
    if (!isOk(result)) {
      setError(apiError(result));
      return;
    }
    setJobId(result.body.jobId);
  };

  const running = jobId !== null && job?.step !== 'done' && job?.step !== 'failed';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={running ? undefined : onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        data-component="add-project-to-machine-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="add-project-title" className="text-base font-medium text-foreground">Add {target.projectName} to {target.thisLabel}</h3>
          <button type="button" onClick={onClose} aria-label="Close" disabled={running} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Clones the repository from its origin and registers it here. Checked files are copied from {target.machineLabel} (0600; an existing file is kept).
          </p>
          {sourceError && <p className="text-xs text-destructive" role="alert">{(sourceError as Error).message}</p>}
          {!source && !sourceError && <p className="text-xs text-muted-foreground">Reading {target.machineLabel}…</p>}
          {source && (
            <fieldset className="space-y-1">
              <legend className="text-xs text-muted-foreground mb-1">Files to copy</legend>
              {source.ignoredFiles.length === 0 && <p className="text-xs text-muted-foreground">No git-ignored files to copy.</p>}
              {source.ignoredFiles.map((file) => (
                <label key={file.path} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" aria-label={file.path} checked={selected?.has(file.path) ?? false} onChange={() => toggle(file.path)} disabled={jobId !== null} className="accent-primary" />
                  <span className="font-mono text-xs text-foreground truncate">{file.path}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{file.bytes} B</span>
                </label>
              ))}
            </fieldset>
          )}
          {job && (
            <div className="text-xs text-muted-foreground" data-testid="add-project-step">
              {STEP_TEXT[job.step]}{job.error ? `: ${job.error}` : ''}
              {job.files?.map((file) => <span key={file.path} className="block font-mono">{file.path}: {file.result}</span>)}
            </div>
          )}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={running} className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors">
              {job?.step === 'done' ? 'Close' : 'Cancel'}
            </button>
            {jobId === null && (
              <button type="button" onClick={() => void submit()} disabled={!source} className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                Add to {target.thisLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
