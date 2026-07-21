import { describe, expect, it, vi } from 'vitest';

import {
  requestStrikeMerge,
  type StrikeMergeRequest,
} from '../../../../src/lib/cloister/deacon-strike-landing.js';
import { INTERNAL_TOKEN_HEADER } from '../../../../src/lib/internal-token.js';

const request: StrikeMergeRequest = {
  kind: 'strike',
  markerHead: 'abc123',
  workspacePath: '/repo/workspaces/feature-pan-2811-strike',
  branchName: 'strike/pan-2811',
  recoveryTarget: 'strike-pan-2811',
};

describe('Deacon strike merge transport', () => {
  it('posts an authenticated request to the dashboard parent and returns its structured result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ success: true, mergeStatus: 'merging' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(requestStrikeMerge('PAN-2811', request, {
      dashboardUrl: 'http://127.0.0.1:3999',
      token: 'shared-token',
      fetchImpl,
    })).resolves.toEqual({ success: true, mergeStatus: 'merging' });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3999/api/internal/strikes/PAN-2811/merge'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:3999',
          [INTERNAL_TOKEN_HEADER]: 'shared-token',
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it('returns a structured merge rejection from the parent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ success: false, error: 'stale strike head' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));

    await expect(requestStrikeMerge('PAN-2811', request, {
      dashboardUrl: 'http://127.0.0.1:3999',
      token: 'shared-token',
      fetchImpl,
    })).resolves.toEqual({ success: false, error: 'stale strike head' });
  });

  it('turns transport failures into a structured result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection refused'));

    await expect(requestStrikeMerge('PAN-2811', request, {
      dashboardUrl: 'http://127.0.0.1:3999',
      token: 'shared-token',
      fetchImpl,
    })).resolves.toEqual({
      success: false,
      error: 'Strike merge request failed: connection refused',
    });
  });
});
