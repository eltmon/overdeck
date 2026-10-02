/**
 * The branch a conversation's work lives on, for pull-request branch detection
 * (PAN-3822). Read from the conversation's cwd at sweep time; nothing is stored.
 */

import { resolveConversationGitInfo } from '../../dashboard/server/services/git-info.js';
import { isAgentConversationName } from './conversations.js';

export interface ConversationBranchInput {
  readonly name: string;
  readonly cwd: string;
  readonly issueId: string | null;
  /** The conversation's pane is live now; null/undefined when unknown. */
  readonly live?: boolean | null;
}

/**
 * The conversation's branch, or null when it has none worth matching.
 *
 * - The cwd's current branch counts in a linked git worktree, for an agent
 *   conversation, or for an operator conversation in the primary checkout
 *   whose pane is live at sweep time (PAN-4457). A primary checkout is
 *   shared, so an idle conversation there is never linked to whatever branch
 *   the checkout happens to be on; liveness unknown counts as not live.
 *   Explicit links are unaffected.
 * - An agent conversation whose cwd cannot be read falls back to the
 *   `feature/<issue>` workspace convention.
 * - A conversation on the project's default branch (or a detached HEAD) has no
 *   branch for detection.
 */
export async function resolveConversationBranch(
  conversation: ConversationBranchInput,
  defaultBranch: string,
): Promise<string | null> {
  const isAgent = isAgentConversationName(conversation.name);
  const info = await resolveConversationGitInfo(conversation.cwd);
  const branchCounts = info.isWorktree || isAgent || conversation.live === true;
  let branch = info.branch && info.branch !== 'HEAD' && branchCounts ? info.branch : null;
  if (!branch && conversation.issueId && isAgent) {
    branch = `feature/${conversation.issueId.toLowerCase()}`;
  }
  if (!branch || branch === defaultBranch) return null;
  return branch;
}
