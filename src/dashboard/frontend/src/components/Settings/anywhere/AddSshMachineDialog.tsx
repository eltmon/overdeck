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
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { ANYWHERE_STATUS_QUERY_KEY, isOk } from './anywhereApi';
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

  const buttonClass = 'rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={busy === 'add' ? undefined : onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-ssh-machine-title"
        data-component="add-ssh-machine-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="add-ssh-machine-title" className="text-base font-medium text-foreground">Add an SSH machine</h3>
          <button type="button" onClick={onClose} disabled={busy === 'add'} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          className="p-4 space-y-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="add-ssh-host" className="text-xs text-muted-foreground">SSH host</label>
            <input
              id="add-ssh-host"
              type="text"
              autoFocus
              list="add-ssh-config-hosts"
              placeholder="desk, me@vps.example.com or ssh://me@host:2222"
              value={host}
              disabled={busy === 'add'}
              onChange={(e) => {
                setHost(e.target.value);
                setError(null);
                setTestText(null);
              }}
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono focus:ring-1 focus:ring-primary"
            />
            <datalist id="add-ssh-config-hosts" data-testid="add-ssh-config-hosts">
              {(configHosts ?? []).map((alias) => <option key={alias} value={alias} />)}
            </datalist>
            <p className="text-xs text-muted-foreground">
              This dashboard runs <code className="font-mono">ssh</code> with its own keys and <code className="font-mono">~/.ssh/config</code>.
              The host needs the same pan version as this machine.
            </p>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={bothWays} disabled={busy === 'add'} onChange={(e) => setBothWays(e.target.checked)} className="mt-0.5 shrink-0 accent-primary" />
            <span className="min-w-0">
              <span className="text-sm text-foreground">Link both ways</span>
              <span className="block text-xs text-muted-foreground mt-0.5">The other machine gets the same access to this one, so either dashboard can show both.</span>
            </span>
          </label>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Advanced</summary>
            <div className="mt-2 space-y-1">
              <label htmlFor="add-ssh-pan-path" className="text-xs text-muted-foreground">Path to pan on the host</label>
              <input
                id="add-ssh-pan-path"
                type="text"
                placeholder="/home/me/.local/bin/pan"
                value={panPath}
                disabled={busy === 'add'}
                onChange={(e) => setPanPath(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono focus:ring-1 focus:ring-primary"
              />
              <p className="text-muted-foreground">Leave empty to use pan from the host's login PATH.</p>
            </div>
          </details>

          {busy === 'add' && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Connecting to {trimmedHost}. Starting Overdeck there can take a minute.
            </p>
          )}
          {testText && <p className="text-xs text-foreground" role="status" data-testid="add-ssh-test-result">{testText}</p>}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy === 'add'} className={buttonClass}>
              Cancel
            </button>
            <button type="button" onClick={() => void handleTest()} disabled={trimmedHost === '' || busy !== null} className={buttonClass}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </button>
            <button
              type="submit"
              disabled={trimmedHost === '' || busy !== null}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {busy === 'add' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
