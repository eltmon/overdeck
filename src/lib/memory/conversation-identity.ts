/**
 * Memory identity for a conversation (PAN-5359). A conversation has no agent
 * state; its identity comes from the workspace row that owns its cwd: the
 * row on `conversations.workspace_id`, else the longest-prefix match for the
 * cwd (the project's main row for a project-root conversation). issueId is
 * always null (PRD D-6 of PAN-1990): conversation turns search other
 * workspaces of the same project for sibling hits.
 */
import type { MemoryIdentity } from '@overdeck/contracts';
import type { LegacyConversation } from '../overdeck/conversations.js';
import { getWorkspaceById, resolveWorkspaceForCwd } from '../workspaces/resolver.js';
import type { WorkspaceRow } from '../workspaces/types.js';

export interface ConversationIdentityDeps {
  getWorkspaceById?: (id: string) => WorkspaceRow | null;
  resolveWorkspaceForCwd?: (cwd: string) => WorkspaceRow | null;
}

export function memoryIdentityForConversation(
  conversation: Pick<LegacyConversation, 'workspaceId' | 'cwd' | 'tmuxSession' | 'harness'> | null,
  sessionId: string,
  deps: ConversationIdentityDeps = {},
): MemoryIdentity | null {
  if (!conversation) return null;
  const byId = conversation.workspaceId ? (deps.getWorkspaceById ?? getWorkspaceById)(conversation.workspaceId) : null;
  const workspace = byId ?? (conversation.cwd ? (deps.resolveWorkspaceForCwd ?? resolveWorkspaceForCwd)(conversation.cwd) : null);
  if (!workspace) return null;
  return {
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    issueId: null,
    runId: conversation.tmuxSession,
    sessionId,
    agentRole: 'conversation',
    agentHarness: conversation.harness ?? 'claude-code',
  };
}
