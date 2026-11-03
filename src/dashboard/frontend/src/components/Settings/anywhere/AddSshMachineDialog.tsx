/**
 * Add an SSH machine (PAN-4404 FR-1, FR-9, FR-10): this dashboard runs `ssh` to
 * the host, starts or adopts Overdeck there, forwards a port and links over it.
 * Host (with the `~/.ssh/config` aliases as suggestions), "Link both ways", and
 * an optional path to `pan` under Advanced — three fields, so a modal
 * (page-not-modal doctrine allows 4 or fewer). The add request is synchronous
 * and can take a minute (D-4404-15).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Modal } from '../../shared/Modal';
import { ANYWHERE_STATUS_QUERY_KEY, isOk } from './anywhereApi';
import styles from './anywhereDialog.module.css';
import { MACHINES_QUERY_KEY } from './machinesApi';
import { addSshMachine, fetchSshConfigHosts, sshErrorText, type SshTestResult, testSshHost } from './sshMachinesApi';

interface AddSshMachineDialogProps {
  open: boolean;
  onClose: () => void;
}

export const SSH_CONFIG_HOSTS_QUERY_KEY = ['anywhere-ssh-config-hosts'] as const;

export function AddSshMachineDialog({ open, onClose }: AddSshMachineDialogProps) {
  if (!open) return null;
  return <AddSshMachineDialogBody onClose={onClose} />;
}

function testSentence(host: string, result: SshTestResult): string {
  if (result.error && result.error !== 'version-mismatch') return result.message ?? result.error;
  const reached = `Reached ${host}: pan ${result.panVersion ?? '?'}`;
  return result.versionMatches
    ? `${reached}. It matches this machine.`
    : `${reached}. This machine has ${result.localVersion}; install the same version there before adding it.`;
}

function AddSshMachineDialogBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [host, setHost] = useState('');
  const [bothWays, setBothWays] = useState(true);
  const [panPath, setPanPath] = useState('');
  const [busy, setBusy] = useState<'test' | 'add' | null>(null);
  const [testText, setTestText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: configHosts } = useQuery({
    queryKey: SSH_CONFIG_HOSTS_QUERY_KEY,
    queryFn: async () => {
      const result = await fetchSshConfigHosts();
      return isOk(result) ? result.body.hosts : [];
    },
    staleTime: 60_000,
  });

  const trimmedHost = host.trim();
  const trimmedPanPath = panPath.trim();
  const target = { host: trimmedHost, ...(trimmedPanPath ? { panPath: trimmedPanPath } : {}) };

  const handleTest = async () => {
    if (trimmedHost === '') return;
    setBusy('test');
    setError(null);
    setTestText(null);
    try {
      const result = await testSshHost(target);
      if (!isOk(result)) {
        setError(sshErrorText(result));
        return;
      }
      setTestText(testSentence(trimmedHost, result.body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = async () => {
    if (trimmedHost === '') return;
    setBusy('add');
    setError(null);
    setTestText(null);
    try {
      const result = await addSshMachine({ ...target, bothWays });
      if (!isOk(result)) {
        setError(sshErrorText(result));
        return;
      }
      toast.success(`Linked ${result.body.label} over SSH`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY }),
      ]);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="Add an SSH machine"
      onClose={onClose}
      dismissible={busy !== 'add'}
      onSubmit={(e) => {
        e.preventDefault();
        void handleAdd();
      }}
      pinned={(busy === 'add' || testText || error) ? (
        <>
          {busy === 'add' && (
            <p className={styles.status} role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Connecting to {trimmedHost}. Starting Overdeck there can take a minute.
            </p>
          )}
          {testText && <p className={styles.text} role="status" data-testid="add-ssh-test-result">{testText}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </>
      ) : null}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy === 'add'} className={styles.button}>
          Cancel
        </button>
        <button type="button" onClick={() => void handleTest()} disabled={trimmedHost === '' || busy !== null} className={styles.button}>
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        <button type="submit" disabled={trimmedHost === '' || busy !== null} className={styles.primaryButton}>
          {busy === 'add' ? 'Adding…' : 'Add'}
        </button>
      </>}
    >
      <div className={styles.form} data-component="add-ssh-machine-dialog">
        <div className={styles.field}>
          <label htmlFor="add-ssh-host" className={styles.label}>SSH host</label>
          <input
            id="add-ssh-host"
            type="text"
            list="add-ssh-config-hosts"
            placeholder="desk, me@vps.example.com or ssh://me@host:2222"
            value={host}
            disabled={busy === 'add'}
            onChange={(e) => {
              setHost(e.target.value);
              setError(null);
              setTestText(null);
            }}
            className={`${styles.input} ${styles.mono}`}
          />
          <datalist id="add-ssh-config-hosts" data-testid="add-ssh-config-hosts">
            {(configHosts ?? []).map((alias) => <option key={alias} value={alias} />)}
          </datalist>
          <p className={styles.hint}>
            This dashboard runs <code>ssh</code> with its own keys and <code>~/.ssh/config</code>.
            The host needs the same pan version as this machine.
          </p>
        </div>

        <label className={styles.choice}>
          <input type="checkbox" checked={bothWays} disabled={busy === 'add'} onChange={(e) => setBothWays(e.target.checked)} />
          <span className="min-w-0">
            <span className={styles.choiceTitle}>Link both ways</span>
            <span className={styles.choiceHint}>The other machine gets the same access to this one, so either dashboard can show both.</span>
          </span>
        </label>

        <details className={styles.details}>
          <summary>Advanced</summary>
          <div className={styles.field}>
            <label htmlFor="add-ssh-pan-path" className={styles.label}>Path to pan on the host</label>
            <input
              id="add-ssh-pan-path"
              type="text"
              placeholder="/home/me/.local/bin/pan"
              value={panPath}
              disabled={busy === 'add'}
              onChange={(e) => setPanPath(e.target.value)}
              className={`${styles.input} ${styles.mono}`}
            />
            <p className={styles.hint}>Leave empty to use pan from the host's login PATH.</p>
          </div>
        </details>
      </div>
    </Modal>
  );
}
