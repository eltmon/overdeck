/**
 * Machine-aware conversation chrome (PAN-4650 WI-12, FR-5): the banner under
 * the title bar for an offline owner or a released copy, the header chip
 * "on <machine>" for a linked conversation, and the composer's read-only
 * notice. Texts and actions follow the approved PAN-4646 mockup.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpRight, CloudOff, ExternalLink, FileText, Loader2, MonitorSmartphone, RefreshCw } from 'lucide-react';

import type { Conversation } from '../CommandDeck/ConversationList';
import { chipMachineLabel } from '../CommandDeck/LinkedConversationRow';
import styles from '../CommandDeck/styles/command-deck.module.css';
import { reconnectMachine } from '../Settings/anywhere/machinesApi';
import { MenuItemButton } from '../shared/ContextMenu';
import { conversationMachineState, lastSeenText } from './conversationMachineState';
import { OpenPreviewPopover } from './OpenPreviewPopover';
import { openPullHereDialog } from './PullHereDialog';

export { acceptsInput, conversationHeaderStatus, conversationMachineState, isLiveMachineState, runsHere } from './conversationMachineState';

/** Select a conversation the way /conv/<key> deep links do (client-side route). */
export function openConversationRoute(key: string): void {
  window.history.pushState(null, '', `/conv/${key.startsWith('@') ? key : encodeURIComponent(key)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The linked row the released copy became on the machine it went to, and that machine's label. */
function useReleasedTarget(conv: Conversation): { label: string; target: Conversation | null } {
  const rows = useQueryClient().getQueryData<Conversation[]>(['conversations']) ?? [];
  const onMachine = rows.filter((row) => row.origin === 'linked' && row.environmentId === conv.releasedTo);
  const target = onMachine.find((row) => conv.claudeSessionId && row.pulledFrom?.nativeSessionId === conv.claudeSessionId) ?? null;
  return { label: onMachine[0]?.machineLabel ?? (conv.releasedTo ?? '').slice(0, 8), target };
}

function BannerButton({ icon, label, onClick, disabled, primary }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button type="button" className={`${styles.conversationAboutToggle} ${primary ? styles.machineBannerPrimary : ''}`} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ReleasedBanner({ conversation }: { conversation: Conversation }) {
  const { label, target } = useReleasedTarget(conversation);
  return (
    <div className={styles.machineBanner} role="status" data-testid="machine-banner">
      <ArrowUpRight size={14} className={styles.machineBannerIcon} />
      <span>Continued on <span className={styles.machineBannerLabel}>{label}</span> <span className={styles.machineBannerSub}>· this copy is read-only</span></span>
      <span className={styles.machineBannerActions}>
        <BannerButton
          icon={<ExternalLink size={13} />}
          label="Open there"
          disabled={!target}
          onClick={() => { if (target) openConversationRoute(target.name); }}
        />
      </span>
    </div>
  );
}

function pullTarget(conversation: Conversation, offline: boolean) {
  return {
    name: conversation.name,
    title: conversation.title ?? conversation.remoteName ?? conversation.name,
    machineLabel: conversation.machineLabel ?? 'the other machine',
    isWorking: conversation.isWorking === true,
    offline,
  };
}

function OfflineBanner({ conversation, saved }: { conversation: Conversation; saved: boolean }) {
  const [reconnecting, setReconnecting] = useState(false);
  const label = conversation.machineLabel ?? 'The other machine';
  const reconnect = async () => {
    setReconnecting(true);
    try {
      await reconnectMachine(conversation.environmentId ?? '');
    } finally {
      setReconnecting(false);
    }
  };
  return (
    <div className={styles.machineBanner} role="status" data-testid="machine-banner">
      <CloudOff size={14} className={styles.machineBannerIcon} />
      <span><span className={styles.machineBannerLabel}>{label}</span> is offline (last seen {lastSeenText(conversation.machineLastSeenAt)})</span>
      <span className={styles.machineBannerActions}>
        {saved && conversation.savedCopyName ? (
          <>
            <BannerButton icon={<FileText size={13} />} label="Read saved copy" onClick={() => openConversationRoute(conversation.savedCopyName!)} />
            {/* PAN-4650 WI-14: the pull job's offline path continues the saved copy through the vault. */}
            <BannerButton icon={<ArrowDownToLine size={13} />} label="Continue here" primary onClick={() => openPullHereDialog(pullTarget(conversation, true))} />
          </>
        ) : (
          <BannerButton
            icon={reconnecting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            label={reconnecting ? 'Reconnecting…' : 'Reconnect'}
            disabled={reconnecting}
            onClick={() => void reconnect()}
          />
        )}
      </span>
    </div>
  );
}

/** The banner for the three non-live machine states; nothing otherwise. */
export function ConversationMachineBanner({ conversation }: { conversation: Conversation }) {
  const state = conversationMachineState(conversation);
  if (state === 'released') return <ReleasedBanner conversation={conversation} />;
  if (state === 'offline-saved' || state === 'offline-none') return <OfflineBanner conversation={conversation} saved={state === 'offline-saved'} />;
  return null;
}

/**
 * **Pull here** in the title bar of a conversation an online linked machine
 * runs and can hand over (`pullable`; the UI never compares harness names).
 * `menu` renders the ⋮ item, the fallback when the header is narrow.
 */
export function PullHereButton({ conversation, menu = false, onDone }: { conversation: Conversation; menu?: boolean; onDone?: () => void }) {
  if (conversationMachineState(conversation) !== 'remote' || conversation.pullable === false) return null;
  const open = () => { openPullHereDialog(pullTarget(conversation, false)); onDone?.(); };
  return menu ? (
    <MenuItemButton onClick={open}>
      <ArrowDownToLine size={14} />
      Pull here
    </MenuItemButton>
  ) : (
    <button type="button" className={`${styles.conversationAboutToggle} ${styles.pullHereHeaderButton}`} title="Make this machine the owner" onClick={open}>
      <ArrowDownToLine size={14} />
      <span>Pull here</span>
    </button>
  );
}

/** The title-bar actions of a conversation an online linked machine runs: Preview and Pull here. */
export function RemoteHeaderActions({ conversation }: { conversation: Conversation }) {
  if (conversationMachineState(conversation) !== 'remote') return null;
  return (
    <>
      <OpenPreviewPopover conversation={conversation} />
      <PullHereButton conversation={conversation} />
    </>
  );
}

/** "on <machine>" in the header metadata row of a linked conversation. */
export function ConversationMachineChip({ conversation }: { conversation: Conversation }) {
  if (conversation.origin !== 'linked') return null;
  const label = conversation.machineLabel ?? 'another machine';
  const online = conversation.machineState === 'online';
  return (
    <span
      className={`${styles.conversationBranchChip} ${styles.headerMachineChip}`}
      title={online ? `Remote control: this conversation runs on ${label}` : `${label} is offline`}
      data-testid="machine-chip"
    >
      <MonitorSmartphone size={12} className="shrink-0" />
      <span className={styles.conversationBranchChipText}>on {chipMachineLabel(label)}</span>
    </span>
  );
}

/** The composer of a conversation that cannot take input here (offline owner or released copy). */
export function MachineReadOnlyNotice({ conversation }: { conversation: Conversation }) {
  const state = conversationMachineState(conversation);
  const { label: releasedLabel } = useReleasedTarget(conversation);
  const owner = conversation.machineLabel ?? 'The other machine';
  return (
    <div className={styles.composerFooter}>
      <div className={styles.composerBox} role="status" data-testid="machine-read-only-notice">
        <div className={styles.composerReadOnly}>
          {state === 'released' ? <ArrowUpRight size={14} /> : <CloudOff size={14} />}
          {state === 'released' ? (
            <span>Read-only. This conversation now runs on <span className={styles.machineBannerLabel}>{releasedLabel}</span>.</span>
          ) : (
            <span>
              <span className={styles.machineBannerLabel}>{owner}</span> is offline, so messages can't reach it.
              {state === 'offline-saved' ? ' Continue here to run the conversation on this machine.' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
