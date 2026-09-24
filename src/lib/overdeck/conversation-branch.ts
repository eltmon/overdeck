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
}

/**
 * The conversation's branch, or null when it has none worth matching.
 *
 * - The cwd's current branch counts only in a linked git worktree or for an
 *   agent conversation. An operator conversation in the primary checkout
 *   shares that checkout's branch with every other conversation there, so it
 *   is never linked to whatever feature branch the checkout happens to be on.
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
  let branch = info.branch && info.branch !== 'HEAD' && (info.isWorktree || isAgent) ? info.branch : null;
  if (!branch && conversation.issueId && isAgent) {
    branch = `feature/${conversation.issueId.toLowerCase()}`;
  }
  if (!branch || branch === defaultBranch) return null;
  return branch;
}
