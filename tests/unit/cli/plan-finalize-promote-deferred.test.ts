/**
 * PAN-4155: a guardrail-deferred work-agent start is reported as deferred, not
 * as a failure, so the planning agent does not run `pan start` itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { promotePlanning } from '../../../src/cli/commands/plan-finalize.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('promotePlanning', () => {
  it('carries a deferred work-agent start through from complete-planning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      workAgentSpawned: false,
      workAgentSkipReason: 'guardrails',
      workAgentError: 'Agent ceiling reached',
      workAgentDeferred: true,
    }), { status: 200 })));

    const result = await promotePlanning('PAN-4155', true);

    expect(result).toMatchObject({
      success: true,
      workAgentSpawned: false,
      workAgentSkipReason: 'guardrails',
      workAgentDeferred: true,
    });
  });

  it('reports no deferral when complete-planning did not journal one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      workAgentSpawned: false,
      workAgentSkipReason: 'guardrails',
      workAgentDeferred: false,
    }), { status: 200 })));

    const result = await promotePlanning('PAN-4155', true);

    expect(result.workAgentDeferred).toBeUndefined();
  });
});
