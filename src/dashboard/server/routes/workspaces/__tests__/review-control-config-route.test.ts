import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  resolveReviewMode: vi.fn(),
  resolveModel: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  readIssueRecordSync: vi.fn(),
  updateIssueRecord: vi.fn(),
}));

vi.mock('../../../../../lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  clearWorkspaceStuck: vi.fn(),
  markWorkspaceStuck: vi.fn(),
  setDeaconIgnored: vi.fn(),
  setAutoMerge: vi.fn(),
  registerReviewVerdictFeedbackDelivery: vi.fn(),
}));

vi.mock('../../../../../lib/agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn(),
}));

vi.mock('../../../../../lib/config-yaml.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../../lib/config-yaml.js')>(),
  resolveModel: routeMocks.resolveModel,
}));

vi.mock('../../../../../lib/pipeline-notifier.js', () => ({
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../../../../../lib/pan-dir/record.js', () => ({
  resolveProjectForIssue: routeMocks.resolveProjectForIssue,
  readIssueRecordSync: routeMocks.readIssueRecordSync,
}));

vi.mock('../../../../../lib/pan-dir/record-update.js', () => ({
  updateIssueRecord: routeMocks.updateIssueRecord,
}));

import { reviewControlRouteLayer } from '../review-control.js';

async function requestReviewConfig(init: RequestInit): Promise<{ status: number; body: unknown }> {
  const request = HttpServerRequest.fromWeb(new Request(
    'http://localhost/api/review/PAN-3552/config',
    init,
  ));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(reviewControlRouteLayer), (app) => app.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      )),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

beforeEach(() => {
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.resolveReviewMode.mockReturnValue('full');
  routeMocks.resolveModel.mockReturnValue('claude-sonnet-4-6');
  routeMocks.resolveProjectForIssue.mockReturnValue({ key: 'overdeck' });
  routeMocks.readIssueRecordSync.mockReturnValue({
    reviewMode: 'full',
    reviewModel: 'claude-sonnet-4-6',
    reReviewScope: 'blockers',
  });
  routeMocks.updateIssueRecord.mockImplementation(async (_project, _issueId, mutate) => {
    const record: Record<string, unknown> = {
      reviewMode: 'full',
      reviewModel: 'claude-sonnet-4-6',
      reReviewScope: 'blockers',
    };
    mutate(record);
    return record;
  });
});

describe('GET/POST /api/review/:issueId/config', () => {
  it('does not project a legacy reReviewScope record field from GET', async () => {
    const result = await requestReviewConfig({ method: 'GET' });

    expect(result).toEqual({
      status: 200,
      body: {
        issueId: 'PAN-3552',
        override: { reviewMode: 'full', reviewModel: 'claude-sonnet-4-6' },
        resolved: { reviewMode: 'full', reviewModel: 'claude-sonnet-4-6' },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain('reReviewScope');
  });

  it('rejects a retired reReviewScope-only POST without persisting it', async () => {
    const result = await requestReviewConfig({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reReviewScope: 'blockers' }),
    });

    expect(result).toEqual({
      status: 400,
      body: { error: 'Provide reviewMode and/or reviewModel (null clears the override)' },
    });
    expect(routeMocks.updateIssueRecord).not.toHaveBeenCalled();
  });
});
