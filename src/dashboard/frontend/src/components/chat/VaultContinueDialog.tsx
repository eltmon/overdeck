import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../lib/wsTransport';
import { useAddProjectDialog } from '../project/new/addProjectDialogStore';

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
  return `/api/vault/records/${encodeURIComponent(vaultId)}/continue-preview`;
}

async function fetchPreview(vaultId: string): Promise<ContinuePreview> {
  const res = await fetch(previewUrl(vaultId));
  const data = (await res.json().catch(() => null)) as (ContinuePreview & ContinueError) | null;
  if (!res.ok) throw new Error(data?.error || 'Could not load the saved conversation.');
  return data as ContinuePreview;
}

const BUTTON = 'rounded-[var(--radius-sm)] border border-border px-3 py-1 text-[12px] hover:bg-accent disabled:opacity-50';

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

  useEffect(() => {
    if (addProjectOpen) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addProjectOpen, busy, onClose]);

  const submit = async (onDrift?: 'continue' | 'note') => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await ensureDashboardSession();
      const res = await fetch(`/api/vault/records/${encodeURIComponent(vaultId)}/continue`, {
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
  let actions: ReactNode = <button type="button" className={BUTTON} onClick={onClose}>Close</button>;

  if (isLoading) {
    body = <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>;
  } else if (loadError || !preview) {
    body = <div role="alert">{loadError instanceof Error ? loadError.message : 'Could not load the saved conversation.'}</div>;
  } else if (!preview.resumable) {
    body = <p>{`${preview.harness} has no native resume. Run: pan vault resume ${id8}`}</p>;
  } else if (preview.noTargetReason === 'clone-offered' && preview.clone) {
    const slug = preview.clone.slug ?? preview.clone.url;
    const cloneUrl = preview.clone.url;
    body = <p>{`No registered project matches ${slug}.`}</p>;
    actions = (
      <>
        <button type="button" className={BUTTON} onClick={() => openClone(cloneUrl)}>{`Clone and register ${slug}`}</button>
        <button type="button" className={BUTTON} onClick={onClose}>Cancel</button>
      </>
    );
  } else if (!preview.target) {
    body = <p>{`The saved working directory ${preview.savedCwd || '(none)'} does not exist here and the record has no git origin. Run: pan vault resume ${id8} --cwd <dir>`}</p>;
  } else {
    const { target, wip } = preview;
    let codeLine: string | null = null;
    if (wip.kind === 'captured' && preview.codePlacement === 'in-place') {
      codeLine = `Apply the code snapshot from ${wip.at} (${formatSize(wip.bytes)}) here. Branch: ${wip.branch ?? `detached at ${wip.base.slice(0, 12)}`}.`;
    } else if (wip.kind === 'captured' && preview.codePlacement === 'new-workspace') {
      codeLine = `${target.cwd} has uncommitted changes, so the code snapshot from ${wip.at} goes into a new workspace.`;
    } else if (wip.kind === 'skipped' && !/^(clean|no-git)\b/.test(wip.reason)) {
      // Like `pan vault resume`: a clean checkout or a non-git cwd is not worth a line.
      codeLine = `No code snapshot: skipped (${wip.reason}).`;
    }
    body = (
      <>
        <p>Continue in <code>{target.cwd}</code></p>
        {codeLine && <p>{codeLine}</p>}
        {drift.length > 0 && <p>{`The working directory differs from where this conversation was saved: ${drift.join(', ')}.`}</p>}
      </>
    );
    actions = drift.length > 0 ? (
      <>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => { void submit('continue'); }}>Continue</button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => { void submit('note'); }}>Continue with a note</button>
        <button type="button" className={BUTTON} disabled={busy} onClick={onClose}>Cancel</button>
      </>
    ) : (
      <>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => { void submit(); }}>Continue here</button>
        <button type="button" className={BUTTON} disabled={busy} onClick={onClose}>Cancel</button>
      </>
    );
  }

  if (addProjectOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/32 backdrop-blur-sm" onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Continue here"
        data-testid="vault-continue-dialog"
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{preview ? `Continue “${preview.title}”` : 'Continue here'}</h2>
          <button type="button" className="rounded-[var(--radius-sm)] p-1 text-muted-foreground hover:bg-accent" onClick={onClose} aria-label="Close" disabled={busy}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4 text-[12px]">
          {preview && <p className="text-muted-foreground">{`Saved on ${preview.ownerLabel}.`}</p>}
          {body}
          {error && <div role="alert" className="text-destructive-foreground">{error}</div>}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin self-center text-muted-foreground" />}
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
