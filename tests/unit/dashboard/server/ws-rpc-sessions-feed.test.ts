import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { SessionsFeedFacetsSnapshot, SessionsFeedRowSnapshot, WS_METHODS } from '@overdeck/contracts';
import { normalizeSessionsFeedFilter, toSessionsFeedRowSnapshot } from '../../../../src/dashboard/server/services/sessions-feed-rpc.js';
import type { SessionsFeedRow } from '../../../../src/lib/overdeck/sessions-feed.js';

describe('sessions feed websocket RPC contracts', () => {
  it('round-trips listSessionsFeed rows through the contract schema without detailed fields', () => {
    const row: SessionsFeedRow = {
      id: 42,
      source: 'discovered',
      discoveredId: 42,
      jsonlPath: '/tmp/session.jsonl',
      sessionId: 'sess-42',
      workspacePath: '/workspace',
      messageCount: 12,
      firstTs: '2026-07-03T12:00:00.000Z',
      lastTs: '2026-07-03T12:30:00.000Z',
      primaryModel: 'claude-opus-4',
      tokenInput: 100,
      tokenOutput: 25,
      estimatedCost: 0.12,
      tags: ['pan-1917'],
      summary: 'Unified feed row',
      enrichmentLevel: 2,
      enrichmentFailed: false,
      overdeckManaged: false,
      panIssueId: 'PAN-1917',
      archivedAt: null,
      conversationId: 'conv-1',
      conversationName: 'pan-1917-feed',
      conversationTitle: 'Feed work',
      harness: 'claude-code',
    };

    const snapshot = toSessionsFeedRowSnapshot(row);
    const decoded = Schema.decodeUnknownSync(SessionsFeedRowSnapshot)(snapshot);

    expect(decoded).toEqual(snapshot);
    expect(Object.prototype.hasOwnProperty.call(snapshot, 'summaryDetailed')).toBe(false);
    expect(snapshot).not.toHaveProperty('toolsUsed');
    expect(snapshot).not.toHaveProperty('filesTouched');
  });

  it('round-trips getSessionsFeedFacets through the contract schema', () => {
    const facets = {
      primaryModels: [{ value: 'claude-opus-4', count: 2 }],
      tags: [{ value: 'pan-1917', count: 1 }],
      tools: [{ value: 'Read', count: 4 }],
      files: [{ value: 'src/lib/overdeck/sessions-feed.ts', count: 1 }],
      enrichmentLevels: [{ value: 2, count: 3 }],
      timeBuckets: [{ value: '24h', count: 2 }],
      costBuckets: [{ value: '<$0.10', count: 5 }],
      sources: [{ value: 'managed-archived', count: 1 }],
    };

    expect(Schema.decodeUnknownSync(SessionsFeedFacetsSnapshot)(facets)).toEqual(facets);
  });

  it('registers feed RPC names and worker job operations', () => {
    expect(WS_METHODS.listSessionsFeed).toBe('pan.listSessionsFeed');
    expect(WS_METHODS.getSessionsFeedFacets).toBe('pan.getSessionsFeedFacets');

    const workerTask = readFileSync('src/dashboard/server/services/dashboard-db-task.ts', 'utf8');
    const workerThread = readFileSync('src/dashboard/server/services/dashboard-db-worker.ts', 'utf8');
    for (const source of [workerTask, workerThread]) {
      expect(source).toContain("'listSessionsFeed'");
      expect(source).toContain("'getSessionsFeedFacets'");
      expect(source).toContain('return listSessionsFeed(payload as SessionsFeedFilter)');
      expect(source).toContain('return getSessionsFeedFacets(payload as SessionsFeedFilter)');
    }
  });

  it('preserves keyword query through the feed RPC normalizer', () => {
    const filter = normalizeSessionsFeedFilter({
      query: 'managed archived needle',
      source: 'managed-archived',
      limit: 100,
    });

    expect(filter.query).toBe('managed archived needle');
    expect(filter.source).toBe('managed-archived');
    expect(filter.limit).toBe(100);
  });
});
