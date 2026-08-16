import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/overdeck/cost.js', () => ({
  collectCodexCostEvents: vi.fn(),
}));

import { collectCodexCostEvents } from '../../../src/lib/overdeck/cost.js';
import { runDashboardDbJob, workerLane } from '../../../src/dashboard/server/services/dashboard-db-task.js';

describe('cost reconcile worker job', () => {
  beforeEach(() => {
    vi.mocked(collectCodexCostEvents).mockReset().mockResolvedValue({
      events: [], verdicts: [], stats: { scanned: 3, cacheSkipped: 2 }, skipped: [], errors: [],
    });
  });

  it('routes costReconcileSweep to the long worker lane', () => {
    expect(workerLane('costReconcileSweep')).toBe('long');
  });

  it('dispatches the codex collector through the database job surface', async () => {
    const result = await runDashboardDbJob('costReconcileSweep', { source: 'codex' });

    expect(collectCodexCostEvents).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ stats: { scanned: 3, cacheSkipped: 2 } });
  });
});
