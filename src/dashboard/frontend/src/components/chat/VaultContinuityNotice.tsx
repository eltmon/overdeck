import styles from '../CommandDeck/styles/command-deck.module.css';
import type { VaultContinuity } from '../CommandDeck/ConversationList';

export interface VaultContinuityNoticeProps {
  continuity: VaultContinuity;
  /** Opens the named conversation (e.g. `vault-<id>`) the way /conv/<name> deep links do. */
  onOpenCopy: (name: string) => void;
}

/**
 * PAN-4447: a local conversation whose native file round-tripped through another
 * machine. "Continued on <machine>" links to that machine's copy; a forked-locally
 * row also names the fork holding the turns typed here after the hand-off.
 */
export function VaultContinuityNotice({ continuity, onOpenCopy }: VaultContinuityNoticeProps) {
  const label = continuity.kind === 'forked-locally' ? continuity.parentOwnerLabel : continuity.ownerLabel;
  const vaultId = continuity.kind === 'forked-locally' ? continuity.parentVaultId : continuity.vaultId;
  return (
    <div className={styles.composerBox} role="status" data-testid="vault-continuity-notice">
      <p>
        {`Continued on ${label}. `}
        <button
          type="button"
          className="rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-[12px] hover:bg-accent"
          onClick={() => onOpenCopy(`vault-${vaultId}`)}
        >
          View its copy
        </button>
      </p>
      {continuity.kind === 'forked-locally' && (
        <p>{`Local turns since then were saved as a fork (${continuity.forkVaultId.slice(0, 8)}).`}</p>
      )}
    </div>
  );
}
