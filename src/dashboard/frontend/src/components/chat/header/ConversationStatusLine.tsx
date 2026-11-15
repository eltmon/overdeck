import { Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { ConversationMachineChip } from '../ConversationMachineBanner';
import { ConversationBranchMeta } from '../ConversationBranchMeta';
import type { HeaderChanges } from './headerChanges';
import styles from '../../CommandDeck/styles/command-deck.module.css';

/** D1-11: a leading /home/<user>, /Users/<user> or /root becomes `~`; any other path is unchanged. */
export function abbreviateHome(path: string): string {
  return path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)|^\/root(?=\/|$)/, '~');
}

export function commitsPushedLabel(n: number): string {
  return n === 1 ? '1 commit pushed' : `${n} commits pushed`;
}

export function commitsNotPushedLabel(n: number): string {
  return n === 1 ? '1 commit not pushed' : `${n} commits not pushed`;
}

export function filesNotCommittedLabel(n: number): string {
  return n === 1 ? '1 file not committed' : `${n} files not committed`;
}

export interface ConversationStatusLineProps {
  conversation: Conversation;
  status: { color: string; label: string; hollow: boolean };
  /** The phone app (PAN-4837): hide what its phone token cannot do. */
  native: boolean;
  /** Change data and the deck's openDock inside a Stage, else null (D1-7). */
  changes?: HeaderChanges | null;
}

const ACTION_CLASS = 'underline decoration-dotted underline-offset-2 hover:text-foreground';

function Sep() {
  return <span className={styles.conversationMetaSep} aria-hidden>·</span>;
}

/**
 * Row 2 of the conversation header — the status line in words (PAN-5291
 * D1-10): state · machine · folder · branch (+PR) · commits pushed · commits
 * not pushed · files not committed · cost. Inside a Stage the folder and the
 * change parts open the dock.
 */
export function ConversationStatusLine({ conversation, status, changes = null }: ConversationStatusLineProps) {
  const totals = changes?.totals ?? null;
  const openDock = changes?.openDock;
  const parts: ReactNode[] = [];
  if (totals && openDock) {
    if (totals.commitsPushed > 0) {
      parts.push(
        <button key="pushed" type="button" className={ACTION_CLASS} onClick={() => openDock({ tab: 'changes', changesScope: 'conversation' })}>
          {commitsPushedLabel(totals.commitsPushed)}
        </button>,
      );
    }
    if (totals.commitsLocal > 0) {
      parts.push(
        <button key="local" type="button" className={ACTION_CLASS} onClick={() => openDock({ tab: 'changes', changesScope: 'conversation' })}>
          {commitsNotPushedLabel(totals.commitsLocal)}
        </button>,
      );
    }
    if (totals.uncommittedFiles > 0) {
      parts.push(
        <button key="uncommitted" type="button" className={`${ACTION_CLASS} text-state-needs-you`} onClick={() => openDock({ tab: 'changes', changesScope: 'uncommitted' })}>
          {filesNotCommittedLabel(totals.uncommittedFiles)}
        </button>,
      );
    }
  }
  const cwd = conversation.cwd ?? '';
  return (
    <div className={styles.conversationMetaRow}>
      <span className={styles.conversationTerminalStatus}>
        <Circle size={7} style={{ fill: status.hollow ? 'transparent' : status.color, color: status.color }} />
        {status.label}
      </span>
      <ConversationMachineChip conversation={conversation} />
      {cwd && (
        <>
          <Sep />
          {openDock ? (
            <button type="button" className={`font-mono ${ACTION_CLASS}`} title={cwd} onClick={() => openDock({ tab: 'files' })}>
              {abbreviateHome(cwd)}
            </button>
          ) : (
            <span className="font-mono" title={cwd}>{abbreviateHome(cwd)}</span>
          )}
        </>
      )}
      <ConversationBranchMeta conversation={conversation} />
      {parts.map((part, index) => (
        <span key={index} className="contents"><Sep />{part}</span>
      ))}
      {conversation.totalCost !== undefined && conversation.totalCost > 0 && (
        <>
          <Sep />
          <span className="tabular-nums text-signal-cost-foreground">
            {conversation.totalCost < 0.01 ? '<$0.01' : `$${conversation.totalCost.toFixed(2)}`}
          </span>
        </>
      )}
    </div>
  );
}
