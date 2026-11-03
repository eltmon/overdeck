/**
 * The share dialog and its "Share this conversation" menu item (PAN-4473 WI-8, FR-7, FR-8).
 *
 * `openShareDialog(target)` opens the dialog; one `ShareDialogHost` is mounted at the app root.
 * Without a share the dialog offers **Create link**. With one it shows the join link with **Copy**,
 * the host socket's connection state, the lobby panel and **End share**. A machine with no
 * overdeck.ai sign-in gets a signed-out panel naming `pan account login`.
 *
 * Prompts (PAN-4476 WI-14, D-2): under the lobby the dialog shows the queue line, the queued prompts
 * and the viewers' drafts as a controller-mode `SuggestionList`. **Use** → edit → **Send** posts the
 * text to `POST /api/shares/:code/prompts` with the draft's author, so the prompt joins the queue.
 * While a viewer controls (PAN-4478 WI-8), the suggestions are read-only until the host reclaims.
 *
 * The share list is polled once a second while the dialog is open (D-6). **End share** asks for
 * confirmation inside this dialog rather than through `useConfirm()`: the confirm dialog renders
 * inside the app root, under this portaled Modal and outside its focus trap.
 */
import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { ShareCommand, ShareView } from '@overdeck/contracts';

import type { Conversation } from '../../CommandDeck/ConversationList';
import { MenuItemButton } from '../../shared/ContextMenu';
import { Modal } from '../../shared/Modal';
import { runsHere } from '../conversationMachineState';
import { createShare, endShare, sendShareCommand, sendSharePrompt, ShareApiError, SHARES_QUERY_KEY, useShares } from './shareApi';
import { SharingLobbyPanel } from './SharingLobbyPanel';
import { queueStatusText, SuggestionList, type SuggestionItem } from './SuggestionList';

export interface ShareTarget {
  /** The local conversation name. */
  name: string;
  title?: string;
}

interface ShareDialogStore {
  target: ShareTarget | null;
  open: (target: ShareTarget) => void;
  close: () => void;
}

export const useShareDialogStore = create<ShareDialogStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export function openShareDialog(target: ShareTarget): void {
  useShareDialogStore.getState().open(target);
}

export function ShareDialogHost() {
  const target = useShareDialogStore((s) => s.target);
  const close = useShareDialogStore((s) => s.close);
  if (!target) return null;
  return <ShareDialog key={target.name} target={target} onClose={close} />;
}

/** The ⋮ menu item; renders nothing for a conversation this machine does not run. */
export function ShareConversationMenuItem({ conversation, onDone }: { conversation: Conversation; onDone?: () => void }) {
  if (!runsHere(conversation)) return null;
  return (
    <MenuItemButton onClick={() => { openShareDialog({ name: conversation.name, title: conversation.title ?? undefined }); onDone?.(); }}>
      <Users size={14} />
      Share this conversation
    </MenuItemButton>
  );
}

const BUTTON =
  'rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON =
  'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';
const DESTRUCTIVE_BUTTON =
  'rounded-md border border-destructive/32 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/8 disabled:cursor-not-allowed disabled:opacity-50';

const END_SHARE_QUESTION = 'End this share? Everyone in the room and the lobby is disconnected and the link stops working.';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PROMPT_ERRORS: Record<string, string> = {
  invalid_prompt: 'Prompts cannot be empty or start with /, ! or #.',
  too_long: 'Prompts can be at most 8,000 characters.',
  queue_full: 'The queue is full. Try again later.',
  share_not_live: 'This share is not live.',
  not_controller: 'Someone else has control. Reclaim control first.',
};

/** True unless the share's effective controller is known and is not the data owner (PAN-4478). */
function ownerControls(share: ShareView): boolean {
  const controller = share.controllerGithubId ?? share.snapshot?.controllerGithubId;
  const owner = share.snapshot?.dataOwner.githubId;
  return controller === undefined || owner === undefined || controller === owner;
}

/** The queue line and the queued prompts, read-only (FR-10). Renders nothing for an idle, empty queue. */
function QueuePanel({ share }: { share: ShareView }) {
  const queue = share.queue;
  if (!queue) return null;
  const line = queueStatusText({ agentWorking: queue.agentWorking, queued: queue.items.length - (queue.delivering ? 1 : 0) });
  if (!line && queue.items.length === 0) return null;
  const owner = share.snapshot?.dataOwner.login;
  return (
    <section data-component="share-queue">
      {line ? <p role="status" className="text-xs text-muted-foreground">{line}</p> : null}
      {queue.items.length > 0 ? (
        <ul className="mt-1">
          {queue.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-0.5">
              {item.avatarUrl ? <img src={item.avatarUrl} alt="" width={16} height={16} className="h-4 w-4 shrink-0 rounded-sm" /> : null}
              <span className="shrink-0 font-mono text-xs">{item.login ? `@${item.login}` : 'host'}</span>
              {item.source === 'controller' && item.login && item.login !== owner ? (
                <span className="shrink-0 text-[11px] text-muted-foreground">suggested</span>
              ) : null}
              <span className="min-w-0 truncate text-xs text-muted-foreground">{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ConnectionLine({ share }: { share: ShareView }) {
  if (share.connection === 'disconnected') {
    return (
      <p className="rounded-md border border-warning/32 bg-warning/8 px-2 py-1 text-xs text-warning-foreground" data-connection="disconnected">
        Disconnected from the share service. End this share and create a new link.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground" data-connection={share.connection}>
      {share.connection === 'connected' ? 'Connected' : 'Connecting to the share service…'}
    </p>
  );
}

export function ShareDialog({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const shares = useShares({ enabled: true });
  const share = shares.data?.find((s) => s.scope.kind === 'conversation' && s.scope.conversationId === target.name) ?? null;
  const [createError, setCreateError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SHARES_QUERY_KEY });

  const onCreate = async () => {
    setBusy(true);
    setCreateError(null);
    try {
      await createShare(target.name);
      await refresh();
    } catch (error) {
      setCreateError(error);
    } finally {
      setBusy(false);
    }
  };

  const onCommand = async (command: ShareCommand) => {
    if (!share) return;
    setBusy(true);
    try {
      await sendShareCommand(share.shortCode, command);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    if (!share) return;
    setBusy(true);
    try {
      await endShare(share.shortCode);
      setConfirmingEnd(false);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onSendSuggestion = async (item: SuggestionItem, text: string) => {
    if (!share) return;
    try {
      await sendSharePrompt(share.shortCode, { text, draftGithubId: item.githubId });
    } catch (error) {
      throw new Error(error instanceof ShareApiError ? PROMPT_ERRORS[error.error] ?? error.message : errorMessage(error));
    }
    toast.success('Queued');
    await refresh();
  };

  const onCopy = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.joinUrl);
      toast.success('Link copied');
    } catch (error) {
      toast.error(`Could not copy: ${errorMessage(error)}`);
    }
  };

  const signedOut = createError instanceof ShareApiError && createError.status === 412;
  const loading = shares.isLoading && !shares.data;

  let body: ReactNode;
  if (loading) {
    body = <p className="text-xs text-muted-foreground">Loading…</p>;
  } else if (share) {
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            readOnly
            aria-label="Join link"
            value={share.joinUrl}
            className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="button" className={BUTTON} onClick={() => void onCopy()}>
            <span className="inline-flex items-center gap-1"><Copy size={12} />Copy</span>
          </button>
        </div>
        <ConnectionLine share={share} />
        <SharingLobbyPanel share={share} onCommand={(command) => void onCommand(command)} pending={busy} />
        <QueuePanel share={share} />
        <SuggestionList
          items={(share.drafts ?? []).map((draft) => ({ githubId: draft.githubId, login: draft.login, avatarUrl: draft.avatarUrl, text: draft.text }))}
          mode={ownerControls(share) ? 'controller' : 'view'}
          onSend={onSendSuggestion}
        />
      </div>
    );
  } else if (signedOut) {
    body = (
      <div className="space-y-1 text-xs" data-component="share-signed-out">
        <p>Sign in to overdeck.ai to share conversations.</p>
        <p className="text-muted-foreground">Run <span className="font-mono text-foreground">pan account login</span> on this machine, then try again.</p>
      </div>
    );
  } else {
    body = <p className="text-xs">Create a link that people can use to ask to join. You admit each person.</p>;
  }

  const listError = shares.error && !shares.data ? errorMessage(shares.error) : null;
  const shownError = createError && !signedOut ? errorMessage(createError) : listError;
  const pinned = confirmingEnd && share
    ? <p className="text-xs">{END_SHARE_QUESTION}</p>
    : shownError
      ? <p role="alert" className="text-xs text-destructive">{shownError}</p>
      : null;

  let footer: ReactNode;
  if (share && confirmingEnd) {
    footer = (
      <>
        <button type="button" className={BUTTON} onClick={() => setConfirmingEnd(false)} disabled={busy}>Cancel</button>
        <button type="button" className={DESTRUCTIVE_BUTTON} aria-label="Confirm end share" onClick={() => void onEnd()} disabled={busy}>End share</button>
      </>
    );
  } else if (share) {
    footer = (
      <>
        <button type="button" className={DESTRUCTIVE_BUTTON} onClick={() => setConfirmingEnd(true)} disabled={busy}>End share</button>
        <button type="button" className={BUTTON} onClick={onClose}>Done</button>
      </>
    );
  } else {
    footer = (
      <>
        <button type="button" className={BUTTON} onClick={onClose}>Cancel</button>
        <button type="button" className={PRIMARY_BUTTON} onClick={() => void onCreate()} disabled={busy || loading}>Create link</button>
      </>
    );
  }

  return (
    <Modal title="Share conversation" description={target.title ?? target.name} onClose={onClose} pinned={pinned} footer={footer}>
      <div className="py-4">{body}</div>
    </Modal>
  );
}
