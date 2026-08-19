import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/overdeck/cost.js', () => ({
  collectCodexCostEvents: vi.fn(),
}));
vi.mock('../../../src/lib/costs/reconciler.js', () => ({
  collectPiCostEvents: vi.fn(),
}));

import { collectCodexCostEvents } from '../../../src/lib/overdeck/cost.js';
import { collectPiCostEvents } from '../../../src/lib/costs/reconciler.js';
import { runDashboardDbJob, workerLane } from '../../../src/dashboard/server/services/dashboard-db-task.js';

describe('cost reconcile worker job', () => {
  beforeEach(() => {
    vi.mocked(collectCodexCostEvents).mockReset().mockResolvedValue({
      events: [], verdicts: [], stats: { scanned: 3, cacheSkipped: 2 }, skipped: [], errors: [],
    });
    vi.mocked(collectPiCostEvents).mockReset().mockResolvedValue({
      events: [], verdicts: [], stats: { scanned: 2, cacheSkipped: 1, sessionsWithData: 0 }, errors: [],
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

  it('dispatches the pi collector for a pi sweep payload', async () => {
    const result = await runDashboardDbJob('costReconcileSweep', { source: 'pi' });

    expect(collectPiCostEvents).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ stats: { scanned: 2, cacheSkipped: 1 } });
  });
});
