import { describe, expect, it, vi } from 'vitest';

import { runCostReconcileSources } from '../costs.js';
import type { CostReconcileSummary } from '../../../../lib/overdeck/cost.js';

function summary(imported: number): CostReconcileSummary {
  return {
    imported,
    sessionsScanned: imported,
    eventsImported: imported,
    duplicatesSkipped: 0,
    errors: [],
    earliestEventTs: null,
    latestEventTs: null,
    skipped: [],
    warnings: [],
  };
}

describe('POST /api/costs/reconcile route wiring', () => {
  it('runs explicit ohmypi and codex sweeps without the legacy no-source sweep', async () => {
    const runSource = vi.fn(async (source: 'ohmypi' | 'codex') =>
      source === 'ohmypi' ? summary(1) : summary(2),
    );

    const result = await runCostReconcileSources(runSource);

    expect(runSource).toHaveBeenCalledTimes(2);
    expect(runSource).toHaveBeenNthCalledWith(1, 'ohmypi');
    expect(runSource).toHaveBeenNthCalledWith(2, 'codex');
    expect(result.ohmypi.imported).toBe(1);
    expect(result.codex.imported).toBe(2);
  });
});
