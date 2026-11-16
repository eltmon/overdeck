import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../lib/wsTransport';
import { useAddProjectDialog } from '../project/new/addProjectDialogStore';
import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';

/**
 * PAN-4437: "Continue here" for a Session Vault browse copy. Reads the
 * write-free preview (where the conversation would run, what happens to the
 * code snapshot, any drift), then POSTs the continue with the owner token the
 * preview showed, so a conversation another machine took over in the
 * meantime is reported instead of taken. A machine with no checkout is
 * offered the Add-project dialog in clone mode with the URL filled in; this
 * dialog steps aside while that one is open and re-reads the preview after a
 * create.
 */

export interface ContinuePreview {
  vaultId: string;
  title: string;
  harness: string;
  resumable: boolean;
  ownerLabel: string;
  ownerToken: string;
  ownedHere: boolean;
  target: null | { cwd: string; source: 'saved-cwd' | 'project'; projectKey: string | null; dirty: boolean; isGit: boolean };
  noTargetReason: null | 'clone-offered' | 'no-checkout';
  clone: null | { url: string; slug: string | null };
  wip: { kind: 'none' } | { kind: 'skipped'; reason: string } | { kind: 'captured'; at: string; bytes: number; branch: string | null; base: string };
  codePlacement: 'in-place' | 'new-workspace' | 'none';
  drift: string[];
  savedCwd: string;
}

interface ContinueError {
  code?: string;
  error?: string;
  label?: string;
  fields?: string[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function previewUrl(vaultId: string): string {
  return `/api/vault/sessions/${encodeURIComponent(vaultId)}/continue-preview`;
}

async function fetchPreview(vaultId: string): Promise<ContinuePreview> {
  const res = await fetch(previewUrl(vaultId));
  const data = (await res.json().catch(() => null)) as (ContinuePreview & ContinueError) | null;
  if (!res.ok) throw new Error(data?.error || 'Could not load the saved conversation.');
  return data as ContinuePreview;
}

export function VaultContinueDialog({ vaultId, onClose, onContinued }: {
  vaultId: string;
  onClose: () => void;
  onContinued: (conversationName: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: preview, error: loadError, isLoading, refetch } = useQuery({
    queryKey: ['vault-continue-preview', vaultId],
    queryFn: () => fetchPreview(vaultId),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driftOverride, setDriftOverride] = useState<string[] | null>(null);
  const addProjectOpen = useAddProjectDialog((state) => state.open);

  const submit = async (onDrift?: 'continue' | 'note') => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await ensureDashboardSession();
      const res = await fetch(`/api/vault/sessions/${encodeURIComponent(vaultId)}/continue`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ expectedOwnerToken: preview.ownerToken, ...(onDrift ? { onDrift } : {}) }),
      });
      const data = (await res.json().catch(() => null)) as (ContinueError & { conversation?: { name: string } }) | null;
      if (res.ok && data?.conversation) {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        onContinued(data.conversation.name);
        onClose();
        return;
      }
      if (data?.code === 'already-continued') setError(`Already continued on ${data.label}.`);
      else if (data?.code === 'drift' && data.fields) setDriftOverride(data.fields);
      else setError(data?.error || 'Could not continue the conversation.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openClone = (url: string) => {
    useAddProjectDialog.getState().show('clone', undefined, { initialUrl: url, onCreated: () => { void refetch(); } });
  };

  const id8 = vaultId.slice(0, 8);
  const drift = driftOverride ?? preview?.drift ?? [];
  let body: ReactNode = null;
  let actions: ReactNode = <button type="button" className={formStyles.button} onClick={onClose}>Close</button>;

  if (isLoading) {
    body = <div className={formStyles.status}><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>;
  } else if (loadError || !preview) {
    body = <div role="alert" className={formStyles.error}>{loadError instanceof Error ? loadError.message : 'Could not load the saved conversation.'}</div>;
  } else if (!preview.resumable) {
    body = <p className={formStyles.text}>{`${preview.harness} has no native resume. Run: pan vault resume ${id8}`}</p>;
  } else if (preview.noTargetReason === 'clone-offered' && preview.clone) {
    const slug = preview.clone.slug ?? preview.clone.url;
    const cloneUrl = preview.clone.url;
    body = <p className={formStyles.text}>{`No registered project matches ${slug}.`}</p>;
    actions = (
      <>
        <button type="button" className={formStyles.primaryButton} onClick={() => openClone(cloneUrl)}>{`Clone and register ${slug}`}</button>
        <button type="button" className={formStyles.button} onClick={onClose}>Cancel</button>
      </>
    );
  } else if (!preview.target) {
    body = <p className={formStyles.text}>{`The saved working directory ${preview.savedCwd || '(none)'} does not exist here and the record has no git origin. Run: pan vault resume ${id8} --cwd <dir>`}</p>;
  } else {
    const { target, wip } = preview;
    let codeLine: string | null = null;
    if (wip.kind === 'captured' && preview.codePlacement === 'in-place') {
      codeLine = `Apply the code snapshot from ${wip.at} (${formatSize(wip.bytes)}) here. Branch: ${wip.branch ?? `detached at ${wip.base.slice(0, 12)}`}.`;
    } else if (wip.kind === 'captured' && preview.codePlacement === 'new-workspace' && target.projectKey === null) {
      // The server refuses this unless the checkout already holds the snapshot (dirty-unregistered).
      codeLine = `${target.cwd} has uncommitted changes and is not a registered project, so no workspace can be created for the code snapshot. Commit or move the changes, or run: pan vault resume ${id8} --worktree <dir>`;
    } else if (wip.kind === 'captured' && preview.codePlacement === 'new-workspace') {
      codeLine = `${target.cwd} has uncommitted changes, so the code snapshot from ${wip.at} goes into a new workspace.`;
    } else if (wip.kind === 'skipped' && !/^(clean|no-git)\b/.test(wip.reason)) {
      // Like `pan vault resume`: a clean checkout or a non-git cwd is not worth a line.
      codeLine = `No code snapshot: skipped (${wip.reason}).`;
    }
    body = (
      <>
        <p className={formStyles.text}>Continue in <code className={formStyles.mono}>{target.cwd}</code></p>
        {codeLine && <p className={formStyles.text}>{codeLine}</p>}
        {drift.length > 0 && <p className={formStyles.text}>{`The working directory differs from where this conversation was saved: ${drift.join(', ')}.`}</p>}
      </>
    );
    actions = drift.length > 0 ? (
      <>
        <button type="button" className={formStyles.primaryButton} disabled={busy} onClick={() => { void submit('continue'); }}>Continue</button>
        <button type="button" className={formStyles.button} disabled={busy} onClick={() => { void submit('note'); }}>Continue with a note</button>
        <button type="button" className={formStyles.button} disabled={busy} onClick={onClose}>Cancel</button>
      </>
    ) : (
      <>
        <button type="button" className={formStyles.primaryButton} disabled={busy} onClick={() => { void submit(); }}>Continue here</button>
        <button type="button" className={formStyles.button} disabled={busy} onClick={onClose}>Cancel</button>
      </>
    );
  }

  if (addProjectOpen) return null;

  return (
    <Modal
      title={preview ? `Continue “${preview.title}”` : 'Continue here'}
      ariaLabel="Continue here"
      onClose={onClose}
      dismissible={!busy}
    >
      {/* The actions stay inside the test id wrapper: pan-4437-continue-here.spec.ts scopes its button queries to it. */}
      <div className={`${formStyles.content} flex flex-col gap-2`} data-testid="vault-continue-dialog">
        {preview && <p className={formStyles.hint}>{`Saved on ${preview.ownerLabel}.`}</p>}
        {body}
        {error && <div role="alert" className={formStyles.error}>{error}</div>}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin self-center text-muted-foreground" />}
          {actions}
        </div>
      </div>
    </Modal>
  );
}
