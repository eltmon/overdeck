import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { parseRelativeTime, cosineSimilarity, searchSessions } from '../search.js';
import { upsertDiscoveredSession } from '../../database/discovered-sessions-db.js';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ─── parseRelativeTime ────────────────────────────────────────────────────────

describe('parseRelativeTime', () => {
  const now = new Date('2025-06-15T12:00:00Z');

  it('passes through ISO 8601 dates unchanged', () => {
    const iso = '2025-01-01T00:00:00Z';
    expect(parseRelativeTime(iso, now)).toBe(iso);
  });

  it('"today" → start of UTC today', () => {
    const result = parseRelativeTime('today', now);
    expect(result).toBe('2025-06-15T00:00:00.000Z');
  });

  it('"yesterday" → start of UTC yesterday', () => {
    const result = parseRelativeTime('yesterday', now);
    expect(result).toBe('2025-06-14T00:00:00.000Z');
  });

  it('"7d" → 7 days ago', () => {
    const result = parseRelativeTime('7d', now);
    const expected = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    expect(result).toBe(expected);
  });

  it('"24h" → 24 hours ago', () => {
    const result = parseRelativeTime('24h', now);
    const expected = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    expect(result).toBe(expected);
  });

  it('"30m" → 30 minutes ago', () => {
    const result = parseRelativeTime('30m', now);
    const expected = new Date(now.getTime() - 30 * 60_000).toISOString();
    expect(result).toBe(expected);
  });

  it('"2w" → 14 days ago', () => {
    const result = parseRelativeTime('2w', now);
    const expected = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    expect(result).toBe(expected);
  });

  it('"1mo" → 30 days ago', () => {
    const result = parseRelativeTime('1mo', now);
    const expected = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    expect(result).toBe(expected);
  });

  it('unknown string passes through unchanged', () => {
    expect(parseRelativeTime('whenever', now)).toBe('whenever');
  });
});

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('identical vectors → 1.0', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('orthogonal vectors → 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('opposite vectors → -1', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('zero vector → 0', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('length mismatch → 0', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

// ─── searchSessions (integration) ────────────────────────────────────────────

function seedSession(opts: { id: number; workspace: string; tags?: string[]; cost?: number; ts?: string }) {
  upsertDiscoveredSession({
    jsonlPath: `/fake/${opts.id}.jsonl`,
    workspacePath: opts.workspace,
    workspaceHash: `hash${opts.id}`,
    messageCount: 5,
    firstTs: opts.ts ?? '2025-01-01T00:00:00Z',
    lastTs: opts.ts ?? '2025-01-01T01:00:00Z',
    modelsUsed: ['claude-sonnet-4-6'],
    primaryModel: 'claude-sonnet-4-6',
    tokenInput: 100,
    tokenOutput: 200,
    estimatedCost: opts.cost ?? 0.01,
    toolsUsed: ['Read'],
    filesTouched: [],
    panopticonManaged: false,
    panIssueId: null,
    panAgentId: null,
    fileSize: 1024,
    fileMtime: '2025-01-01T00:00:00Z',
    tags: opts.tags ?? [],
  });
}

describe('searchSessions', () => {
  beforeEach(() => {
    seedSession({ id: 1, workspace: '/home/user/Projects/alpha', tags: ['feat'], cost: 0.01 });
    seedSession({ id: 2, workspace: '/home/user/Projects/beta', tags: ['fix'], cost: 0.05 });
    seedSession({ id: 3, workspace: '/home/user/Projects/alpha', tags: ['feat', 'large'], cost: 0.20 });
  });

  it('filter by workspacePath returns matching sessions', () => {
    const result = searchSessions({ filter: { workspacePath: '/home/user/Projects/alpha' } });
    expect(result.mode).toBe('filter');
    expect(result.sessions.length).toBe(2);
    expect(result.sessions.every((s) => s.workspacePath === '/home/user/Projects/alpha')).toBe(true);
  });

  it('filter by minCost excludes cheap sessions', () => {
    const result = searchSessions({ filter: { minCost: 0.10 } });
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].estimatedCost).toBeGreaterThanOrEqual(0.10);
  });

  it('no q and no filter returns all sessions', () => {
    const result = searchSessions({});
    expect(result.mode).toBe('filter');
    expect(result.sessions.length).toBe(3);
  });

  it('limit is respected', () => {
    const result = searchSessions({ limit: 2 });
    expect(result.sessions.length).toBeLessThanOrEqual(2);
  });

  it('since filter with relative time excludes old sessions', () => {
    // All seeded sessions have ts=2025-01-01, which is before "7d" ago from ~now
    const result = searchSessions({ filter: { since: '7d' } });
    // These sessions are from 2025-01-01, which is in the past well beyond 7 days
    // since we're in 2026, so they should NOT be found
    expect(result.sessions.length).toBe(0);
  });

  it('filter by tag returns only matching sessions', () => {
    const result = searchSessions({ filter: { tags: ['large'] } });
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].tags).toContain('large');
  });

  it('since=yesterday with recent sessions finds them', async () => {
    const { resetDatabase } = await import('../../database/index.js');
    resetDatabase();
    const now = new Date();
    const recentTs = new Date(now.getTime() - 3600_000).toISOString(); // 1 hour ago
    upsertDiscoveredSession({
      jsonlPath: '/fake/recent.jsonl',
      workspacePath: '/home/user/Projects/recent',
      workspaceHash: 'hashrecent',
      messageCount: 2,
      firstTs: recentTs,
      lastTs: recentTs,
      modelsUsed: ['claude-sonnet-4-6'],
      primaryModel: 'claude-sonnet-4-6',
      tokenInput: 50,
      tokenOutput: 100,
      estimatedCost: 0.005,
      toolsUsed: [],
      filesTouched: [],
      panopticonManaged: false,
      panIssueId: null,
      panAgentId: null,
      fileSize: 512,
      fileMtime: recentTs,
      tags: [],
    });
    const result = searchSessions({ filter: { since: 'today' } });
    expect(result.sessions.length).toBeGreaterThanOrEqual(1);
  });
});
