import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { SettingsSection } from '../primitives';
import { SessionVaultJoinForm } from './SessionVaultJoinForm';
import { RecoveryDialog, SessionVaultSetupForm, type ShownOnce } from './SessionVaultSetupForm';
import { BUTTON_CLASS, postVault } from './sessionVaultShared';

type VaultState = 'off' | 'rotation-pending' | 'key-missing' | 'key-mismatch' | 'ready';

interface VaultStatusResponse {
  state: VaultState;
  running: boolean;
  backend: string | null;
  evict: boolean;
  lastSync: null | {
    at: string;
    offline: boolean;
    records: number;
    appended: number;
    errors: Array<{ nativePath: string; message: string }>;
    blocked: Array<{ nativePath: string; vaultId: string; hits: Array<{ line: number; pattern: string }> }>;
  };
  machines: Array<{ label: string; isThisMachine: boolean; lastSyncedAt: string }>;
}

interface EvictionEntry {
  vaultId: string;
  title: string;
  harness: string;
  nativePath: string;
  sizeBytes: number;
  verification: 'verified' | 'failed';
  reason?: string;
  checkedAt: string;
}

interface DeclinedEntry {
  vaultId: string;
  nativePath: string;
  declinedAt: string;
}

interface EvictionBatchResponse {
  evict: boolean;
  fingerprint: string;
  entries: EvictionEntry[];
  declined: DeclinedEntry[];
  totalBytes: number;
  deletableCount: number;
  deletableBytes: number;
}

interface ConfirmSuccess {
  deleted: string[];
  skipped: Array<{ nativePath: string; reason: string }>;
  bytesFreed: number;
  fingerprint: string;
}

interface ConfirmRefused {
  error: string;
  code: 'batch-changed' | 'vault-unavailable';
  fingerprint?: string;
}

const STATUS_QUERY_KEY = ['vault-status'];
const AUTO_SYNC_DOCS = 'https://overdeck.ai/configuration/session-vault#save-and-sync';
const BATCH_QUERY_KEY = ['vault-eviction-batch'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function fetchVaultStatus(): Promise<VaultStatusResponse> {
  const res = await fetch('/api/vault/status');
  if (!res.ok) throw new Error(`Failed to fetch vault status (${res.status})`);
  return res.json();
}

async function fetchVaultEvictionBatch(): Promise<EvictionBatchResponse> {
  const res = await fetch('/api/vault/eviction-batch');
  if (!res.ok) throw new Error(`Failed to fetch vault eviction batch (${res.status})`);
  return res.json();
}

/** FR-11: one sync now, through the primary dashboard's vault queue; the response is the fresh status. */
function SyncNowButton() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const handleSync = async () => {
    setSyncing(true);
    try {
      const { status, body } = await postVault('sync');
      if (status === 200 && body) queryClient.setQueryData(STATUS_QUERY_KEY, body);
      else toast.error((body as { error?: string } | null)?.error ?? `Sync failed (${status}).`);
    } catch (error) {
      toast.error(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <button type="button" disabled={syncing} onClick={() => void handleSync()} className={BUTTON_CLASS}>
      {syncing ? 'Syncing…' : 'Sync now'}
    </button>
  );
}

function VaultStatusBlock({ status, onChanged, onCreated }: {
  status: VaultStatusResponse;
  onChanged: (message?: string) => void;
  onCreated: (secrets: ShownOnce) => void;
}) {
  if (status.state === 'off') {
    return (
      <div className="space-y-6">
        <SessionVaultSetupForm onDone={onChanged} onCreated={onCreated} />
        <SessionVaultJoinForm mode="join" backend={null} onDone={onChanged} />
      </div>
    );
  }
  if (status.state === 'key-missing' || status.state === 'key-mismatch') {
    return <SessionVaultJoinForm mode="unlock" backend={status.backend} onDone={onChanged} />;
  }

  return (
    <div className="space-y-1 text-xs">
      {status.state === 'rotation-pending' && (
        <p className="text-muted-foreground">A key rotation is unfinished on this machine. Run: pan vault rotate-key</p>
      )}
      {status.state === 'ready' && (
        <>
          <p className="text-muted-foreground">
            Backend: <span className="text-foreground">{status.backend}</span>
            {status.lastSync && (
              <>
                {' · '}Last sync:{' '}
                <span data-testid="vault-last-sync" className="text-foreground" title={status.lastSync.at}>{formatRelativeTime(status.lastSync.at)}</span>
                {status.lastSync.offline && <span className="text-muted-foreground"> · Offline</span>}
              </>
            )}
          </p>
          {status.lastSync?.errors.map((err) => (
            <p key={err.nativePath} className="text-destructive">{err.nativePath}: {err.message}</p>
          ))}
          {status.lastSync?.blocked.flatMap((entry) =>
            entry.hits.map((hit) => (
              <p key={`${entry.vaultId}-${hit.line}`} className="text-destructive">
                {entry.nativePath}: line {hit.line}: {hit.pattern} — pan vault allow-secret {entry.vaultId} {hit.line}
              </p>
            )),
          )}
          {status.running && (
            <div className="pt-1">
              <SyncNowButton />
            </div>
          )}
          <p className="text-muted-foreground">
            Sync runs automatically every few minutes in the primary dashboard. Change the interval in the docs:{' '}
            <a href={AUTO_SYNC_DOCS} target="_blank" rel="noreferrer" className="underline hover:text-foreground">Session Vault configuration</a>.
          </p>
        </>
      )}
      {!status.running && (
        <p className="text-muted-foreground">Background sync runs only in the primary dashboard.</p>
      )}
    </div>
  );
}

function MachinesTable({ machines }: { machines: VaultStatusResponse['machines'] }) {
  if (machines.length === 0) return <p className="text-xs text-muted-foreground">No machines have synced yet.</p>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {machines.map((machine) => (
          <tr key={machine.label}>
            <td className="py-1 pr-4 text-foreground">
              {machine.label}
              {machine.isThisMachine && <span className="text-muted-foreground"> (this machine)</span>}
            </td>
            <td className="py-1 text-muted-foreground" title={machine.lastSyncedAt}>{formatRelativeTime(machine.lastSyncedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SessionVaultSection() {
  const queryClient = useQueryClient();

  const { data: status, error: statusError } = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchVaultStatus,
  });
  const { data: batch, error: batchError } = useQuery({
    queryKey: BATCH_QUERY_KEY,
    queryFn: fetchVaultEvictionBatch,
    enabled: status?.state !== 'off',
  });

  const refetchBatch = () => void queryClient.invalidateQueries({ queryKey: BATCH_QUERY_KEY });
  /** The line a setup or join reported; `shownIn` is the state it landed in, so the next state change clears it. */
  const [vaultNotice, setVaultNotice] = useState<{ message: string; shownIn: VaultState | null } | null>(null);
  /**
   * FR-9, D-11: the shown-once recovery phrase and generated passphrase. Held here, not in the
   * setup form: the next status refetch reports `ready` and unmounts the form, and the dialog
   * must stay until the operator checks "I wrote it down" and clicks Done.
   */
  const [shownOnce, setShownOnce] = useState<ShownOnce | null>(null);
  /** A setup or join changed the vault: show its line (if any) and re-read the status. */
  const handleVaultChanged = (message?: string) => {
    setVaultNotice(message ? { message, shownIn: null } : null);
    void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
  };
  const handleRecoveryDone = () => {
    setShownOnce(null);
    handleVaultChanged();
  };

  const currentState = status?.state;
  useEffect(() => {
    if (!currentState) return;
    setVaultNotice((notice) => {
      if (!notice) return notice;
      if (notice.shownIn === null) return { ...notice, shownIn: currentState };
      return notice.shownIn === currentState ? notice : null;
    });
  }, [currentState]);

  /** Runs a batch-mutating POST, reporting a toast on rejection instead of an unhandled promise. */
  async function postVaultBatch(path: string, body: Record<string, unknown> | undefined, failureMessage: string): Promise<{ status: number; body: unknown } | null> {
    try {
      return await postVault(path, body);
    } catch (error) {
      toast.error(`${failureMessage}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  const handleConfirm = async () => {
    if (!batch) return;
    const deletableVaultIds = batch.entries.filter((entry) => entry.verification === 'verified').map((entry) => entry.vaultId);
    const result = await postVaultBatch('eviction-batch/confirm', { fingerprint: batch.fingerprint, deletableVaultIds }, 'Failed to delete the pending transcripts');
    if (!result) return;
    const { status: httpStatus, body } = result;
    if (httpStatus === 409) {
      const refused = body as ConfirmRefused;
      if (refused.code === 'batch-changed') {
        toast.warning('The batch changed since it was shown. Review it again.');
        refetchBatch();
        return;
      }
      toast.error(refused.error);
      return;
    }
    if (httpStatus !== 200) {
      toast.error('Failed to delete the pending transcripts.');
      return;
    }
    const success = body as ConfirmSuccess;
    const lines = [`Deleted ${success.deleted.length} transcript(s), freed ${formatBytes(success.bytesFreed)}`];
    for (const skipped of success.skipped) lines.push(`Skipped ${skipped.nativePath}: ${skipped.reason}`);
    toast.success(lines.join('\n'));
    refetchBatch();
  };

  const handleDecline = async (vaultId: string) => {
    const result = await postVaultBatch('eviction-batch/decline', { vaultId }, 'Failed to decline the transcript');
    if (!result) return;
    if (result.status !== 200) {
      toast.error('Failed to decline the transcript.');
      return;
    }
    if (result.body) queryClient.setQueryData(BATCH_QUERY_KEY, result.body);
  };

  const handleClear = async () => {
    const result = await postVaultBatch('eviction-batch/clear', undefined, 'Failed to clear the batch');
    if (!result) return;
    if (result.status !== 200) {
      toast.error('Failed to clear the batch.');
      return;
    }
    if (result.body) queryClient.setQueryData(BATCH_QUERY_KEY, result.body);
  };

  const handleReoffer = async (vaultId: string) => {
    const result = await postVaultBatch('eviction-batch/reoffer', { vaultId }, 'Failed to re-offer the transcript');
    if (!result) return;
    if (result.status !== 200) {
      toast.error('Failed to re-offer the transcript.');
      return;
    }
    if (result.body) queryClient.setQueryData(BATCH_QUERY_KEY, result.body);
  };

  return (
    <SettingsSection id="session-vault" title="Session Vault" description="Cross-machine conversation backup">
      {statusError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          Failed to load vault status: {statusError instanceof Error ? statusError.message : String(statusError)}
        </div>
      ) : (
        status && <VaultStatusBlock status={status} onChanged={handleVaultChanged} onCreated={setShownOnce} />
      )}
      {vaultNotice && <p data-testid="vault-notice" className="mt-2 text-xs text-muted-foreground">{vaultNotice.message}</p>}
      {shownOnce && <RecoveryDialog secrets={shownOnce} onDone={handleRecoveryDone} />}

      {status && status.state !== 'off' && (
        <div className="mt-6 space-y-6">
          <div>
            <h3 className="text-foreground text-sm font-medium mb-2">Machines</h3>
            <MachinesTable machines={status.machines} />
          </div>

          <div>
            <h3 className="text-foreground text-sm font-medium mb-2">Pending deletion</h3>
            {batchError ? (
              <p className="text-xs text-destructive">Failed to load the pending-deletion batch: {batchError instanceof Error ? batchError.message : String(batchError)}</p>
            ) : !batch ? null : !batch.evict ? (
              <p className="text-xs text-muted-foreground">
                Eviction is off. Set &quot;evict&quot;: true in ~/.overdeck/vault/config.json to review transcripts the vault holds.
              </p>
            ) : (
              <div className="space-y-3">
                {batch.entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing is eligible for deletion.</p>
                ) : (
                  <table className="w-full text-xs">
                    <tbody>
                      {batch.entries.map((entry) => (
                        <tr key={entry.vaultId}>
                          <td className="py-1 pr-3 text-foreground">{entry.title}</td>
                          <td className="py-1 pr-3 text-muted-foreground">{entry.harness}</td>
                          <td className="py-1 pr-3 font-mono text-muted-foreground">{entry.nativePath}</td>
                          <td className="py-1 pr-3 text-muted-foreground">{formatBytes(entry.sizeBytes)}</td>
                          <td className="py-1 pr-3">
                            {entry.verification === 'verified' ? (
                              <span className="text-muted-foreground">verified</span>
                            ) : (
                              <span className="text-destructive">failed: {entry.reason}</span>
                            )}
                          </td>
                          <td className="py-1">
                            <button
                              type="button"
                              onClick={() => void handleDecline(entry.vaultId)}
                              className="text-xs px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted/50"
                            >
                              Decline
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-xs text-muted-foreground">Total: {formatBytes(batch.totalBytes)}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={batch.deletableCount === 0}
                    onClick={() => void handleConfirm()}
                    className="text-xs px-2 py-1 rounded-md border border-border bg-background hover:bg-muted/50 disabled:opacity-50"
                  >
                    Yes, delete these ({batch.deletableCount} files, {formatBytes(batch.deletableBytes)})
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleClear()}
                    className="text-xs px-2 py-1 rounded-md border border-border bg-background hover:bg-muted/50"
                  >
                    Clear batch
                  </button>
                </div>
                {batch.declined.length > 0 && (
                  <div>
                    <h4 className="text-foreground text-xs font-medium mb-1">Declined</h4>
                    <ul className="space-y-1">
                      {batch.declined.map((entry) => (
                        <li key={entry.vaultId} className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono text-muted-foreground">{entry.nativePath}</span>
                          <button
                            type="button"
                            onClick={() => void handleReoffer(entry.vaultId)}
                            className="px-2 py-0.5 rounded-md border border-border bg-background hover:bg-muted/50"
                          >
                            Re-offer
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
