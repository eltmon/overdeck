/**
 * Tests for GET /api/git-activity query param parsing (PAN-653).
 *
 * The route parses ?since, ?issueId, and ?limit from the request URL
 * and passes them as filters to listGitOperations(). This file imports
 * and tests the real parseGitActivityParams() function exported from
 * metrics.ts — any change to the route's parsing logic is covered here.
 *
 * We use the real in-memory DB to verify end-to-end filtering rather than
 * spinning up the Effect HTTP runtime.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseGitActivityParams, mapGitOperationToActivityEntry } from '../../../src/dashboard/server/routes/metrics.js';
import type { GitOperation } from '../../../src/dashboard/server/services/git-activity.js';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../../src/lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-653-git-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('GET /api/git-activity — query param parsing', () => {
  it('defaults limit to 200 when ?limit is absent', () => {
    const { limit } = parseGitActivityParams(new URLSearchParams(''));
    expect(limit).toBe(200);
  });

  it('parses ?limit and uses the provided value', () => {
    const { limit } = parseGitActivityParams(new URLSearchParams('limit=50'));
    expect(limit).toBe(50);
  });

  it('clamps ?limit to 500 maximum', () => {
    const { limit } = parseGitActivityParams(new URLSearchParams('limit=9999'));
    expect(limit).toBe(500);
  });

  it('clamps ?limit to 1 minimum', () => {
    const { limit } = parseGitActivityParams(new URLSearchParams('limit=0'));
    expect(limit).toBe(1);
  });

  it('clamps negative ?limit to 1', () => {
    const { limit } = parseGitActivityParams(new URLSearchParams('limit=-10'));
    expect(limit).toBe(1);
  });

  it('treats non-numeric ?limit as invalid → defaults to 200', () => {
    const { limit } = parseGitActivityParams(new URLSearchParams('limit=abc'));
    expect(limit).toBe(200);
  });

  it('parses ?since correctly', () => {
    const { since } = parseGitActivityParams(new URLSearchParams('since=2026-04-01T00:00:00Z'));
    expect(since).toBe('2026-04-01T00:00:00Z');
  });

  it('returns undefined for ?since when absent', () => {
    const { since } = parseGitActivityParams(new URLSearchParams(''));
    expect(since).toBeUndefined();
  });

  it('parses ?issueId correctly', () => {
    const { issueId } = parseGitActivityParams(new URLSearchParams('issueId=PAN-653'));
    expect(issueId).toBe('PAN-653');
  });

  it('returns undefined for ?issueId when absent', () => {
    const { issueId } = parseGitActivityParams(new URLSearchParams(''));
    expect(issueId).toBeUndefined();
  });

  it('parses all three params together', () => {
    const result = parseGitActivityParams(new URLSearchParams('since=2026-04-01T00%3A00%3A00Z&issueId=PAN-1&limit=25'));
    expect(result.since).toBe('2026-04-01T00:00:00Z');
    expect(result.issueId).toBe('PAN-1');
    expect(result.limit).toBe(25);
  });
});

describe('GET /api/git-activity — end-to-end DB filtering', () => {
  it('?issueId filters results to only matching rows', async () => {
    const { appendGitOperation, listGitOperations } = await import(
      '../../../src/dashboard/server/services/git-activity.js'
    );

    const ts = new Date().toISOString();
    appendGitOperation({ operation: 'push', issueId: 'PAN-1', status: 'success', ts });
    appendGitOperation({ operation: 'fetch', issueId: 'PAN-2', status: 'success', ts });

    const { issueId } = parseGitActivityParams(new URLSearchParams('issueId=PAN-1'));
    const ops = listGitOperations({ issueId });
    expect(ops).toHaveLength(1);
    expect(ops[0].issueId).toBe('PAN-1');
  });

  it('?since filters out rows before the timestamp', async () => {
    const { appendGitOperation, listGitOperations } = await import(
      '../../../src/dashboard/server/services/git-activity.js'
    );

    const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const recent = new Date('2026-04-01T00:00:00.000Z').toISOString();

    appendGitOperation({ operation: 'push', issueId: 'PAN-1', status: 'success', ts: old });
    appendGitOperation({ operation: 'fetch', issueId: 'PAN-1', status: 'success', ts: recent });

    const { since } = parseGitActivityParams(new URLSearchParams('since=2026-03-01T00:00:00Z'));
    const ops = listGitOperations({ since });
    expect(ops).toHaveLength(1);
    expect(ops[0].ts).toBe(recent);
  });

  it('?limit caps the number of rows returned', async () => {
    const { appendGitOperation, listGitOperations } = await import(
      '../../../src/dashboard/server/services/git-activity.js'
    );

    const ts = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      appendGitOperation({ operation: 'push', issueId: `PAN-${i}`, status: 'success', ts });
    }

    const { limit } = parseGitActivityParams(new URLSearchParams('limit=3'));
    const ops = listGitOperations({ limit });
    expect(ops).toHaveLength(3);
  });
});

describe('mapGitOperationToActivityEntry — response shape', () => {
  it('maps a success push to the correct ActivityPanel shape', () => {
    const op: GitOperation = {
      id: 42,
      operation: 'push',
      branch: 'feature/pan-653',
      issueId: 'PAN-653',
      beforeSha: 'abc1234',
      afterSha: 'def5678',
      remoteSha: 'ghi9012',
      status: 'success',
      ts: '2026-04-19T10:00:00.000Z',
    };

    const entry = mapGitOperationToActivityEntry(op);

    expect(entry.id).toBe('git-op-42');
    expect(entry.timestamp).toBe(op.ts);
    expect(entry.source).toBe('git');
    expect(entry.level).toBe('success');
    expect(entry.message).toBe('push: feature/pan-653 [success]');
    expect(entry.details).toBe('before: abc1234\nafter: def5678\nremote: ghi9012');
    expect(entry.issueId).toBe('PAN-653');
    expect(entry.category).toBe('git');
  });

  it('maps a failed fetch to error level with error details', () => {
    const op: GitOperation = {
      operation: 'fetch',
      branch: 'main',
      status: 'failure',
      error: 'network timeout',
      ts: '2026-04-19T11:00:00.000Z',
    };

    const entry = mapGitOperationToActivityEntry(op);

    expect(entry.level).toBe('error');
    expect(entry.message).toBe('fetch: main [failure]');
    expect(entry.details).toBe('error: network timeout');
    expect(entry.issueId).toBeNull();
  });

  it('maps an aborted merge to warn level', () => {
    const op: GitOperation = {
      operation: 'merge',
      branch: 'main',
      status: 'aborted',
      ts: '2026-04-19T12:00:00.000Z',
    };

    const entry = mapGitOperationToActivityEntry(op);

    expect(entry.level).toBe('warn');
    expect(entry.message).toBe('merge: main [aborted]');
    expect(entry.details).toBeNull();
  });

  it('uses ts as fallback id when id is missing', () => {
    const op: GitOperation = {
      operation: 'rev_parse',
      status: 'success',
      ts: '2026-04-19T13:00:00.000Z',
    };

    const entry = mapGitOperationToActivityEntry(op);

    expect(entry.id).toBe('git-op-2026-04-19T13:00:00.000Z');
    expect(entry.message).toBe('rev_parse: ? [success]');
    expect(entry.details).toBeNull();
  });

  it('filters out empty detail fields', () => {
    const op: GitOperation = {
      operation: 'force_push',
      branch: 'main',
      status: 'success',
      afterSha: 'abc1234',
      ts: '2026-04-19T14:00:00.000Z',
    };

    const entry = mapGitOperationToActivityEntry(op);

    expect(entry.details).toBe('after: abc1234');
  });
});
