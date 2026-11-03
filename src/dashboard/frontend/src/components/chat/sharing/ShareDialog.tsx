/**
 * The share dialog and its "Share this conversation" menu item (PAN-4473 WI-8, FR-7, FR-8).
 *
 * `openShareDialog(target)` opens the dialog; one `ShareDialogHost` is mounted at the app root.
 * Without a share the dialog offers **Create link**. With one it shows the join link with **Copy**,
 * the host socket's connection state, the lobby panel and **End share**. A machine with no
 * overdeck.ai sign-in gets a signed-out panel naming `pan account login`.
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
import { createShare, endShare, sendShareCommand, ShareApiError, SHARES_QUERY_KEY, useShares } from './shareApi';
import { SharingLobbyPanel } from './SharingLobbyPanel';

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

function ConnectionLine({ share }: { share: ShareView }) {
  if (share.connection === 'disconnected') {
    return (
      <p className="rounded-md border border-warning/32 bg-warning/8 px-2 py-1 text-xs text-warning-foreground" data-connection="disconnected">
        Disconnected from the share service. End this share and create a new link.
      </p>
    );
  }
  const text =
    share.connection === 'connected' ? 'Connected'
      : share.connection === 'reconnecting' ? 'Reconnecting to the share service…'
        : 'Connecting to the share service…';
  return (
    <p className="text-xs text-muted-foreground" data-connection={share.connection}>
      {text}
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
