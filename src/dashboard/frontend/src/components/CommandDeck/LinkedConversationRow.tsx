/**
 * Conversation-list pieces for linked conversations (PAN-4650 WI-13, FR-5,
 * mockup flows a, b, l): the machine chip, the offline metadata that replaces
 * cost and model, the short ⋮ menu (a linked row cannot be renamed, archived,
 * moved or shared from here), and the list footer that brings hidden machines
 * back.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, EyeOff, MonitorSmartphone } from 'lucide-react';

import { loadMachines, MACHINES_QUERY_KEY, setMachineHidden } from '../Settings/anywhere/machinesApi';
import { MenuItemButton, MenuSeparator } from '../shared/ContextMenu';
import styles from './styles/command-deck.module.css';

/**
 * The linked-row fields these pieces read. A structural type, not
 * `Conversation`, so this module never imports ConversationList (which
 * mounts the footer) and no import cycle forms.
 */
interface LinkedRow {
  origin?: string;
  machineState?: string;
  machineLabel?: string;
  environmentId?: string;
  savedCopyName?: string | null;
  savedCopyAt?: string | null;
}

export function isOfflineLinked(conv: Pick<LinkedRow, 'origin' | 'machineState'>): boolean {
  return conv.origin === 'linked' && conv.machineState !== 'online';
}

/**
 * A machine label short enough for a chip: the mDNS `.local` suffix macOS adds
 * to every hostname carries no information, so chips drop it. Tooltips keep
 * the full label.
 */
export function chipMachineLabel(label: string): string {
  return label.replace(/\.local$/i, '');
}

/** The machine a linked row runs on: a tinted chip when online, a hairline outline when offline. */
export function LinkedMachineChip({ conv }: { conv: LinkedRow }) {
  const label = conv.machineLabel ?? 'another machine';
  const offline = isOfflineLinked(conv);
  return (
    <span
      className={`${styles.conversationBranchChip} ${offline ? styles.linkedMachineChipOffline : styles.linkedMachineChipOnline}`}
      title={offline ? `Runs on ${label}, which is offline` : `Runs on ${label}`}
      data-testid="linked-machine-chip"
    >
      <MonitorSmartphone size={10} />
      <span className={styles.conversationBranchChipText}>{chipMachineLabel(label)}</span>
    </span>
  );
}

function hhmm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "offline · saved HH:MM" or "offline · no saved copy", in place of cost and model. */
export function LinkedOfflineMeta({ conv }: { conv: LinkedRow }) {
  const saved = conv.savedCopyName ? hhmm(conv.savedCopyAt) : null;
  const text = conv.savedCopyName ? `offline · saved${saved ? ` ${saved}` : ''}` : 'offline · no saved copy';
  return (
    <>
      <span className={styles.conversationMetaSep} aria-hidden>·</span>
      <span data-testid="linked-offline-meta">{text}</span>
    </>
  );
}

/** The ⋮ menu of a linked row: copy its link, or hide its machine. */
export function LinkedRowMenuItems({ conv, onCopyLink, onClose }: {
  conv: LinkedRow;
  onCopyLink: (event: React.MouseEvent) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const hide = async () => {
    onClose();
    if (!conv.environmentId) return;
    await setMachineHidden(conv.environmentId, true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY }),
    ]);
  };
  return (
    <>
      <MenuItemButton onClick={(e) => { onCopyLink(e); onClose(); }}>
        <Copy size={14} />
        Copy link
      </MenuItemButton>
      <MenuSeparator />
      <MenuItemButton onClick={() => void hide()}>
        <EyeOff size={14} />
        Hide this machine
      </MenuItemButton>
    </>
  );
}

/** "<label> conversations hidden · Show", one line per hidden machine. */
export function HiddenMachinesFooter() {
  const queryClient = useQueryClient();
  // Same key and query function as the Settings machines panel, so the cache holds one shape.
  const { data } = useQuery({
    queryKey: MACHINES_QUERY_KEY,
    queryFn: loadMachines,
    staleTime: 30_000,
  });
  const hidden = (data?.links ?? []).filter((link) => link.hidden && link.state !== 'revoked');
  if (hidden.length === 0) return null;
  const show = async (id: string) => {
    await setMachineHidden(id, false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY }),
    ]);
  };
  return (
    <div className={styles.hiddenMachinesFooter} data-testid="hidden-machines-footer">
      {hidden.map((link) => (
        <div key={link.id}>
          <span className={styles.machineBannerLabel}>{link.label}</span> conversations hidden ·{' '}
          <button type="button" className={styles.hiddenMachinesShow} onClick={() => void show(link.id)}>Show</button>
        </div>
      ))}
    </div>
  );
}
