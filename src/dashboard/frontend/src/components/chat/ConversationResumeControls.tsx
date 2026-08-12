import type { ReactNode } from 'react';
import styles from '../CommandDeck/styles/command-deck.module.css';

interface ConversationResumeControlsProps {
  modelPicker?: ReactNode;
  sendResumeContract?: boolean;
  onSendResumeContractChange?: (send: boolean) => void;
  onResume: () => void;
  resumePending?: boolean;
  resumeLabel?: string;
  className?: string;
}

export function ConversationResumeControls({
  modelPicker,
  sendResumeContract,
  onSendResumeContractChange,
  onResume,
  resumePending,
  resumeLabel,
  className = styles.conversationResumeBar,
}: ConversationResumeControlsProps) {
  return (
    <div className={className}>
      {modelPicker}
      {sendResumeContract !== undefined && onSendResumeContractChange && (
        <label className={styles.conversationResumeContractToggle}>
          <input
            type="checkbox"
            checked={sendResumeContract}
            onChange={(event) => onSendResumeContractChange(event.target.checked)}
            disabled={resumePending}
          />
          Send resume message
        </label>
      )}
      <button
        className={styles.conversationResumeBtn}
        onClick={onResume}
        disabled={resumePending}
      >
        {resumePending ? 'Resuming…' : (resumeLabel ?? 'Resume Session')}
      </button>
    </div>
  );
}
