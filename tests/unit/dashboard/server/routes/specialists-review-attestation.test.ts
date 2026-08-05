import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { specialistsLegacyRouteLayer } from '../../../../../src/dashboard/server/routes/specialists/legacy-routes.js';
import { EventStoreService } from '../../../../../src/dashboard/server/services/domain-services.js';
import {
  createReviewAgentAttestationToken,
  REVIEW_ATTESTATION_KEY_ENV,
} from '../../../../../src/lib/review-attestation-key.js';

const mocks = vi.hoisted(() => ({
  getProvenance: vi.fn(),
  attestReport: vi.fn(),
}));

vi.mock('../../../../../src/lib/overdeck/agent-review-provenance.js', () => ({
  getReviewArtifactProvenanceSync: mocks.getProvenance,
}));

vi.mock('../../../../../src/lib/cloister/review-artifact-attestation.js', () => ({
  attestReviewReport: mocks.attestReport,
}));

const eventStoreLayer = Layer.succeed(EventStoreService, {
  append: () => Effect.succeed(1),
  appendAsync: () => Effect.succeed(1),
  readFrom: () => Effect.succeed([]),
  queryByType: () => Effect.succeed([]),
  getLatestSequence: Effect.succeed(0),
  streamEvents: Stream.empty,
});

const ISSUE = 'PAN-3511';
const AGENT_ID = 'agent-pan-3511-review';
const RUN_ID = 'agent-pan-3511-review-abcd1234-deadbeef-att1';

async function postAttest(options: {
  token?: string;
  runId?: string;
  verdict?: string;
} = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/specialists/review-artifact/attest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { 'x-overdeck-review-attestation-token': options.token } : {}),
    },
    body: JSON.stringify({
      issueId: ISSUE,
      runId: options.runId ?? RUN_ID,
      verdict: options.verdict ?? 'passed',
    }),
  }));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(specialistsLegacyRouteLayer), app =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
    ).pipe(Effect.provide(eventStoreLayer)),
  ));
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env[REVIEW_ATTESTATION_KEY_ENV] = 'route-test-review-attestation-key-material-123456789';
  mocks.getProvenance.mockReturnValue({ workspace: '/workspace', reviewRunId: RUN_ID });
  mocks.attestReport.mockReturnValue({
    filename: 'synthesis.md',
    verdict: 'passed',
    reviewedHead: 'a'.repeat(40),
  });
});

afterEach(() => {
  delete process.env[REVIEW_ATTESTATION_KEY_ENV];
});

describe('POST /api/specialists/review-artifact/attest', () => {
  it('attests only the active run for a valid run-bound token', async () => {
    const token = createReviewAgentAttestationToken(AGENT_ID, RUN_ID)!;
    const result = await postAttest({ token });

    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        filename: 'synthesis.md',
        verdict: 'passed',
        reviewedHead: 'a'.repeat(40),
      },
    });
    expect(mocks.attestReport).toHaveBeenCalledWith({
      issueId: ISSUE,
      runId: RUN_ID,
      workspacePath: '/workspace',
      expectedVerdict: 'passed',
    });
  });

  it('rejects a token derived for another run', async () => {
    const token = createReviewAgentAttestationToken(AGENT_ID, `${RUN_ID}-other`)!;
    expect(await postAttest({ token })).toMatchObject({ status: 401 });
    expect(mocks.attestReport).not.toHaveBeenCalled();
  });

  it('rejects a run that is not active in the agent read door', async () => {
    const otherRun = `${RUN_ID}-other`;
    const token = createReviewAgentAttestationToken(AGENT_ID, otherRun)!;
    expect(await postAttest({ token, runId: otherRun })).toMatchObject({ status: 409 });
    expect(mocks.attestReport).not.toHaveBeenCalled();
  });

  it('fails closed when context or report attestation cannot be produced', async () => {
    mocks.attestReport.mockImplementation(() => { throw new Error('review context attestation is missing or invalid'); });
    const token = createReviewAgentAttestationToken(AGENT_ID, RUN_ID)!;
    const result = await postAttest({ token });

    expect(result).toEqual({
      status: 409,
      body: { error: 'review context attestation is missing or invalid' },
    });
  });
});
