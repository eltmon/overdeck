import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const {
  mockInvalidateBoard, mockGetProjectSync, mockSetProjectMergeTrain,
} = vi.hoisted(() => ({
  mockInvalidateBoard: vi.fn(),
  mockGetProjectSync: vi.fn(),
  mockSetProjectMergeTrain: vi.fn(),
}));

vi.mock('../../services/merge-train-board.js', () => ({
  invalidateMergeTrainBoardCache: mockInvalidateBoard,
}));
vi.mock('../../../../lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/projects.js')>()),
  getProjectSync: mockGetProjectSync,
  setProjectMergeTrain: mockSetProjectMergeTrain,
}));
vi.mock('../../../../lib/overdeck/merge-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/merge-sync.js')>()),
  isMergeTrainEnabledForProject: (p: { merge_train?: string | null } | null) => p?.merge_train !== 'disabled',
}));

import { projectsMergeTrainRouteLayer } from '../projects-merge-train.js';
import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../origin-validation.js';
import { getOverdeckHome } from '../../../../lib/paths.js';

const AUTHED = { [INTERNAL_TOKEN_HEADER]: 'test-token' };

async function postMergeTrain(projectKey: string, body: unknown, headers: Record<string, string> = AUTHED) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/projects/${projectKey}/merge-train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(projectsMergeTrainRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

function resetAuth() {
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  rmSync(join(getOverdeckHome(), 'internal-token'), { force: true });
  resetAuth();
  mockGetProjectSync.mockReturnValue({ name: 'overdeck', path: '/repo' });
  mockSetProjectMergeTrain.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  delete process.env.OVERDECK_TRUSTED_ORIGINS;
  resetAuth();
});

/** PAN-5363: the POST drops the board cache after the write, and only after a write. */
describe('POST /api/projects/:projectKey/merge-train', () => {
  it('drops the board cache after writing the override', async () => {
    const res = await postMergeTrain('overdeck', { value: 'disabled' });
    expect(res).toEqual({ status: 200, body: { value: 'disabled', effective: false } });
    expect(mockSetProjectMergeTrain).toHaveBeenCalledWith('overdeck', 'disabled');
    expect(mockInvalidateBoard).toHaveBeenCalledTimes(1);
    expect(mockSetProjectMergeTrain.mock.invocationCallOrder[0])
      .toBeLessThan(mockInvalidateBoard.mock.invocationCallOrder[0]);
  });

  it('clears the override with null and drops the board cache', async () => {
    const res = await postMergeTrain('overdeck', { value: null });
    expect(res).toEqual({ status: 200, body: { value: null, effective: true } });
    expect(mockInvalidateBoard).toHaveBeenCalledTimes(1);
  });

  it('does not drop the board cache when it does not write', async () => {
    const badValue = await postMergeTrain('overdeck', { value: 'off' });
    expect(badValue.status).toBe(400);

    mockGetProjectSync.mockReturnValueOnce(null);
    const unknownProject = await postMergeTrain('nope', { value: 'disabled' });
    expect(unknownProject.status).toBe(404);

    const unauthed = await postMergeTrain('overdeck', { value: 'disabled' }, {});
    expect(unauthed.status).not.toBe(200);

    expect(mockSetProjectMergeTrain).not.toHaveBeenCalled();
    expect(mockInvalidateBoard).not.toHaveBeenCalled();
  });
});
