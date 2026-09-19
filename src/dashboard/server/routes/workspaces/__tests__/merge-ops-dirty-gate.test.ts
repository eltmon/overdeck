import { describe, expect, it, vi } from 'vitest';

// The record plane itself: W3 deletes `pan-dir/record*` and `pan-dir/auto-commit`,
// and `auto-commit` already imports the removed `state-read-home`, so the module
// graph cannot load at all. Stubbing the deleted modules cuts every chain that
// still reaches them (workspaces/resolver → overdeck/infra, agents →
// agent-record-sync, git-activity → overdeck/git-activity) at their real end.
// merge-ops imports routes/specialists for `_serverManagedMerges`, which drags
// in the whole cloister/deacon tree (W4 replaces it with deacon-lite), and
// routes/workspaces reaches agents/spawn, which imports the removed
// `state-home` until W8 re-points it onto the terminal-backend contract.
vi.mock('../../specialists.js', () => ({ _serverManagedMerges: new Set<string>() }));
vi.mock('../../../../../lib/agents/spawn.js', () => ({
  spawnAgent: vi.fn(),
  spawnRun: vi.fn(),
  postAgentsRoute: vi.fn(),
}));
vi.mock('../../../../../lib/git-activity.js', () => ({ listGitOperationsSync: vi.fn(() => []) }));
vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
}));
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));

import { shouldBlockApproveForDirtyStatus } from '../merge-ops.js';

describe('shouldBlockApproveForDirtyStatus', () => {
  it('returns false when approve sees only state-plane paths', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M .pan/test/result.json',
    ].join('\n');

    expect(shouldBlockApproveForDirtyStatus(status)).toBe(false);
  });

  it('returns false for Overdeck runtime paths outside the state-plane allowlist (PAN-3245)', () => {
    const status = [
      '?? .pan/drafts/min-911.md',
      '?? .overdeck/continue.json',
    ].join('\n');

    expect(shouldBlockApproveForDirtyStatus(status)).toBe(false);
  });

  it('returns true when approve sees a dirty source path', () => {
    expect(shouldBlockApproveForDirtyStatus(' M src/foo.ts\n')).toBe(true);
  });

  it('returns true for mixed state-plane and source dirt', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M src/foo.ts',
    ].join('\n');

    expect(shouldBlockApproveForDirtyStatus(status)).toBe(true);
  });
});
