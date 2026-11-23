/**
 * PAN-5609 WI-4: the conversation-search full-reindex routes write to the
 * activity tracker instead of a private module variable.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSearchActivitySnapshot } from '@overdeck/contracts';

const mocks = vi.hoisted(() => ({
  stopConversationSearchWatcher: vi.fn(),
  syncConversationSearchWatcher: vi.fn(),
  estimateFullReindexConversationSearchCost: vi.fn(),
  fullReindexConversationSearch: vi.fn(),
}));

const activityState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tracker: null as any,
}));

vi.mock('../../services/conversation-search-watcher.js', () => ({
  stopConversationSearchWatcher: mocks.stopConversationSearchWatcher,
  syncConversationSearchWatcher: mocks.syncConversationSearchWatcher,
}));
vi.mock('../../../../lib/conversation-search/indexer.js', () => ({
  estimateFullReindexConversationSearchCost: mocks.estimateFullReindexConversationSearchCost,
  fullReindexConversationSearch: mocks.fullReindexConversationSearch,
}));
vi.mock('../../services/conversation-search-activity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/conversation-search-activity.js')>();
  return {
    ...actual,
    conversationSearchActivity: {
      beginBatch: (...args: Parameters<typeof actual.conversationSearchActivity.beginBatch>) => activityState.tracker.beginBatch(...args),
      setQueue: (...args: Parameters<typeof actual.conversationSearchActivity.setQueue>) => activityState.tracker.setQueue(...args),
      recordIncrementalFile: (...args: Parameters<typeof actual.conversationSearchActivity.recordIncrementalFile>) => activityState.tracker.recordIncrementalFile(...args),
      recordIncrementalError: (...args: Parameters<typeof actual.conversationSearchActivity.recordIncrementalError>) => activityState.tracker.recordIncrementalError(...args),
      resetQueue: (...args: Parameters<typeof actual.conversationSearchActivity.resetQueue>) => activityState.tracker.resetQueue(...args),
      getSnapshot: () => activityState.tracker.getSnapshot(),
    },
  };
});
vi.mock('../../../../lib/internal-token.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/internal-token.js')>()),
  getInternalToken: () => 'test-internal-token',
}));

import { createConversationSearchActivityTracker } from '../../services/conversation-search-activity.js';
import { conversationSearchReindexRouteLayer } from '../conversation-search-reindex.js';
import { INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';

const EMPTY_RESULT = { filesScanned: 0, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0, sessionsPruned: 0, errors: [], disabled: false };
const EMPTY_ESTIMATE = { provider: 'openai' as const, model: 'text-embedding-3-small', tokenCount: 0, pricePerMillionTokens: 0, estimatedUsd: 0, filesScanned: 0, chunksEstimated: 0, disabled: false };

async function call(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...headers, 'content-type': 'application/json' };
  }
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(conversationSearchReindexRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: text ? JSON.parse(text) : null };
}

/** The internal-token header bypasses origin/CSRF checks for mutation routes (D-matches dashboard-auth.ts). */
function authHeaders(): Record<string, string> {
  return { [INTERNAL_TOKEN_HEADER]: 'test-internal-token' };
}

beforeEach(() => {
  vi.clearAllMocks();
  activityState.tracker = createConversationSearchActivityTracker({ emit: vi.fn() });
  mocks.stopConversationSearchWatcher.mockResolvedValue(undefined);
  mocks.syncConversationSearchWatcher.mockResolvedValue(undefined);
  mocks.estimateFullReindexConversationSearchCost.mockResolvedValue({ ...EMPTY_ESTIMATE });
  mocks.fullReindexConversationSearch.mockResolvedValue({ ...EMPTY_RESULT });
});

describe('GET /api/settings/conversation-search/reindex-progress', () => {
  it('returns the zero shape before any reindex', async () => {
    const res = await call('GET', '/api/settings/conversation-search/reindex-progress');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ active: false, filesScanned: 0, filesIndexed: 0, chunksIndexed: 0 });
  });

  it('returns active:true with the forwarded counts and a numeric startedAt during the job', async () => {
    let duringJob: unknown;
    mocks.fullReindexConversationSearch.mockImplementation(async ({ onProgress }: { onProgress?: (p: unknown) => void }) => {
      onProgress?.({ filesScanned: 4, filesIndexed: 2, chunksIndexed: 6, currentFile: 'b.jsonl' });
      duringJob = await call('GET', '/api/settings/conversation-search/reindex-progress');
      return { ...EMPTY_RESULT, filesScanned: 4, filesIndexed: 4, chunksIndexed: 6 };
    });

    const res = await call('POST', '/api/settings/conversation-search/reindex', {}, authHeaders());
    expect(res.status).toBe(200);
    expect(duringJob).toMatchObject({
      status: 200,
      json: { active: true, filesScanned: 4, filesIndexed: 2, chunksIndexed: 6, currentFile: 'b.jsonl' },
    });
    expect(typeof (duringJob as { json: { startedAt: number } }).json.startedAt).toBe('number');
  });
});

describe('POST /api/settings/conversation-search/reindex', () => {
  it('begins a full-reindex batch, forwards progress, ends it after resolving, and syncs the watcher after', async () => {
    const progressCalls: unknown[] = [];
    mocks.fullReindexConversationSearch.mockImplementation(async ({ onProgress }: { onProgress?: (p: unknown) => void }) => {
      onProgress?.({ filesScanned: 2, filesIndexed: 2, chunksIndexed: 5 });
      progressCalls.push(activityState.tracker.getSnapshot());
      return { ...EMPTY_RESULT, filesScanned: 2, filesIndexed: 2, chunksIndexed: 5 };
    });

    const res = await call('POST', '/api/settings/conversation-search/reindex', {}, authHeaders());

    expect(res.status).toBe(200);
    expect(mocks.stopConversationSearchWatcher).toHaveBeenCalledTimes(1);
    expect(mocks.syncConversationSearchWatcher).toHaveBeenCalledTimes(1);
    const snapshotDuringJob = progressCalls[0] as ConversationSearchActivitySnapshot;
    expect(snapshotDuringJob.active).toBe(true);
    expect(snapshotDuringJob.kind).toBe('full-reindex');
    expect(snapshotDuringJob.filesIndexed).toBe(2);

    const finalSnapshot = activityState.tracker.getSnapshot();
    expect(finalSnapshot.active).toBe(false);
    expect(finalSnapshot.kind).toBe('full-reindex');
    expect(finalSnapshot.endedAt).not.toBeNull();
  });

  it('records a rejection on the batch and still ends it', async () => {
    mocks.fullReindexConversationSearch.mockRejectedValue(new Error('embedding provider down'));

    const res = await call('POST', '/api/settings/conversation-search/reindex', {}, authHeaders());

    expect(res.status).toBe(500);
    const snapshot = activityState.tracker.getSnapshot();
    expect(snapshot.active).toBe(false);
    expect(snapshot.lastError).toBe('embedding provider down');
    expect(snapshot.endedAt).not.toBeNull();
    expect(mocks.syncConversationSearchWatcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an unauthenticated request before touching the tracker', async () => {
    const res = await call('POST', '/api/settings/conversation-search/reindex', {});
    expect(res.status).toBe(401);
    expect(mocks.fullReindexConversationSearch).not.toHaveBeenCalled();
  });
});
