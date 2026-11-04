/**
 * PAN-4961 WI-7: a work start held for low disk answers 507 { diskLow: true }.
 * The finalize auto-handoff and deacon-lite's retry must treat that as a
 * retryable guardrail refusal (deferred), not a failed handoff.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/internal-token.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/internal-token.js')>(),
  getInternalToken: vi.fn(() => 'test-internal-token'),
}));

import { completePlanningAutoSpawn } from '../../../src/lib/overdeck/planning-promotion.js';
import { spawnWorkAgentThroughAgentsEndpoint } from '../../../src/lib/cloister/work-agent-start.js';

const HELD = 'Disk low — new workspace starts are held: 11.0 GiB free on the filesystem holding /w, 0.0 GiB reserved by 0 in-flight workspace setup(s), this step needs 2.0 GiB, and the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.';

const diskLowResponse = () => new Response(JSON.stringify({
  success: false,
  blocked: true,
  skipped: true,
  diskLow: true,
  error: HELD,
}), { status: 507 });

const stackUnhealthyResponse = () => new Response(JSON.stringify({
  success: false,
  blocked: true,
  skipped: true,
  error: 'Workspace docker stack for PAN-1 is not healthy: init exited non-zero (1)',
  stackHealth: { healthy: false, reasons: ['init exited non-zero (1)'] },
}), { status: 422 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('disk-low work start defers the handoff (PAN-4961)', () => {
  it('handoff-defers-disk-hold.ac1: the finalize auto-spawn defers a 507 diskLow refusal', async () => {
    const result = await completePlanningAutoSpawn({
      issueId: 'PAN-1',
      autoSpawn: true,
      dashboardOrigin: 'http://127.0.0.1:3011',
      readAgentState: () => null,
      fetchImpl: async () => diskLowResponse(),
    });

    expect(result).toEqual({
      workAgentSpawned: false,
      workAgentError: HELD,
      workAgentSkipReason: 'guardrails',
      workAgentHttpStatus: 507,
      workAgentDeferred: true,
    });
  });

  it('handoff-defers-disk-hold.ac2: deacon-lite retry classifies a 507 diskLow refusal as guardrails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => diskLowResponse()));

    const result = await spawnWorkAgentThroughAgentsEndpoint('PAN-1', 'http://127.0.0.1:3011');

    expect(result).toEqual({ spawned: false, skippedReason: 'guardrails', error: HELD });
  });

  it('handoff-defers-disk-hold.ac3: a 422 stack-unhealthy refusal without diskLow stays stack-unhealthy', async () => {
    const handoff = await completePlanningAutoSpawn({
      issueId: 'PAN-1',
      autoSpawn: true,
      dashboardOrigin: 'http://127.0.0.1:3011',
      readAgentState: () => null,
      fetchImpl: async () => stackUnhealthyResponse(),
    });
    expect(handoff?.workAgentSkipReason).toBe('stack-unhealthy');

    vi.stubGlobal('fetch', vi.fn(async () => stackUnhealthyResponse()));
    const retry = await spawnWorkAgentThroughAgentsEndpoint('PAN-1', 'http://127.0.0.1:3011');
    expect(retry.skippedReason).toBe('stack-unhealthy');
  });
});
