/**
 * Add a Fly machine (PAN-4743 WI-9, D-4743-9, -11): starts a Fly.io VM that
 * runs `pan serve` and links it one way from here (`POST /api/machines/fly`,
 * the `addFlyMachine()` door in `fly-machine-service.ts`). Project and Region
 * are both optional — within the page-not-modal four-field limit — so the
 * dialog carries no message, harness or model field; a conversation on the
 * new VM is started from the new-conversation dialog's Fly (new VM) choice
 * instead. The request is synchronous and can take minutes, longer with a
 * project to clone.
 *
 * PAN-4905: the dialog stays openable when remote is off. It reads
 * `self.remoteEnabled` from the shared `GET /api/machines` query and shows a
 * "Remote is off" notice with the hint before any click on Add, disabling Add
 * until remote is on.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { fetchRegisteredProjects } from '../../CommandDeck/UnknownProjectState';
import { Modal } from '../../shared/Modal';
import { ANYWHERE_STATUS_QUERY_KEY, apiError, isOk } from './anywhereApi';
import styles from './anywhereDialog.module.css';
import { addFlyMachine, enableRemote, loadMachines, MACHINES_QUERY_KEY } from './machinesApi';

interface AddFlyMachineDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddFlyMachineDialog({ open, onClose }: AddFlyMachineDialogProps) {
  if (!open) return null;
  return <AddFlyMachineDialogBody onClose={onClose} />;
}

function AddFlyMachineDialogBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [projectKey, setProjectKey] = useState('');
  const [region, setRegion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteDisabledRace, setRemoteDisabledRace] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const { data: projects } = useQuery({ queryKey: ['registered-projects'], queryFn: fetchRegisteredProjects });
  const { data: machines } = useQuery({ queryKey: MACHINES_QUERY_KEY, queryFn: loadMachines });
  const remoteOff = machines?.self.remoteEnabled === false || remoteDisabledRace;

  const trimmedRegion = region.trim();

  const handleAdd = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await addFlyMachine({ ...(projectKey ? { projectKey } : {}), ...(trimmedRegion ? { region: trimmedRegion } : {}) });
      if (!isOk(result)) {
        const body = result.body as { message?: unknown; error?: unknown } | null;
        if (body?.error === 'remote-disabled') setRemoteDisabledRace(true);
        setError(typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : apiError(result));
        return;
      }
      const { record } = result.body;
      toast.success(`Linked ${record.label} (Fly app ${record.appName}, region ${record.region})`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY }),
      ]);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEnableRemote = async () => {
    setEnabling(true);
    try {
      const result = await enableRemote();
      if (!isOk(result)) {
        const body = result.body as { message?: unknown } | null;
        setError(typeof body?.message === 'string' ? body.message : apiError(result));
        return;
      }
      setError(null);
      setRemoteDisabledRace(false);
      toast.success(`Turned on remote in ${result.body.configFile}`);
      await queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnabling(false);
    }
  };

  return (
    <Modal
      title="Add a Fly machine"
      onClose={onClose}
      dismissible={!busy}
      onSubmit={(e) => {
        e.preventDefault();
        void handleAdd();
      }}
      pinned={busy ? (
        <p className={styles.status} role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Starting a Fly machine. This takes a few minutes, longer with a project.
        </p>
      ) : error ? <p className={styles.error} role="alert">{error}</p> : null}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={styles.button}>
          Cancel
        </button>
        <button type="submit" disabled={busy || remoteOff} className={styles.primaryButton}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </>}
    >
      <div className={styles.form} data-component="add-fly-machine-dialog">
        {remoteOff && (
          <div role="status" data-testid="fly-remote-off" className={styles.notice}>
            <p>
              Remote is off. Fly machines need <code>enabled = true</code> under <code>[remote]</code> in <code>{machines?.self.remoteConfigFile ?? '~/.overdeck/config.toml'}</code>.
            </p>
            <button type="button" onClick={() => void handleEnableRemote()} disabled={enabling} className={styles.button}>
              {enabling ? 'Turning on…' : 'Turn on remote'}
            </button>
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor="add-fly-project" className={styles.label}>Project</label>
          <select
            id="add-fly-project"
            value={projectKey}
            disabled={busy}
            onChange={(e) => setProjectKey(e.target.value)}
            className={styles.select}
          >
            <option value="">No project</option>
            {(projects ?? []).map((project) => <option key={project.key} value={project.key}>{project.name ?? project.key}</option>)}
          </select>
          <p className={styles.hint}>
            Starts a Fly.io VM that runs Overdeck and links it to this machine. With a project, the VM clones it.
            Needs remote turned on and a Fly token; see Fly machines in the docs.
          </p>
        </div>

        <details className={styles.details}>
          <summary>Advanced</summary>
          <div className={styles.field}>
            <label htmlFor="add-fly-region" className={styles.label}>Region</label>
            <input
              id="add-fly-region"
              type="text"
              placeholder="iad"
              value={region}
              disabled={busy}
              onChange={(e) => setRegion(e.target.value)}
              className={`${styles.input} ${styles.mono}`}
            />
          </div>
        </details>
      </div>
    </Modal>
  );
}
