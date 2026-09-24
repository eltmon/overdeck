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
 * - The cwd's current branch wins.
 * - An agent conversation whose cwd cannot be read falls back to the
 *   `feature/<issue>` workspace convention.
 * - A conversation on the project's default branch (or a detached HEAD) has no
 *   branch for detection, so an operator chat in the primary checkout never
 *   links to whatever PR happens to share that name.
 */
export async function resolveConversationBranch(
  conversation: ConversationBranchInput,
  defaultBranch: string,
): Promise<string | null> {
  const info = await resolveConversationGitInfo(conversation.cwd);
  let branch = info.branch && info.branch !== 'HEAD' ? info.branch : null;
  if (!branch && conversation.issueId && isAgentConversationName(conversation.name)) {
    branch = `feature/${conversation.issueId.toLowerCase()}`;
  }
  if (!branch || branch === defaultBranch) return null;
  return branch;
}
