/**
 * Tests for GET /api/git-activity query param parsing (PAN-653).
 *
 * The route parses ?since, ?issueId, and ?limit from the request URL
 * and passes them as filters to listGitOperations(). This file verifies
 * the parsing and forwarding logic mirrors the implementation in
 * src/dashboard/server/routes/metrics.ts:311-345.
 *
 * We use the real in-memory DB to verify end-to-end filtering rather than
 * spinning up the Effect HTTP runtime.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

/**
 * Mirror of the query-param parsing logic in metrics.ts GET /api/git-activity.
 * If you change the route logic, update this helper too.
 */
function parseGitActivityParams(queryString: string): { since?: string; issueId?: string; limit: number } {
  const params = new URLSearchParams(queryString);
  const since   = params.get('since')   ?? undefined;
  const issueId = params.get('issueId') ?? undefined;
  const limitRaw = params.get('limit');
  const limitParsed = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit   = !isNaN(limitParsed) ? Math.min(Math.max(1, limitParsed), 500) : 200;
  return { since, issueId, limit };
}

describe('GET /api/git-activity — query param parsing', () => {
  it('defaults limit to 200 when ?limit is absent', () => {
    const { limit } = parseGitActivityParams('');
    expect(limit).toBe(200);
  });

  it('parses ?limit and uses the provided value', () => {
    const { limit } = parseGitActivityParams('limit=50');
    expect(limit).toBe(50);
  });

  it('clamps ?limit to 500 maximum', () => {
    const { limit } = parseGitActivityParams('limit=9999');
    expect(limit).toBe(500);
  });

  it('clamps ?limit to 1 minimum', () => {
    const { limit } = parseGitActivityParams('limit=0');
    expect(limit).toBe(1);
  });

  it('clamps negative ?limit to 1', () => {
    const { limit } = parseGitActivityParams('limit=-10');
    expect(limit).toBe(1);
  });

  it('treats non-numeric ?limit as invalid → defaults to 200', () => {
    const { limit } = parseGitActivityParams('limit=abc');
    expect(limit).toBe(200);
  });

  it('parses ?since correctly', () => {
    const { since } = parseGitActivityParams('since=2026-04-01T00:00:00Z');
    expect(since).toBe('2026-04-01T00:00:00Z');
  });

  it('returns undefined for ?since when absent', () => {
    const { since } = parseGitActivityParams('');
    expect(since).toBeUndefined();
  });

  it('parses ?issueId correctly', () => {
    const { issueId } = parseGitActivityParams('issueId=PAN-653');
    expect(issueId).toBe('PAN-653');
  });

  it('returns undefined for ?issueId when absent', () => {
    const { issueId } = parseGitActivityParams('');
    expect(issueId).toBeUndefined();
  });

  it('parses all three params together', () => {
    const result = parseGitActivityParams('since=2026-04-01T00%3A00%3A00Z&issueId=PAN-1&limit=25');
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

    const { issueId } = parseGitActivityParams('issueId=PAN-1');
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

    const { since } = parseGitActivityParams('since=2026-03-01T00:00:00Z');
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

    const { limit } = parseGitActivityParams('limit=3');
    const ops = listGitOperations({ limit });
    expect(ops).toHaveLength(3);
  });
});
