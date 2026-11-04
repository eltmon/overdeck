import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessTokensForbiddenError } from '../../sections/accessTokensShared';
import {
  decideMcpSignIn,
  fetchMcpSignInApprovals,
  isMcpOAuthLevel,
  loadMcpSignIns,
  revokeMcpSignIn,
} from '../anywhereApi';

vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mcpOAuthApi (PAN-4946)', () => {
  it('approves a sign-in with a level, and denies with no level key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'approved' }));

    await decideMcpSignIn('id/1', 'approve', 'operate');
    expect(fetchMock).toHaveBeenCalledWith('/api/mcp-oauth/approvals/id%2F1', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' },
      body: JSON.stringify({ decision: 'approve', level: 'operate' }),
    }));

    await decideMcpSignIn('id/1', 'deny');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/mcp-oauth/approvals/id%2F1', expect.objectContaining({
      body: JSON.stringify({ decision: 'deny' }),
    }));
  });

  it('fetchMcpSignInApprovals returns [] on a 403 or a rejected fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden' }));
    await expect(fetchMcpSignInApprovals()).resolves.toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchMcpSignInApprovals()).resolves.toEqual([]);
  });

  it('loadMcpSignIns rejects with AccessTokensForbiddenError on 403', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    await expect(loadMcpSignIns()).rejects.toBeInstanceOf(AccessTokensForbiddenError);
  });

  it('revokeMcpSignIn sends DELETE to the sign-in route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { revoked: true }));

    await revokeMcpSignIn('abc');

    expect(fetchMock).toHaveBeenCalledWith('/api/mcp-oauth/sign-ins/abc', expect.objectContaining({
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' },
    }));
  });

  it('isMcpOAuthLevel accepts the four levels and rejects an unknown one', () => {
    expect(isMcpOAuthLevel('read')).toBe(true);
    expect(isMcpOAuthLevel('message')).toBe(true);
    expect(isMcpOAuthLevel('operate')).toBe(true);
    expect(isMcpOAuthLevel('approve')).toBe(true);
    expect(isMcpOAuthLevel('admin')).toBe(false);
  });
});
