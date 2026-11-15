import { describe, expect, it } from 'vitest';

import { memoryIdentityForConversation } from '../conversation-identity.js';
import type { LegacyConversation } from '../../overdeck/conversations.js';
import type { WorkspaceRow } from '../../workspaces/types.js';

function conversation(overrides: Partial<Pick<LegacyConversation, 'workspaceId' | 'cwd' | 'tmuxSession' | 'harness'>>) {
  return {
    workspaceId: null,
    cwd: '/home/eltmon/Projects/dfai',
    tmuxSession: 'conv-x',
    harness: 'codex' as const,
    ...overrides,
  };
}

function workspace(overrides: Partial<WorkspaceRow>): WorkspaceRow {
  return {
    id: 'ws-main',
    projectId: 'dfai',
    kind: 'main',
    origin: 'operator',
    name: 'main',
    path: '/home/eltmon/Projects/dfai',
    branchName: null,
    parentBranch: null,
    parentBranchGuessed: false,
    isGitRepository: true,
    issueId: null,
    layoutConfig: null,
    runCommand: null,
    ...overrides,
  } as WorkspaceRow;
}

describe('memoryIdentityForConversation (PAN-5359)', () => {
  it('returns the workspace-row identity for a conversation with workspaceId', () => {
    const identity = memoryIdentityForConversation(
      conversation({ workspaceId: 'ws-main' }),
      'sess-1',
      { getWorkspaceById: (id) => (id === 'ws-main' ? workspace({}) : null) },
    );

    expect(identity).toEqual({
      projectId: 'dfai',
      workspaceId: 'ws-main',
      issueId: null,
      runId: 'conv-x',
      sessionId: 'sess-1',
      agentRole: 'conversation',
      agentHarness: 'codex',
    });
  });

  it('falls back to resolveWorkspaceForCwd when workspaceId is null', () => {
    const identity = memoryIdentityForConversation(
      conversation({ workspaceId: null, cwd: '/home/eltmon/Projects/dfai' }),
      'sess-2',
      {
        getWorkspaceById: () => null,
        resolveWorkspaceForCwd: (cwd) => (cwd === '/home/eltmon/Projects/dfai' ? workspace({}) : null),
      },
    );

    expect(identity?.projectId).toBe('dfai');
    expect(identity?.workspaceId).toBe('ws-main');
  });

  it('falls back to resolveWorkspaceForCwd when workspaceId names no row', () => {
    const identity = memoryIdentityForConversation(
      conversation({ workspaceId: 'ws-missing', cwd: '/home/eltmon/Projects/dfai' }),
      'sess-3',
      {
        getWorkspaceById: () => null,
        resolveWorkspaceForCwd: (cwd) => (cwd === '/home/eltmon/Projects/dfai' ? workspace({}) : null),
      },
    );

    expect(identity?.workspaceId).toBe('ws-main');
  });

  it('returns null when no workspace is found', () => {
    const identity = memoryIdentityForConversation(
      conversation({ workspaceId: null, cwd: '/home/eltmon/Projects/unknown' }),
      'sess-4',
      { resolveWorkspaceForCwd: () => null },
    );

    expect(identity).toBeNull();
  });

  it('returns null for a null conversation', () => {
    expect(memoryIdentityForConversation(null, 'sess-5')).toBeNull();
  });
});
