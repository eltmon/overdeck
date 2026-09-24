import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __testInternals, runDashboardDbJob } from '../dashboard-db-task.js';

describe('dashboard DB worker entry', () => {
  const { workerScriptUrl } = __testInternals;

  it('resolves the built worker from the dist root for any dashboard chunk', () => {
    expect(workerScriptUrl('file:///opt/overdeck/dist/dashboard/server.js').href)
      .toBe('file:///opt/overdeck/dist/dashboard/dashboard-db-worker.js');
    expect(workerScriptUrl('file:///opt/overdeck/dist/dashboard/shared-B_onMFsl.js').href)
      .toBe('file:///opt/overdeck/dist/dashboard/dashboard-db-worker.js');
  });

  it('keeps source-mode and unbundled JavaScript resolution', () => {
    expect(workerScriptUrl('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-task.ts').href)
      .toBe('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-worker.ts');
    expect(workerScriptUrl('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-task.js').href)
      .toBe('file:///opt/overdeck/src/dashboard/server/services/dashboard-db-worker.js');
  });
});

// PAN-3930: from source, the worker is a `.ts` file whose imports use `.js`
// specifiers. Spawned as a raw Node worker it died on its first relative import,
// so any test that reached a polling snapshot through the real worker exploded.
describe('dashboard DB worker from source', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-dashboard-db-worker-'));
    originalHome = process.env['OVERDECK_HOME'];
    process.env['OVERDECK_HOME'] = tempDir;
  });

  afterAll(async () => {
    if (originalHome === undefined) delete process.env['OVERDECK_HOME'];
    else process.env['OVERDECK_HOME'] = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('boots the real worker and answers a polling read', async () => {
    const stats = await runDashboardDbJob<{ available: boolean }>('getConversationSearchStats', {
      dbPath: join(tempDir, 'search.db'),
      model: 'small',
    });
    expect(stats).toHaveProperty('available');
  }, 60_000);
});
