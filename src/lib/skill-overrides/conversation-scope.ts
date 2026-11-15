/**
 * Resolve a conversation's effective skill states for the dashboard composer
 * (PAN-5347): the conversation row names the launch scope (cwd, issue) and
 * carries the narrowest, per-conversation skill map, so the same resolution
 * the launcher applies is what the UI shows in its / menu.
 */
import { SkillOverrideError, listSkillStates, type SkillStateList } from './store.js';
import type { SkillOverrideMap } from './resolve.js';

export interface ConversationSkillScopeQuery {
  conversationName?: string;
  cwd?: string;
  issueId?: string;
}

/**
 * A named conversation resolves scope from its own row (cwd, issue, and its
 * per-conversation overrides); an unnamed one falls back to the query's cwd
 * and issue. An issue that resolves to no owning project retries at global
 * scope rather than failing the whole request.
 */
export async function listConversationSkillStates(query: ConversationSkillScopeQuery): Promise<SkillStateList> {
  const row = query.conversationName
    ? (await import('../overdeck/conversations.js')).getConversationByName(query.conversationName)
    : null;
  const cwd = row?.cwd ?? query.cwd;
  if (!row && !cwd) {
    throw new SkillOverrideError('unknown-conversation', `unknown conversation: ${query.conversationName}`);
  }
  const issueId = row?.issueId ?? query.issueId;
  const { resolveLaunchScope } = await import('./launch.js');
  const scope: { projectKey?: string; issueId?: string } = cwd ? await resolveLaunchScope({ cwd, issueId }) : { issueId };
  const conversationOverrides = (row?.skillOverrides ?? undefined) as SkillOverrideMap | undefined;
  try {
    return await listSkillStates({ ...scope, conversationOverrides });
  } catch (error) {
    if (error instanceof SkillOverrideError && error.code === 'unknown-issue') {
      return listSkillStates({ projectKey: scope.projectKey, conversationOverrides });
    }
    throw error;
  }
}
