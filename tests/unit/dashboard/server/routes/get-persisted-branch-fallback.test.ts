/**
 * getPersistedBranchFallback (PAN-3362 UAT cycle 3).
 *
 * GET /api/workspaces/:issueId's shell-based getGitStatusAsync() returns null
 * for a workspace with no real .git checkout — true for the obviously-fake
 * FIX-1 UAT fixture, which has a persisted work-agent `branch` (written
 * through the canonical agent-state write door) but no on-disk checkout to
 * shell git against. This asserts the DB fallback picks that branch up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPersistedBranchFallback } from '../../../../../src/dashboard/server/routes/workspaces/workspace-data.js';
import { saveOverdeckAgentStateSync } from '../../../../../src/lib/overdeck/agent-state-sync.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../helpers/overdeck-test-db.js';
import type { AgentState } from '../../../../../src/lib/agents/agent-state.js';

describe('getPersistedBranchFallback', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => { odb = setupOverdeckTestDb(); });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  it('reports the work agent branch, uppercase-insensitive on issueId', () => {
    const state: AgentState = {
      id: 'agent-fix-1-work',
      issueId: 'FIX-1',
      workspace: '/tmp/fix-1',
      role: 'work',
      model: 'fixture/uat-seed',
      status: 'stopped',
      startedAt: '2026-08-06T00:00:00.000Z',
      branch: 'feature/fix-1',
    };
    saveOverdeckAgentStateSync(state);

    expect(getPersistedBranchFallback('fix-1')).toEqual({ branch: 'feature/fix-1', uncommittedFiles: 0, latestCommit: '' });
    expect(getPersistedBranchFallback('FIX-1')).toEqual({ branch: 'feature/fix-1', uncommittedFiles: 0, latestCommit: '' });
  });

  it('ignores a review sub-role agent with no branch, even when it is the only agent for the issue', () => {
    const state: AgentState = {
      id: 'agent-fix-1-review-security',
      issueId: 'FIX-1',
      workspace: '/tmp/fix-1',
      role: 'review',
      model: 'fixture/uat-seed',
      status: 'stopped',
      startedAt: '2026-08-06T00:00:00.000Z',
    };
    saveOverdeckAgentStateSync(state);

    expect(getPersistedBranchFallback('FIX-1')).toBeNull();
  });

  it('returns null when no agent exists for the issue', () => {
    expect(getPersistedBranchFallback('PAN-999999')).toBeNull();
  });
});
