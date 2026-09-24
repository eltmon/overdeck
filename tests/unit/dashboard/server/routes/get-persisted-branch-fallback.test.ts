/**
 * getPersistedBranchFallback / getPersistedBranchFallbackAsync (PAN-3362 UAT cycle 4).
 *
 * GET /api/workspaces/:issueId's shell-based getGitStatusAsync() returns null
 * for a workspace with no real .git checkout — true for the obviously-fake
 * FIX-1 UAT fixture, which has a persisted work-agent `branch` (written
 * through the canonical agent-state write door) but no on-disk checkout to
 * shell git against. This asserts the fallback picks that branch up.
 *
 * getPersistedBranchFallback() is a pure selection over an already-resolved
 * agent list. getPersistedBranchFallbackAsync() supplies that list by reading
 * getCachedRunningAgents() — the same request-local, TTL-cached, single-flight
 * projection the route already uses for cost resolution.
 *
 * PAN-3917: there is no agents table to seed. The agent list is scanned from
 * each agent's own state.json, so the scan is what this test stands in for.
 */
import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentState } from '../../../../../src/lib/agents/agent-state.js';

const scannedAgents: AgentState[] = [];
vi.mock('../../../../../src/lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/agents.js')>();
  return { ...actual, listRunningAgents: () => Effect.succeed(scannedAgents) };
});

const { getPersistedBranchFallback, getPersistedBranchFallbackAsync } =
  await import('../../../../../src/dashboard/server/routes/workspaces/workspace-data.js');
const { clearRunningAgentsCache } =
  await import('../../../../../src/dashboard/server/services/running-agents-cache.js');

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

describe('getPersistedBranchFallbackAsync', () => {
  beforeEach(() => {
    scannedAgents.length = 0;
    clearRunningAgentsCache();
  });
  afterEach(() => {
    scannedAgents.length = 0;
    clearRunningAgentsCache();
  });

  it('resolves the work agent branch for the requested issue only, case-insensitively', async () => {
    const fix1Work: AgentState = { id: 'agent-fix-1-work', issueId: 'FIX-1', workspace: '/tmp/fix-1', role: 'work', model: 'fixture/uat-seed', status: 'stopped', startedAt: '2026-08-06T00:00:00.000Z', branch: 'feature/fix-1' };
    const otherIssue: AgentState = { id: 'agent-pan-1-work', issueId: 'PAN-1', workspace: '/tmp/pan-1', role: 'work', model: 'sonnet', status: 'stopped', startedAt: '2026-08-06T00:00:00.000Z', branch: 'feature/pan-1' };
    scannedAgents.push(fix1Work, otherIssue);

    await expect(getPersistedBranchFallbackAsync('fix-1')).resolves.toEqual({ branch: 'feature/fix-1', uncommittedFiles: 0, latestCommit: '' });
    await expect(getPersistedBranchFallbackAsync('FIX-1')).resolves.toEqual({ branch: 'feature/fix-1', uncommittedFiles: 0, latestCommit: '' });
  });

  it('resolves null when no agent exists for the issue', async () => {
    await expect(getPersistedBranchFallbackAsync('PAN-999999')).resolves.toBeNull();
  });
});
