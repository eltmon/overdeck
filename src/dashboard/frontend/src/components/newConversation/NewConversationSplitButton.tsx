/**
 * The Command Deck sidebar `+` as a split button (PAN-4486). The main click
 * stays quick create (no dialog, the sidebar's stored model and effort). The
 * caret opens a one-item menu whose item opens the options dialog, preset to
 * the deck's project.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import styles from '../CommandDeck/styles/command-deck.module.css';
import { openNewConversationDialog } from './newConversationDialogStore';

export interface NewConversationSplitButtonProps {
  onQuickCreate: () => void;
  /** The deck's project (a key or display name); undefined for the no-project bucket. */
  projectKey?: string;
}

export function NewConversationSplitButton({ onQuickCreate, projectKey }: NewConversationSplitButtonProps) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  return (
    <div className={cn(styles.retroMenuHost, styles.conversationAddSplit)} ref={hostRef}>
      <button type="button" className={styles.conversationAddBtn} onClick={onQuickCreate} title="New conversation" aria-label="New conversation">
        <Plus size={13} />
      </button>
      <button
        type="button"
        className={styles.conversationAddCaret}
        aria-label="New conversation options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={11} />
      </button>
      {open && (
        <div role="menu" className={cn(styles.retroMenu, styles.conversationAddMenu)}>
          <button
            type="button"
            role="menuitem"
            className={styles.retroMenuItem}
            onClick={() => {
              setOpen(false);
              openNewConversationDialog({ projectKey });
            }}
          >
            New conversation with options…
          </button>
        </div>
      )}
    </div>
  );
}
