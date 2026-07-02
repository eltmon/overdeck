import { describe, expect, it, vi } from 'vitest';
import { handleTieredCallout, type TieredCalloutBody } from '../../../../src/dashboard/server/routes/tiered-callouts.js';
import type { VBriefItem } from '../../../../src/lib/vbrief/types.js';

const BASE_CALLOUT: TieredCalloutBody = {
  issueId: 'PAN-2222',
  sha: 'abcdef1234567890',
  beadId: 'bead-1',
  tierName: 'cheap',
  agentId: 'agent-pan-2222-cheap',
  claim: 'The commit appears to miss the acceptance criteria.',
};

const ITEM: VBriefItem = {
  id: 'bead-1',
  title: 'Bead one',
  status: 'running',
  metadata: { difficulty: 'simple' },
};

function deps(policy: 'notify' | 'corroborate' | 'off' = 'notify') {
  return {
    loadConfig: vi.fn(() => ({
      enabled: true,
      feed: { callouts: policy },
    })),
    loadPlanMetadata: vi.fn(() => ({})),
    getWorkspacePath: vi.fn(() => '/tmp/workspace'),
    getItem: vi.fn(() => ITEM),
    recordCallout: vi.fn(),
    surfaceCallout: vi.fn().mockResolvedValue(undefined),
    deliverSupervisorReview: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('handleTieredCallout', () => {
  it('notify records and surfaces the callout without supervisor delivery', async () => {
    const d = deps('notify');

    const result = await handleTieredCallout(BASE_CALLOUT, d);

    expect(result).toEqual({ status: 200, body: { ok: true, policy: 'notify', supervisorDeliveries: 0 } });
    expect(d.recordCallout).toHaveBeenCalledWith(BASE_CALLOUT);
    expect(d.surfaceCallout).toHaveBeenCalledWith(BASE_CALLOUT);
    expect(d.deliverSupervisorReview).not.toHaveBeenCalled();
  });

  it('corroborate records and sends exactly one supervisor review for the sha', async () => {
    const d = deps('corroborate');

    const result = await handleTieredCallout(BASE_CALLOUT, d);

    expect(result).toEqual({ status: 200, body: { ok: true, policy: 'corroborate', supervisorDeliveries: 1 } });
    expect(d.recordCallout).toHaveBeenCalledTimes(1);
    expect(d.deliverSupervisorReview).toHaveBeenCalledTimes(1);
    expect(d.deliverSupervisorReview).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-2222',
      sha: 'abcdef1234567890',
      beadId: 'bead-1',
      item: ITEM,
      workspacePath: '/tmp/workspace',
    }));
  });

  it('rejects disabled tiered execution and malformed bodies', async () => {
    const disabled = deps('notify');
    disabled.loadConfig.mockReturnValue({ enabled: false, feed: { callouts: 'notify' } });

    await expect(handleTieredCallout(BASE_CALLOUT, disabled)).resolves.toMatchObject({ status: 404 });
    await expect(handleTieredCallout({ issueId: 'PAN-2222' }, deps('notify'))).resolves.toMatchObject({ status: 400 });
    expect(disabled.recordCallout).not.toHaveBeenCalled();
    expect(disabled.deliverSupervisorReview).not.toHaveBeenCalled();
  });

  it('does not call dispatch, verdict, or tracker mutation seams on any policy path', async () => {
    const notify = deps('notify');
    const corroborate = deps('corroborate');

    await handleTieredCallout(BASE_CALLOUT, notify);
    await handleTieredCallout(BASE_CALLOUT, corroborate);

    expect(Object.keys(notify)).toEqual([
      'loadConfig',
      'loadPlanMetadata',
      'getWorkspacePath',
      'getItem',
      'recordCallout',
      'surfaceCallout',
      'deliverSupervisorReview',
    ]);
    expect(Object.keys(corroborate)).toEqual(Object.keys(notify));
  });
});
