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
import { toast } from 'sonner';

import { Modal } from '../shared/Modal';
import { apiError, isOk } from '../Settings/anywhere/anywhereApi';
import styles from '../Settings/anywhere/anywhereDialog.module.css';
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
    <Modal
      title={there ? `Add a project to ${destination}` : `Add ${projectName} to ${destination}`}
      onClose={onClose}
      dismissible={!running}
      pinned={error ? <p className={styles.error} role="alert">{error}</p> : null}
      footer={<>
        <button type="button" onClick={onClose} disabled={running} className={styles.button}>
          {job?.step === 'done' ? 'Close' : 'Cancel'}
        </button>
        {jobId === null && (
          <button type="button" onClick={() => void submit()} disabled={!source} className={styles.primaryButton}>
            Add to {destination}
          </button>
        )}
      </>}
    >
      <div className={styles.form} data-component="add-project-to-machine-dialog">
        <p className={styles.hint}>
          {there
            ? `Clones the repository from its origin on ${destination} and registers it there. Checked files are copied from this machine (0600; an existing file is kept).`
            : `Clones the repository from its origin and registers it here. Checked files are copied from ${target.machineLabel} (0600; an existing file is kept).`}
        </p>
        {there && (
          <label className={styles.field}>
            <span className={styles.label}>Project</span>
            <select aria-label="Project" value={localKey} onChange={(e) => { setLocalKey(e.target.value); setSelected(null); }} disabled={jobId !== null} className={styles.select}>
              <option value="">Choose a project…</option>
              {(choices ?? []).map((choice) => <option key={choice.key} value={choice.key}>{choice.name}</option>)}
            </select>
          </label>
        )}
        {sourceError && <p className={styles.error} role="alert">{(sourceError as Error).message}</p>}
        {projectKey !== '' && !source && !sourceError && <p className={styles.status}>Reading {there ? 'the project' : target.machineLabel}…</p>}
        {source && (
          <fieldset className={styles.fieldset}>
            <legend className={`${styles.label} mb-2`}>Files to copy</legend>
            {source.ignoredFiles.length === 0 && <p className={styles.hint}>No git-ignored files to copy.</p>}
            {source.ignoredFiles.map((file) => (
              <label key={file.path} className={`${styles.choice} items-center`}>
                <input type="checkbox" aria-label={file.path} checked={selected?.has(file.path) ?? false} onChange={() => toggle(file.path)} disabled={jobId !== null} className="!mt-0" />
                <span className={`${styles.mono} min-w-0 truncate text-foreground`}>{file.path}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{file.bytes} B</span>
              </label>
            ))}
          </fieldset>
        )}
        {job && (
          <div className={styles.status + ' flex-col items-start gap-1'} data-testid="add-project-step">
            <span>{STEP_TEXT[job.step]}{job.error ? `: ${job.error}` : ''}</span>
            {job.files?.map((file) => <span key={file.path} className={styles.mono}>{file.path}: {file.result}</span>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
