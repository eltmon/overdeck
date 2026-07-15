import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../../src/lib/internal-token.js';
import { specialistsLegacyRouteLayer } from '../../../../../src/dashboard/server/routes/specialists/legacy-routes.js';
import { EventStoreService } from '../../../../../src/dashboard/server/services/domain-services.js';

const mocks = vi.hoisted(() => ({
  resolveProject: vi.fn(),
  readWorkspacePlan: vi.fn(),
  onInspectComplete: vi.fn(),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProject,
}));

vi.mock('../../../../../src/lib/vbrief/io.js', () => ({
  readWorkspacePlanSync: mocks.readWorkspacePlan,
}));

vi.mock('../../../../../src/lib/cloister/inspect-agent.js', () => ({
  onInspectComplete: mocks.onInspectComplete,
}));

vi.mock('../../../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn(() => 'inspect-agent-test'),
  updateRunMetadata: vi.fn(),
  makeSpecialistRegistryKey: vi.fn(() => 'inspect-agent:PAN-2724'),
}));

vi.mock('../../../../../src/lib/cloister/specialist-handoff-logger.js', () => ({
  updateSpecialistHandoffStatus: vi.fn(() => Effect.succeed(false)),
}));

const eventStoreLayer = Layer.succeed(EventStoreService, {
  append: () => Effect.succeed(1),
  appendAsync: () => Effect.succeed(1),
  readFrom: () => Effect.succeed([]),
  queryByType: () => Effect.succeed([]),
  getLatestSequence: Effect.succeed(0),
  streamEvents: Stream.empty,
});

async function postDone(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/specialists/done', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [INTERNAL_TOKEN_HEADER]: 'test-token',
    },
    body: JSON.stringify(body),
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

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'pan-2724-inspect-'));
  await mkdir(join(projectPath, 'workspaces', 'feature-pan-2724'), { recursive: true });
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  _resetInternalTokenCacheForTests();
  mocks.resolveProject.mockReturnValue({ projectPath, projectKey: 'overdeck' });
  mocks.readWorkspacePlan.mockReturnValue({ plan: { items: [{ id: 'issue-view-model' }] } });
  mocks.onInspectComplete.mockReturnValue(Effect.succeed(undefined));
});

afterEach(async () => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  await rm(projectPath, { recursive: true, force: true });
});

describe('POST /api/specialists/done inspect item attribution', () => {
  it('rejects a passed inspect verdict without itemId', async () => {
    const result = await postDone({ specialist: 'inspect', issueId: 'PAN-2724', status: 'passed', notes: 'looks good' });

    expect(result).toEqual({ status: 400, body: { error: 'itemId is required for a passed inspect verdict' } });
  });

  it('rejects an itemId that is not in the issue vBRIEF', async () => {
    const result = await postDone({ specialist: 'inspect', issueId: 'PAN-2724', itemId: 'by', status: 'passed' });

    expect(result).toEqual({ status: 400, body: { error: 'Item "by" does not exist in the vBRIEF for PAN-2724' } });
    expect(mocks.readWorkspacePlan).toHaveBeenCalledWith(join(projectPath, 'workspaces', 'feature-pan-2724'));
  });

  it('checkpoints the exact structured itemId regardless of notes wording', async () => {
    const result = await postDone({
      specialist: 'inspect',
      issueId: 'PAN-2724',
      itemId: 'issue-view-model',
      status: 'passed',
      notes: 'This predates this bead and is correct',
    });

    expect(result.status).toBe(200);
    expect(mocks.onInspectComplete).toHaveBeenCalledWith(
      'overdeck',
      'PAN-2724',
      'issue-view-model',
      'passed',
      join(projectPath, 'workspaces', 'feature-pan-2724'),
    );
  });
});
