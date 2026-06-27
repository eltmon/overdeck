import { describe, expect, it } from 'vitest';

import { agentHasResolvableWorkspace, UNRESOLVABLE_AGENT_GIT_INFO } from '../agents.js';
import type { AgentState } from '../../../../lib/agents.js';

// PAN-1718 regression guard.
//
// The /api/agents/:id/git-info route used to return workspaceMissing:true
// whenever it could not resolve the id to a workspace-bound agent. That made
// legacy / JSONL-only session nodes (e.g. a "Planning state" placeholder)
// falsely render "Worktree missing" in the SessionPanel chip even when the
// worktree was present and valid on disk. The fix: an unresolvable session is
// "unknown", not "workspace gone" — only resolveAgentGitInfo (which stats the
// real path) may assert a missing worktree.

function agent(partial: Partial<AgentState>): AgentState {
  return { id: 'agent-pan-1718', issueId: 'PAN-1718', workspace: '/ws/feature-pan-1718', ...partial } as AgentState;
}

describe('git-info fallback (PAN-1718)', () => {
  it('does NOT claim the worktree is missing for unresolvable sessions', () => {
    expect(UNRESOLVABLE_AGENT_GIT_INFO.workspaceMissing).toBe(false);
    // showChip = actualBranch || workspaceMissing — both falsy here means the
    // chip hides instead of flashing a false "Worktree missing".
    expect(UNRESOLVABLE_AGENT_GIT_INFO.actualBranch).toBeNull();
  });

  it('treats an unknown session id (null state) as unresolvable', () => {
    expect(agentHasResolvableWorkspace(null)).toBe(false);
  });

  it('treats an agent with no workspace bound as unresolvable', () => {
    expect(agentHasResolvableWorkspace(agent({ workspace: '' }))).toBe(false);
  });

  it('treats an agent with no issueId as unresolvable', () => {
    expect(agentHasResolvableWorkspace(agent({ issueId: '' }))).toBe(false);
  });

  it('treats a workspace-bound agent as resolvable (real git-info path runs)', () => {
    expect(agentHasResolvableWorkspace(agent({}))).toBe(true);
  });
});
