/**
 * Settings → Anywhere → Directory (PAN-2356 WI-15, FR-20): the account's machines as the
 * overdeck.ai directory lists them, two-screen approvals in both directions, and removing a machine
 * from the directory. Polls `GET /api/directory` every 5 s while mounted, like MachinesPanel.
 *
 * Badge tones follow the style guide: an online machine uses the machine-working blue (`--info`),
 * never green; offline stays neutral.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import { apiError, isOk } from './anywhereApi';
import { ApprovalDialog } from './ApprovalDialog';
import {
  acceptJoin,
  approveApproval,
  DIRECTORY_QUERY_KEY,
  type DirectoryApprovalView,
  type DirectoryJoinView,
  type DirectoryMachineView,
  forgetDirectoryMachine,
  joinDirectory,
  loadDirectory,
  openApproval,
  rejectApproval,
  rejectJoin,
} from './directoryApi';
import { loadMachines, MACHINES_QUERY_KEY } from './machinesApi';

export const SIGNED_OUT_TEXT = 'to find your machines through overdeck.ai.';

const buttonClass = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50';
const destructiveButtonClass = 'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50';
const onlineBadge = 'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium bg-info/8 border-info/32 text-info-foreground';

type Dialog =
  | { mode: 'approve'; approval: DirectoryApprovalView }
  | { mode: 'accept'; join: DirectoryJoinView; label: string };

function DirectoryMachineRow({
  machine,
  isSelf,
  onJoin,
  onForget,
  busy,
}: {
  machine: DirectoryMachineView;
  isSelf: boolean;
  onJoin: () => void;
  onForget: () => void;
  busy: boolean;
}) {
  return (
    <li data-testid={`directory-machine-${machine.environmentId}`} className="flex items-start justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{machine.label}</span>
          {machine.online ? <span className={onlineBadge}>Online</span> : null}
          {isSelf ? <span className="text-xs text-muted-foreground">this machine</span> : null}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          <span className="font-mono">{machine.fingerprint}</span>
          {machine.online ? null : <>{' · '}last seen {formatRelativeTime(machine.lastSeenAt)}</>}
        </p>
      </div>
      {!isSelf && (
        <div className="flex items-center gap-2 shrink-0">
          {machine.linked ? (
            <span className="text-xs text-muted-foreground">Linked</span>
          ) : (
            <button type="button" disabled={busy} onClick={onJoin} className={buttonClass}>
              Link
            </button>
          )}
          <button type="button" disabled={busy} onClick={onForget} className={destructiveButtonClass}>
            Remove from directory
          </button>
        </div>
      )}
    </li>
  );
}

export function DirectoryPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [openedSas, setOpenedSas] = useState<{ requestId: string; sas: string; fingerprint: string } | null>(null);
  const { data, error, isLoading } = useQuery({ queryKey: DIRECTORY_QUERY_KEY, queryFn: loadDirectory, refetchInterval: 5000 });
  const { data: machines } = useQuery({ queryKey: MACHINES_QUERY_KEY, queryFn: loadMachines, refetchInterval: 5000 });
  const selfId = machines?.self.environmentId ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: DIRECTORY_QUERY_KEY });

  const run = async <T,>(action: () => Promise<{ status: number; body: T | { error?: string } | null }>, failure: string): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await action();
      if (!isOk(result)) {
        toast.error(`${failure}: ${apiError(result)}`);
        return false;
      }
      return true;
    } catch (err) {
      toast.error(`${failure}: ${(err as Error).message}`);
      return false;
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const handleForget = async (machine: DirectoryMachineView) => {
    const confirmed = await confirm({
      title: `Remove ${machine.label} from the directory?`,
      message: `${machine.label} leaves this account's overdeck.ai directory and frees its slot. Links that already exist keep working over their other routes.`,
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!confirmed) return;
    await run(() => forgetDirectoryMachine(machine.environmentId), `Could not remove ${machine.label}`);
  };

  const reviewApproval = async (approval: DirectoryApprovalView) => {
    setDialogError(null);
    setDialog({ mode: 'approve', approval });
    if (approval.sas) return;
    try {
      const result = await openApproval(approval.requestId);
      if (!isOk(result)) {
        setDialogError(apiError(result));
        return;
      }
      setOpenedSas({ requestId: approval.requestId, ...result.body });
    } catch (err) {
      setDialogError((err as Error).message);
    } finally {
      await refresh();
    }
  };

  const closeDialog = () => {
    setDialog(null);
    setDialogError(null);
    setOpenedSas(null);
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const ok = dialog.mode === 'approve'
      ? await run(() => approveApproval(dialog.approval.requestId), 'Could not approve')
      : await run(() => acceptJoin(dialog.join.requestId), 'Could not accept');
    if (ok) closeDialog();
  };

  const rejectDialog = async () => {
    if (!dialog) return;
    if (dialog.mode === 'approve') await run(() => rejectApproval(dialog.approval.requestId), 'Could not reject');
    else await run(() => rejectJoin(dialog.join.requestId), 'Could not reject');
    closeDialog();
  };

  const labelOf = (environmentId: string | null) =>
    (environmentId && data?.machines.find((m) => m.environmentId === environmentId)?.label) ?? 'another machine';

  let body;
  if (isLoading) {
    body = <p className="text-xs text-muted-foreground px-4 py-3">Loading the directory…</p>;
  } else if (error || !data) {
    body = <p className="text-xs text-destructive px-4 py-3">Could not load the directory: {(error as Error | null)?.message ?? 'no answer'}</p>;
  } else if (!data.signedIn) {
    body = (
      <p data-testid="directory-signed-out" className="text-xs text-muted-foreground px-4 py-3">
        Sign in with <span className="font-mono">pan account login</span> {SIGNED_OUT_TEXT}
      </p>
    );
  } else {
    body = (
      <>
        {data.state === 'refused' && data.refusal && (
          <p data-testid="directory-refusal" className="text-xs text-warning-foreground px-4 py-2">{data.refusal}</p>
        )}
        {data.state === 'connecting' && <p className="text-xs text-muted-foreground px-4 py-2">Connecting to the directory…</p>}

        {data.approvals.length > 0 && (
          <ul className="space-y-1 mb-2">
            {data.approvals.map((approval) => (
              <li key={approval.requestId} data-testid={`directory-approval-${approval.requestId}`} className="flex items-start justify-between gap-4 px-4 py-3 rounded-lg bg-muted/20">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{approval.label} asks to link with this machine</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {approval.state === 'approving' ? 'Waiting for the other machine to accept…' : null}
                    {approval.state === 'failed' ? approval.error : null}
                    {approval.state === 'pending' || approval.state === 'open' ? <>expires {formatRelativeTime(new Date(approval.expiresAt).toISOString())}</> : null}
                  </p>
                </div>
                {(approval.state === 'pending' || approval.state === 'open') && (
                  <button type="button" disabled={busy} onClick={() => void reviewApproval(approval)} className={buttonClass}>
                    Review
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {data.joins.length > 0 && (
          <ul className="space-y-1 mb-2">
            {data.joins.map((join) => (
              <li key={join.requestId} data-testid={`directory-join-${join.requestId}`} className="flex items-start justify-between gap-4 px-4 py-3 rounded-lg bg-muted/20">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">Link request to {join.to ? labelOf(join.to) : 'your machines'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {join.state === 'waiting' && 'Waiting for approval'}
                    {join.state === 'open' && 'Another machine opened the request; compare the codes'}
                    {join.state === 'accepted' && 'Accepted; finishing the link…'}
                    {join.state === 'rejected' && 'Rejected'}
                  </p>
                </div>
                {join.state === 'open' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDialogError(null);
                      setDialog({ mode: 'accept', join, label: join.to ? labelOf(join.to) : 'the other machine' });
                    }}
                    className={buttonClass}
                  >
                    Review
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {data.machines.length === 0 ? (
          <p className="text-xs text-muted-foreground px-4 py-3">The directory lists no machines yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.machines.map((machine) => (
              <DirectoryMachineRow
                key={machine.environmentId}
                machine={machine}
                isSelf={machine.environmentId === selfId}
                busy={busy}
                onJoin={() => void run(() => joinDirectory(machine.environmentId), `Could not ask ${machine.label}`)}
                onForget={() => void handleForget(machine)}
              />
            ))}
          </ul>
        )}
      </>
    );
  }

  const dialogSas = dialog?.mode === 'approve'
    ? (dialog.approval.sas ?? (openedSas?.requestId === dialog.approval.requestId ? openedSas.sas : null))
    : dialog?.join.sas ?? null;
  const dialogFingerprint = dialog?.mode === 'approve'
    ? (openedSas?.requestId === dialog.approval.requestId ? openedSas.fingerprint : dialog.approval.fingerprint)
    : dialog?.join.fingerprint ?? null;

  return (
    <div data-component="anywhere-directory-panel" data-testid="directory-panel">
      <div className="flex items-center justify-between gap-4 mb-2">
        <h3 className="text-sm font-medium text-foreground">Directory</h3>
      </div>
      {body}
      {dialog && (
        <ApprovalDialog
          mode={dialog.mode}
          label={dialog.mode === 'approve' ? dialog.approval.label : dialog.label}
          sas={dialogSas}
          fingerprint={dialogFingerprint}
          busy={busy}
          error={dialogError}
          onConfirm={() => void confirmDialog()}
          onReject={() => void rejectDialog()}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
