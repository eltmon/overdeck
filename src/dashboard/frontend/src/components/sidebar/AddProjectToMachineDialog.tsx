/**
 * "Add this project to <machine>" (PAN-4651 FR-4, D-4651-14): clone a linked
 * machine's project to this machine (`here`), or one of this machine's projects
 * to a linked machine (`there`), and copy the chosen git-ignored files.
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
  addProjectThere,
  type AddProjectJob,
  FLEET_PROJECTS_QUERY_KEY,
  loadAddProjectJob,
  loadLocalProjectSource,
  loadOwnerProjectSource,
} from '../Settings/anywhere/machinesApi';

export const ADD_JOB_POLL_MS = 1_000;

export type AddProjectTarget =
  | {
    direction?: 'here';
    /** The linked machine that has the project (label or environment id). */
    machine: string;
    machineLabel: string;
    projectKey: string;
    projectName: string;
    /** This machine's label, for the title. */
    thisLabel: string;
  }
  | { direction: 'there'; machine: string; machineLabel: string; thisLabel: string };

async function fetchProjectChoices(): Promise<Array<{ key: string; name: string }>> {
  const res = await fetch('/api/registered-projects');
  const body = await res.json().catch(() => []) as Array<{ key?: unknown; name?: unknown }>;
  return Array.isArray(body) ? body.filter((p) => typeof p.key === 'string').map((p) => ({ key: p.key as string, name: typeof p.name === 'string' && p.name ? p.name : p.key as string })) : [];
}

const STEP_TEXT: Record<AddProjectJob['step'], string> = { clone: 'Cloning…', files: 'Copying files…', done: 'Done', failed: 'Failed' };

export function AddProjectToMachineDialog({ target, onClose }: { target: AddProjectTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const there = target.direction === 'there';
  const [localKey, setLocalKey] = useState('');
  const projectKey = target.direction === 'there' ? localKey : target.projectKey;
  const { data: choices } = useQuery({ queryKey: ['add-there-project-choices'], queryFn: fetchProjectChoices, enabled: there });
  const { data: source, error: sourceError } = useQuery({
    queryKey: ['fleet-project-source', there ? 'local' : target.machine, projectKey],
    queryFn: () => (there ? loadLocalProjectSource(projectKey) : loadOwnerProjectSource(target.machine, projectKey)),
    enabled: projectKey !== '',
  });
  const projectName = target.direction === 'there' ? (source?.name ?? localKey) : target.projectName;
  const destination = there ? target.machineLabel : target.thisLabel;
  const [jobMachine, setJobMachine] = useState<string | undefined>(undefined);
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
        const next = await loadAddProjectJob(jobId, jobMachine);
        if (stopped) return;
        setJob(next);
        if (next.step === 'done') {
          toast.success(`Added ${projectName} to ${destination}`);
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
  }, [jobId, jobMachine, queryClient, projectName, destination]);

  const toggle = (path: string) => setSelected((current) => {
    const next = new Set(current ?? []);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const submit = async () => {
    setError(null);
    const input = { machine: target.machine, projectKey, files: [...(selected ?? [])] };
    const result = there ? await addProjectThere(input) : await addProjectHere(input);
    if (!isOk(result)) {
      setError(apiError(result));
      return;
    }
    const owner = (result.body as { machine?: string }).machine;
    if (owner) setJobMachine(owner);
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
          <h3 id="add-project-title" className="text-base font-medium text-foreground">{there ? `Add a project to ${destination}` : `Add ${projectName} to ${destination}`}</h3>
          <button type="button" onClick={onClose} aria-label="Close" disabled={running} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {there
              ? `Clones the repository from its origin on ${destination} and registers it there. Checked files are copied from this machine (0600; an existing file is kept).`
              : `Clones the repository from its origin and registers it here. Checked files are copied from ${target.machineLabel} (0600; an existing file is kept).`}
          </p>
          {there && (
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Project</span>
              <select aria-label="Project" value={localKey} onChange={(e) => { setLocalKey(e.target.value); setSelected(null); }} disabled={jobId !== null}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground">
                <option value="">Choose a project…</option>
                {(choices ?? []).map((choice) => <option key={choice.key} value={choice.key}>{choice.name}</option>)}
              </select>
            </label>
          )}
          {sourceError && <p className="text-xs text-destructive" role="alert">{(sourceError as Error).message}</p>}
          {projectKey !== '' && !source && !sourceError && <p className="text-xs text-muted-foreground">Reading {there ? 'the project' : target.machineLabel}…</p>}
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
                Add to {destination}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
