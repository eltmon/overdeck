import { useEffect, useRef, useState } from 'react';
import { GitPullRequest, ListTree, Unlink } from 'lucide-react';
import type { PullRequestLink } from '@overdeck/contracts';
import { MenuItemButton } from '../shared/ContextMenu';
import { openPullRequestsDialog } from '../chat/LinkPullRequestDialog';
import styles from './styles/command-deck.module.css';

interface PullRequestMenuItemsProps {
  conversation: { name: string; pullRequest?: PullRequestLink | null };
  /** The `linkPullRequest`/`unlinkPullRequest` pair from useConversationMutations
   *  (typed structurally so this file adds no import cycle through it). */
  mutations: {
    linkPullRequest: (opts: { name: string; ref: string }) => void;
    unlinkPullRequest: (opts: { name: string; ref: string }) => void;
  };
  onClose: () => void;
}

/**
 * PAN-3822: "Link pull request…" (an inline input, like rename), "Pull
 * requests…" (the full dialog), and, when the conversation shows a PR, "Unlink #n". Shared by the row's overflow menu and
 * the tab/header action menu so both offer the same items.
 */
export function PullRequestMenuItems({ conversation, mutations, onClose }: PullRequestMenuItemsProps) {
  const [linking, setLinking] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const effective = conversation.pullRequest ?? null;

  useEffect(() => {
    if (linking) setTimeout(() => inputRef.current?.focus(), 0);
  }, [linking]);

  if (linking) {
    const commit = () => {
      const ref = draft.trim();
      if (ref) mutations.linkPullRequest({ name: conversation.name, ref });
      onClose();
    };
    return (
      <input
        ref={inputRef}
        className={styles.conversationNameInput}
        style={{ flex: '0 0 auto', width: '100%' }}
        value={draft}
        placeholder="Pull request URL or #42"
        aria-label="Pull request URL or #42"
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setLinking(false);
        }}
      />
    );
  }

  return (
    <>
      <MenuItemButton onClick={() => { setDraft(''); setLinking(true); }}>
        <GitPullRequest size={14} />
        Link pull request…
      </MenuItemButton>
      <MenuItemButton onClick={() => { openPullRequestsDialog(conversation.name); onClose(); }}>
        <ListTree size={14} />
        Pull requests…
      </MenuItemButton>
      {effective && (
        <MenuItemButton
          onClick={() => { mutations.unlinkPullRequest({ name: conversation.name, ref: effective.url }); onClose(); }}
        >
          <Unlink size={14} />
          Unlink #{effective.number}
        </MenuItemButton>
      )}
    </>
  );
}
