/**
 * #4035 review: the dashboard verdict route journals the verdicts it records,
 * as `pan admin specialists done` does, so a pass posted here starts the next
 * verdict-feedback episode (the relays read the pass count from the journal).
 */
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../../src/lib/internal-token.js';
import { specialistsLegacyRouteLayer } from '../../../../../src/dashboard/server/routes/specialists/legacy-routes.js';
import { EventStoreService } from '../../../../../src/dashboard/server/services/domain-services.js';
import { readPipelineJournal } from '../../../../../src/lib/cloister/pipeline-journal.js';

const PR_URL = 'https://github.com/eltmon/overdeck/pull/4035';

const mocks = vi.hoisted(() => ({
  resolveProject: vi.fn(),
  commentOnArtifact: vi.fn(),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProject,
}));

vi.mock('../../../../../src/lib/forge.js', () => ({
  commentOnArtifact: mocks.commentOnArtifact,
  parseArtifactRef: (url: string) => ({ forge: 'github', url }),
}));

vi.mock('../../../../../src/dashboard/server/services/derived-issue-state.js', () => ({
  getDerivedIssueState: vi.fn(async () => ({ pr: { url: PR_URL }, state: 'in-review' })),
}));

vi.mock('../../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipelineSync: vi.fn() }));

vi.mock('../../../../../src/lib/cloister/specialists.js', () => ({
  getTmuxSessionName: vi.fn(() => 'review-agent-test'),
  updateRunMetadata: vi.fn(),
  makeSpecialistRegistryKey: vi.fn(() => 'review-agent:PAN-4035'),
}));

vi.mock('../../../../../src/lib/cloister/specialist-handoff-logger.js', () => ({
  updateSpecialistHandoffStatus: vi.fn(async () => false),
}));

const eventStoreLayer = Layer.succeed(EventStoreService, {
  append: () => Effect.succeed(1),
  appendAsync: () => Effect.succeed(1),
  readFrom: () => Effect.succeed([]),
  queryByType: () => Effect.succeed([]),
  getLatestSequence: Effect.succeed(0),
  streamEvents: Stream.empty,
});

async function postDone(body: Record<string, unknown>): Promise<number> {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/specialists/done', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: 'test-token' },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(specialistsLegacyRouteLayer), app =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
    ).pipe(Effect.provide(eventStoreLayer)),
  ));
  return response.status;
}

let projectPath: string;
let workspacePath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  projectPath = await mkdtemp(join(tmpdir(), 'pan-4035-route-'));
  workspacePath = join(projectPath, 'workspaces', 'feature-pan-4035');
  await mkdir(workspacePath, { recursive: true });
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  _resetInternalTokenCacheForTests();
  mocks.resolveProject.mockReturnValue({ projectPath, projectKey: 'overdeck' });
  mocks.commentOnArtifact.mockReturnValue(Effect.succeed(undefined));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  await rm(projectPath, { recursive: true, force: true });
});

describe('POST /api/specialists/done journals the verdict (#4035)', () => {
  it('a posted review pass is journaled as an approval', async () => {
    expect(await postDone({ specialist: 'review', issueId: 'pan-4035', status: 'passed', runId: 'run-1' })).toBe(200);

    expect(readPipelineJournal(workspacePath)).toEqual([
      expect.objectContaining({
        type: 'review.verdict',
        issueId: 'PAN-4035',
        source: 'dashboard-specialists-done',
        data: { verdict: 'APPROVED', subRole: 'review', via: 'comment', runId: 'run-1' },
      }),
    ]);
  });

  it('a review verdict that could not be posted is not journaled', async () => {
    mocks.commentOnArtifact.mockReturnValue(Effect.fail(new Error('gh: rate limited')));

    expect(await postDone({ specialist: 'review', issueId: 'PAN-4035', status: 'passed' })).toBe(200);

    expect(readPipelineJournal(workspacePath)).toEqual([]);
  });

  it('a UAT verdict is journaled', async () => {
    expect(await postDone({ specialist: 'uat', issueId: 'PAN-4035', status: 'passed' })).toBe(200);

    expect(readPipelineJournal(workspacePath)).toEqual([
      expect.objectContaining({ type: 'uat.verdict', data: { status: 'passed', subRole: 'uat' } }),
    ]);
  });
});
