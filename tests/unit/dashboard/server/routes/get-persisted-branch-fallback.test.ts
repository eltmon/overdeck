/**
 * getPersistedBranchFallback (PAN-3362 UAT cycle 3).
 *
 * GET /api/workspaces/:issueId's shell-based getGitStatusAsync() returns null
 * for a workspace with no real .git checkout — true for the obviously-fake
 * FIX-1 UAT fixture, which has a persisted work-agent `branch` (written
 * through the canonical agent-state write door) but no on-disk checkout to
 * shell git against. This asserts the DB fallback picks that branch up.
 *
 * getPersistedBranchFallback() is a pure selection over an already
 * issue-scoped agent list (review finding, cycle 3: a full-table scan on a
 * server route delays concurrent HTTP/WS work) — listOverdeckAgentStatesByIssueSync()
 * is the indexed query that supplies that list, tested separately below.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPersistedBranchFallback } from '../../../../../src/dashboard/server/routes/workspaces/workspace-data.js';
import { saveOverdeckAgentStateSync, listOverdeckAgentStatesByIssueSync } from '../../../../../src/lib/overdeck/agent-state-sync.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../helpers/overdeck-test-db.js';
import type { AgentState } from '../../../../../src/lib/agents/agent-state.js';

describe('getPersistedBranchFallback', () => {
  it('reports the work agent branch among an issue-scoped agent list', () => {
    const agents: AgentState[] = [
      { id: 'agent-fix-1-work', issueId: 'FIX-1', workspace: '/tmp/fix-1', role: 'work', model: 'fixture/uat-seed', status: 'stopped', startedAt: '2026-08-06T00:00:00.000Z', branch: 'feature/fix-1' },
      { id: 'agent-fix-1-review-security', issueId: 'FIX-1', workspace: '/tmp/fix-1', role: 'review', model: 'fixture/uat-seed', status: 'stopped', startedAt: '2026-08-06T00:00:00.000Z' },
    ];

    expect(getPersistedBranchFallback(agents)).toEqual({ branch: 'feature/fix-1', uncommittedFiles: 0, latestCommit: '' });
  });

  it('ignores a review sub-role agent with no branch, even when it is the only agent given', () => {
    const agents: AgentState[] = [
      { id: 'agent-fix-1-review-security', issueId: 'FIX-1', workspace: '/tmp/fix-1', role: 'review', model: 'fixture/uat-seed', status: 'stopped', startedAt: '2026-08-06T00:00:00.000Z' },
    ];

    expect(getPersistedBranchFallback(agents)).toBeNull();
  });

  it('returns null for an empty agent list', () => {
    expect(getPersistedBranchFallback([])).toBeNull();
  });
});

describe('listOverdeckAgentStatesByIssueSync', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => { odb = setupOverdeckTestDb(); });
  afterEach(() => { teardownOverdeckTestDb(odb); });

  it('returns only rows for the requested issue, case-insensitively', () => {
    const fix1Work: AgentState = { id: 'agent-fix-1-work', issueId: 'FIX-1', workspace: '/tmp/fix-1', role: 'work', model: 'fixture/uat-seed', status: 'stopped', startedAt: '2026-08-06T00:00:00.000Z', branch: 'feature/fix-1' };
    const otherIssue: AgentState = { id: 'agent-pan-1-work', issueId: 'PAN-1', workspace: '/tmp/pan-1', role: 'work', model: 'sonnet', status: 'stopped', startedAt: '2026-08-06T00:00:00.000Z', branch: 'feature/pan-1' };
    saveOverdeckAgentStateSync(fix1Work);
    saveOverdeckAgentStateSync(otherIssue);

    expect(listOverdeckAgentStatesByIssueSync('fix-1').map((a) => a.id)).toEqual(['agent-fix-1-work']);
    expect(listOverdeckAgentStatesByIssueSync('FIX-1').map((a) => a.id)).toEqual(['agent-fix-1-work']);
  });

  it('returns an empty array when no agent exists for the issue', () => {
    expect(listOverdeckAgentStatesByIssueSync('PAN-999999')).toEqual([]);
  });
});
