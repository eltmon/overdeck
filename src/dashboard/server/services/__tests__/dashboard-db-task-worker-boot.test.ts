import { afterEach, describe, expect, it } from 'vitest';
import { __testInternals, runDashboardDbJob } from '../dashboard-db-task.js';

describe('dashboard DB worker entry', () => {
  const { workerScriptUrl } = __testInternals;

  it('resolves the built worker from the dist root for any dashboard chunk', () => {
    expect(workerScriptUrl('file:///opt/overdeck/dist/dashboard/server.js').href)
      .toBe('file:///opt/overdeck/dist/dashboard/dashboard-db-worker.js');
    expect(workerScriptUrl('file:///opt/overdeck/dist/dashboard/specialists-DFhmTtop.js').href)
      .toBe('file:///opt/overdeck/dist/dashboard/dashboard-db-worker.js');
  });

  it('keeps source-mode and unbundled JavaScript resolution', () => {
    expect(workerScriptUrl('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-task.ts').href)
      .toBe('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-worker.ts');
    expect(workerScriptUrl('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-task.js').href)
      .toBe('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-worker.js');
  });
});

// PAN-3930: polling snapshots always go to the real worker (never the Vitest
// inline path). From source the worker is a `.ts` file whose imports use `.js`
// specifiers; spawned as a raw Node worker it died with ERR_MODULE_NOT_FOUND on
// its first relative import. OVERDECK_HOME is a per-fork temp dir (tests/setup).
describe('dashboard DB worker under a source run', () => {
  afterEach(async () => {
    await __testInternals.terminateWorkers();
  });

  it('serves a polling snapshot from the real worker thread', async () => {
    const result = await runDashboardDbJob<Array<[string, unknown]>>('getAgentCostStats', {
      agentIds: ['agent-a'],
      nowMs: Date.now(),
    });
    expect(Array.isArray(result)).toBe(true);
  }, 30_000);
});
