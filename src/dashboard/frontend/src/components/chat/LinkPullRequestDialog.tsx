import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitPullRequest, Loader2, RefreshCw, X } from 'lucide-react';
import type { ConversationPullRequests, PullRequestLink } from '@overdeck/contracts';
import { PullRequestBadge } from '../primitives/PullRequestBadge';

/**
 * PAN-3822: the "Pull requests" dialog for one conversation. Lists every link
 * with why it exists (manual, agent, created, branch-detected, or unlinked),
 * links a new PR from a URL, `#42`, or `owner/repo#42`, unlinks or relinks a
 * PR, and forces a status refresh. Opened from any conversation action menu
 * via `openPullRequestsDialog(name)`; one host is mounted at the app root so
 * the dialog outlives the menu that opened it.
 */

interface PullRequestsDialogStore {
  conversationName: string | null;
  open: (conversationName: string) => void;
  close: () => void;
}

export const usePullRequestsDialogStore = create<PullRequestsDialogStore>((set) => ({
  conversationName: null,
  open: (conversationName) => set({ conversationName }),
  close: () => set({ conversationName: null }),
}));

export function openPullRequestsDialog(conversationName: string): void {
  usePullRequestsDialogStore.getState().open(conversationName);
}

const SOURCE_LABEL: Record<PullRequestLink['source'], string> = {
  manual: 'manual',
  agent: 'agent',
  created: 'created',
  branch: 'branch-detected',
};

function linksUrl(name: string): string {
  return `/api/conversations/${encodeURIComponent(name)}/pull-requests`;
}

async function readJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error || fallbackError);
  return data as T;
}

export function LinkPullRequestDialogHost() {
  const conversationName = usePullRequestsDialogStore((s) => s.conversationName);
  const close = usePullRequestsDialogStore((s) => s.close);
  if (!conversationName) return null;
  return <LinkPullRequestDialog conversationName={conversationName} onClose={close} />;
}

export function LinkPullRequestDialog({ conversationName, onClose }: { conversationName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const queryKey = ['conversation-pull-requests', conversationName];
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => readJson<ConversationPullRequests>(await fetch(linksUrl(conversationName)), 'Failed to load pull requests'),
  });

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const link = async (ref: string) => run(async () => readJson(await fetch(linksUrl(conversationName), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref }),
  }), 'Failed to link pull request'));

  const submit = async () => {
    const ref = draft.trim();
    if (ref && await link(ref)) setDraft('');
  };
  const unlink = (url: string) => run(async () => readJson(
    await fetch(`${linksUrl(conversationName)}?ref=${encodeURIComponent(url)}`, { method: 'DELETE' }),
    'Failed to unlink pull request',
  ));
  const refresh = () => run(async () => readJson(
    await fetch(`${linksUrl(conversationName)}/sync`, { method: 'POST' }),
    'Failed to refresh pull requests',
  ));

  const links = data?.links ?? [];
  const effective = data?.effective ?? null;
  const isEffective = (l: PullRequestLink) => effective !== null
    && l.host === effective.host && l.repository === effective.repository && l.number === effective.number;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/32 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pull requests"
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <GitPullRequest className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="flex-1 text-sm font-medium">Pull requests</h2>
          <button
            type="button"
            className="rounded-[var(--radius-sm)] p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
            onClick={() => { void refresh(); }}
            disabled={busy || links.length === 0}
            aria-label="Refresh pull request status"
            title="Refresh pull request status"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded-[var(--radius-sm)] p-1 text-muted-foreground hover:bg-accent" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            <input
              ref={inputRef}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-[12px]"
              value={draft}
              placeholder="Pull request URL or #42"
              aria-label="Pull request URL or #42"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-[var(--radius-sm)] border border-border px-3 py-1 text-[12px] hover:bg-accent disabled:opacity-50"
              disabled={busy || !draft.trim()}
            >
              Link
            </button>
          </form>
          {error && <div role="alert" className="text-[12px] text-destructive-foreground">{error}</div>}

          {isLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : links.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">No pull requests linked yet.</div>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label="Linked pull requests">
              {links.map((l) => (
                <li key={`${l.host}/${l.repository}#${l.number}`} className="flex items-center gap-2 text-[12px]">
                  <PullRequestBadge link={l} />
                  <span className="min-w-0 flex-1 truncate" title={l.snapshot?.title ?? l.url}>
                    {l.snapshot?.title || `${l.repository}#${l.number}`}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {l.dismissedAt ? 'unlinked' : SOURCE_LABEL[l.source]}{isEffective(l) ? ' · shown' : ''}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50"
                    disabled={busy}
                    onClick={() => { void (l.dismissedAt ? link(l.url) : unlink(l.url)); }}
                    aria-label={`${l.dismissedAt ? 'Relink' : 'Unlink'} #${l.number}`}
                  >
                    {l.dismissedAt ? 'Relink' : 'Unlink'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
