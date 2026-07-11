import { describe, expect, it, vi } from 'vitest';

import { buildCostReconcileResponse, runCostReconcileSources } from '../costs.js';
import type { ReconcileResult } from '../../../../lib/costs/reconciler.js';
import type { CostReconcileSummary } from '../../../../lib/overdeck/cost.js';

function claudeSummary(imported: number): ReconcileResult {
  return {
    sessionsScanned: imported,
    sessionsWithNewData: imported,
    eventsImported: imported,
    duplicatesSkipped: 0,
    errors: [],
    earliestEventTs: null,
    latestEventTs: null,
  };
}

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
  it('runs the Claude transcript reconciler plus explicit ohmypi and codex sweeps', async () => {
    const runSource = vi.fn(async (source: 'ohmypi' | 'codex') =>
      source === 'ohmypi' ? summary(1) : summary(2),
    );
    const runClaude = vi.fn(async () => claudeSummary(3));

    const result = await runCostReconcileSources(runSource, runClaude);

    expect(runClaude).toHaveBeenCalledTimes(1);
    expect(runSource).toHaveBeenCalledTimes(2);
    expect(runSource).toHaveBeenNthCalledWith(1, 'ohmypi');
    expect(runSource).toHaveBeenNthCalledWith(2, 'codex');
    expect(result.claude.eventsImported).toBe(3);
    expect(result.ohmypi.imported).toBe(1);
    expect(result.codex.imported).toBe(2);

    const response = buildCostReconcileResponse(result);
    expect(response).toMatchObject({
      success: true,
      sessionsScanned: 3,
      sessionsWithNewData: 3,
      eventsImported: 3,
      duplicatesSkipped: 0,
      errors: [],
      earliestEventTs: null,
      latestEventTs: null,
    });
    expect(response.claude.eventsImported).toBe(3);
    expect(response.ohmypi.eventsImported).toBe(1);
    expect(response.codex.eventsImported).toBe(2);
  });
});
