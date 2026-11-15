import { GitFork } from 'lucide-react';
import type { Conversation } from '../CommandDeck/ConversationList';
import { PullRequestBadge } from '../primitives/PullRequestBadge';
import styles from '../CommandDeck/styles/command-deck.module.css';

/**
 * The open conversation header's branch (mono; a fork icon for a worktree,
 * the Local/Worktree word in the tooltip, PAN-5291 D1-10) and, beside it, the
 * effective pull request badge (PAN-3822). Both read from the conversation list row, so
 * the badge updates whenever `conversation.pull_requests_changed` refetches it.
 */
export function ConversationBranchMeta({ conversation }: {
  conversation: Pick<Conversation, 'branch' | 'isWorktree' | 'cwd' | 'pullRequest' | 'pullRequestCount'>;
}) {
  return (
    <>
      {conversation.branch && (
        <>
          <span className={styles.conversationMetaSep} aria-hidden>·</span>
          <span
            className="inline-flex min-w-0 items-center gap-1 font-mono text-muted-foreground"
            title={`${conversation.isWorktree ? 'Worktree' : 'Local'} · ${conversation.cwd}`}
          >
            {conversation.isWorktree && <GitFork size={12} className="shrink-0" />}
            <span className="truncate">{conversation.branch}</span>
          </span>
        </>
      )}
      {conversation.pullRequest && (
        <>
          <span className={styles.conversationMetaSep} aria-hidden>·</span>
          <PullRequestBadge
            link={conversation.pullRequest}
            extraCount={Math.max(0, (conversation.pullRequestCount ?? 1) - 1)}
          />
        </>
      )}
    </>
  );
}
