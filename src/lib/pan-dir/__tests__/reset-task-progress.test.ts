import { describe, expect, it } from 'vitest';
import { clearTaskProgress } from '../reset-task-progress.js';

describe('clearTaskProgress', () => {
  it('clears runtime task state while preserving the rest of the issue record', () => {
    const record = clearTaskProgress({
      issueId: 'PAN-2499', schemaVersion: 1, branch: 'feature/pan-2499',
      statusOverrides: { 'wi-1': 'completed', 'wi-2': 'running' },
      tasks: { sequence: 4, claims: { 'wi-2': { writerId: 'agent-pan-2499' } }, claimHistory: [{ itemId: 'wi-1', outcome: 'completed', writerId: 'agent-pan-2499', at: '2026-07-14T00:00:00Z' }] },
      pipeline: {}, closeOut: {},
    });
    expect(record.statusOverrides).toEqual({});
    expect(record.tasks).toEqual({ sequence: 0, claims: {}, claimHistory: [] });
    expect(record.branch).toBe('feature/pan-2499');
  });
});
