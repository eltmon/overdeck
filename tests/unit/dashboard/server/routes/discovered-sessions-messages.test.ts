import { cp, mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INTERNAL_TOKEN_HEADER, _resetInternalTokenCacheForTests } from '../../../../../src/lib/internal-token.js';
import { discoveredSessionsRouteLayer } from '../../../../../src/dashboard/server/routes/discovered-sessions.js';
import { EventStoreService } from '../../../../../src/dashboard/server/services/domain-services.js';
import type { DiscoveredSession } from '../../../../../src/lib/overdeck/discovered-sessions.js';
import { runDashboardDbJob } from '../../../../../src/dashboard/server/services/dashboard-db-task.js';
import { parseConversationMessages } from '../../../../../src/dashboard/server/services/conversation-service.js';

vi.mock('../../../../../src/dashboard/server/services/dashboard-db-task.js', () => ({
  runDashboardDbJob: vi.fn(),
}));

const parserMocks = vi.hoisted(() => ({
  parseCalls: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/services/conversation-service.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../../src/dashboard/server/services/conversation-service.js')>();
  return {
    ...actual,
    parseConversationMessages: vi.fn(async (...args: Parameters<typeof actual.parseConversationMessages>) => {
      parserMocks.parseCalls(...args);
      return actual.parseConversationMessages(...args);
    }),
  };
});

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'discovered-session-transcript.jsonl',
);

let tempDir: string;
let transcriptPath: string;

function eventStoreLayer() {
  return Layer.succeed(EventStoreService, {
    append: () => Effect.succeed(1),
    readFrom: () => Effect.succeed([]),
    queryByType: () => Effect.succeed([]),
    getLatestSequence: Effect.succeed(0),
    streamEvents: Stream.empty,
  });
}

function baseSession(overrides: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    id: 1,
    jsonlPath: transcriptPath,
    harness: 'claude-code',
    sessionId: 'sess-unmanaged',
    workspacePath: '/workspace',
    workspaceHash: null,
    messageCount: 1,
    firstTs: '2026-07-03T01:00:00.000Z',
    lastTs: '2026-07-03T01:00:00.000Z',
    modelsUsed: [],
    primaryModel: null,
    tokenInput: 0,
    tokenOutput: 0,
    estimatedCost: 0,
    toolsUsed: [],
    filesTouched: [],
    tags: [],
    summary: null,
    summaryDetailed: null,
    conversationId: null,
    conversationName: null,
    conversationTitle: null,
    enrichmentLevel: 0,
    enrichmentModel: null,
    enrichedAt: null,
    enrichmentFailed: false,
    overdeckManaged: false,
    panIssueId: null,
    panAgentId: null,
    fileSize: null,
    fileMtime: null,
    scannedAt: '2026-07-03T01:00:00.000Z',
    ...overrides,
  };
}

async function requestMessages(id: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/discovered-sessions/${id}/messages`, {
    headers: { [INTERNAL_TOKEN_HEADER]: 'test-token' },
  }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(discoveredSessionsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ).pipe(Effect.provide(eventStoreLayer())),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pan-discovered-messages-test-'));
  transcriptPath = join(tempDir, 'session.jsonl');
  await cp(fixturePath, transcriptPath);
  const oldTimestamp = new Date('2026-07-03T01:00:00.000Z');
  await utimes(transcriptPath, oldTimestamp, oldTimestamp);
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-token';
  _resetInternalTokenCacheForTests();
  vi.mocked(runDashboardDbJob).mockReset();
  vi.mocked(parseConversationMessages).mockClear();
  parserMocks.parseCalls.mockClear();
});

afterEach(async () => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe('GET /api/discovered-sessions/:id/messages', () => {
  it('returns fixture JSONL parsed to the messages response shape', async () => {
    vi.mocked(runDashboardDbJob).mockResolvedValue(baseSession());

    const result = await requestMessages(1);

    expect(result.status).toBe(200);
    expect(result.body.messages).toEqual([
      expect.objectContaining({
        id: 'u-1',
        role: 'user',
        text: 'Review this unmanaged transcript.',
      }),
    ]);
    expect(result.body.workLog).toEqual([]);
    expect(result.body.streaming).toBe(false);
  });

  it('returns 404 for a missing discovered-session row', async () => {
    vi.mocked(runDashboardDbJob).mockResolvedValue(null);

    const result = await requestMessages(404);

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Discovered session not found');
  });

  it('returns 409 for managed rows and points at the conversation messages endpoint', async () => {
    vi.mocked(runDashboardDbJob).mockResolvedValue(baseSession({
      conversationId: 'conv-id',
      conversationName: 'managed conversation',
    }));

    const result = await requestMessages(1);

    expect(result.status).toBe(409);
    expect(result.body.redirectTo).toBe('/api/conversations/managed%20conversation/messages');
  });

  it('returns 410 when the transcript file was deleted after discovery', async () => {
    vi.mocked(runDashboardDbJob).mockResolvedValue(baseSession({
      jsonlPath: join(tempDir, 'missing.jsonl'),
    }));

    const result = await requestMessages(1);

    expect(result.status).toBe(410);
    expect(result.body.error).toBe('Transcript file no longer exists on disk');
  });

  it('returns the cached parse on repeated requests for an unchanged file', async () => {
    vi.mocked(runDashboardDbJob).mockResolvedValue(baseSession());

    expect((await requestMessages(1)).status).toBe(200);
    expect((await requestMessages(1)).status).toBe(200);

    expect(parserMocks.parseCalls).toHaveBeenCalledTimes(1);
  });
});
