import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { parseRelativeTime, cosineSimilarity, searchSessions } from '../search.js';
import { upsertDiscoveredSession, updateEnrichment, insertEmbedding, topKCosine } from '../../database/discovered-sessions-db.js';

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

  it('filter by workspacePath returns matching sessions', async () => {
    const result = await searchSessions({ filter: { workspacePath: '/home/user/Projects/alpha' } });
    expect(result.mode).toBe('filter');
    expect(result.sessions.length).toBe(2);
    expect(result.sessions.every((s) => s.workspacePath === '/home/user/Projects/alpha')).toBe(true);
  });

  it('filter by minCost excludes cheap sessions', async () => {
    const result = await searchSessions({ filter: { minCost: 0.10 } });
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].estimatedCost).toBeGreaterThanOrEqual(0.10);
  });

  it('no q and no filter returns all sessions', async () => {
    const result = await searchSessions({});
    expect(result.mode).toBe('filter');
    expect(result.sessions.length).toBe(3);
  });

  it('limit is respected', async () => {
    const result = await searchSessions({ limit: 2 });
    expect(result.sessions.length).toBeLessThanOrEqual(2);
  });

  it('since filter with relative time excludes old sessions', async () => {
    // All seeded sessions have ts=2025-01-01, which is before "7d" ago from ~now
    const result = await searchSessions({ filter: { since: '7d' } });
    // These sessions are from 2025-01-01, which is in the past well beyond 7 days
    // since we're in 2026, so they should NOT be found
    expect(result.sessions.length).toBe(0);
  });

  it('filter by tag returns only matching sessions', async () => {
    const result = await searchSessions({ filter: { tags: ['large'] } });
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].tags).toContain('large');
  });

  it('filter total reflects unpaginated match count (not page size)', async () => {
    // 3 sessions seeded in beforeEach; request page of 1
    const result = await searchSessions({ limit: 1, offset: 0 });
    expect(result.sessions.length).toBe(1);
    expect(result.total).toBe(3); // true count, not the page
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
    const result = await searchSessions({ filter: { since: '2h' } });
    expect(result.sessions.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── FTS total accuracy (not bounded by over-fetch cap) ───────────────────────

describe('FTS total is not derived from the capped candidate slice', () => {
  beforeEach(async () => {
    // Seed 5 sessions all with the same distinctive keyword in their summaries
    for (let i = 1; i <= 5; i++) {
      const s = upsertDiscoveredSession({
        jsonlPath: `/fts-total/${i}.jsonl`,
        workspacePath: `/home/user/Projects/proj${i}`,
        workspaceHash: `hfts${i}`,
        messageCount: 2,
        firstTs: '2025-01-01T00:00:00Z',
        lastTs: '2025-01-01T01:00:00Z',
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
        fileMtime: '2025-01-01T00:00:00Z',
        tags: [],
      });
      updateEnrichment(s.id, {
        enrichmentLevel: 1,
        enrichmentModel: 'claude-haiku-4-5',
        summary: `cache eviction bugfix in session ${i}`,
      });
    }
  });

  it('FTS total reflects true match count, not the paginated slice', async () => {
    // Request only 2 of the 5 matching sessions
    const result = await searchSessions({ q: 'cache eviction bugfix', limit: 2, offset: 0 });
    expect(result.sessions.length).toBeLessThanOrEqual(2);
    // total must be 5 (all matching sessions), not 2 (page size)
    expect(result.total).toBe(5);
  });

  it('FTS with filter: total uses true intersection count, not over-fetch cap', async () => {
    // Only 3 of the 5 sessions are in proj1/proj2/proj3 workspaces
    const result = await searchSessions({
      q: 'cache eviction bugfix',
      filter: { workspacePath: '/home/user/Projects/proj1' },
      limit: 1,
      offset: 0,
    });
    expect(result.sessions.length).toBeLessThanOrEqual(1);
    // total = sessions matching both the FTS query AND the workspace filter
    expect(result.total).toBe(1);
  });
});

// ─── FTS/semantic+FTS pagination with non-zero offset ─────────────────────────

describe('FTS pagination with non-zero offset', () => {
  beforeEach(async () => {
    // Seed 8 sessions with the same keyword so FTS matches all of them
    for (let i = 1; i <= 8; i++) {
      const s = upsertDiscoveredSession({
        jsonlPath: `/fts-page/${i}.jsonl`,
        workspacePath: `/home/user/Projects/page${i}`,
        workspaceHash: `hpg${i}`,
        messageCount: 2,
        firstTs: '2025-03-01T00:00:00Z',
        lastTs: '2025-03-01T01:00:00Z',
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
        fileMtime: '2025-03-01T00:00:00Z',
        tags: [],
      });
      updateEnrichment(s.id, {
        enrichmentLevel: 1,
        enrichmentModel: 'claude-haiku-4-5',
        summary: `pagination regression test session ${i}`,
      });
    }
  });

  it('page 2 (offset=3, limit=3) returns 3 distinct results', async () => {
    const page1 = await searchSessions({ q: 'pagination regression test', limit: 3, offset: 0 });
    const page2 = await searchSessions({ q: 'pagination regression test', limit: 3, offset: 3 });

    expect(page1.sessions.length).toBe(3);
    expect(page2.sessions.length).toBe(3);
    // No overlap between pages
    const ids1 = new Set(page1.sessions.map((s) => s.id));
    const ids2 = new Set(page2.sessions.map((s) => s.id));
    const overlap = [...ids1].filter((id) => ids2.has(id));
    expect(overlap.length).toBe(0);
  });

  it('total is consistent across pages', async () => {
    const page1 = await searchSessions({ q: 'pagination regression test', limit: 3, offset: 0 });
    const page2 = await searchSessions({ q: 'pagination regression test', limit: 3, offset: 3 });
    expect(page1.total).toBe(8);
    expect(page2.total).toBe(8);
  });

  it('last page returns remaining items without truncation', async () => {
    // 8 sessions, limit=5 → page 2 starts at offset=5, should return 3
    const page2 = await searchSessions({ q: 'pagination regression test', limit: 5, offset: 5 });
    expect(page2.sessions.length).toBe(3);
    expect(page2.total).toBe(8);
  });
});

// ─── Similar-session pagination ───────────────────────────────────────────────

describe('similar-session search paginates after excluding the reference session', () => {
  const MODEL = 'text-embedding-3-small';

  it('rejects semantic result windows that would require large heap materialization', () => {
    expect(() => topKCosine(new Float32Array([1, 0]), MODEL, {}, 50, 1_000)).toThrow(/Semantic search result window exceeds 1000/);
  });

  function seedEmbeddedSession(index: number, vector: number[], lastTs: string) {
    const s = upsertDiscoveredSession({
      jsonlPath: `/semantic-window/${index}.jsonl`,
      workspacePath: '/home/user/Projects/semantic-window',
      workspaceHash: `hsemanticwindow${index}`,
      messageCount: 2,
      firstTs: '2025-01-01T00:00:00Z',
      lastTs,
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
      fileMtime: '2025-01-01T00:00:00Z',
      tags: [],
    });
    insertEmbedding(s.id, MODEL, new Float32Array(vector));
    return s;
  }

  beforeEach(async () => {
    const vectors = [
      [1, 0],
      [0.99, 0.01],
      [0.98, 0.02],
      [0.97, 0.03],
      [0.96, 0.04],
      [0.95, 0.05],
    ];
    for (let i = 0; i < vectors.length; i++) {
      const s = upsertDiscoveredSession({
        jsonlPath: `/semantic-page/${i}.jsonl`,
        workspacePath: '/home/user/Projects/semantic-page',
        workspaceHash: `hsemantic${i}`,
        messageCount: 2,
        firstTs: '2025-04-01T00:00:00Z',
        lastTs: '2025-04-01T01:00:00Z',
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
        fileMtime: '2025-04-01T00:00:00Z',
        tags: [],
      });
      insertEmbedding(s.id, MODEL, new Float32Array(vectors[i]));
    }
  });

  it('returns non-overlapping pages after the reference is removed', async () => {
    const page1 = await searchSessions({ similarTo: 1, embeddingModel: MODEL, limit: 2, offset: 0 });
    const page2 = await searchSessions({ similarTo: 1, embeddingModel: MODEL, limit: 2, offset: 2 });

    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.sessions.every((s) => s.id !== 1)).toBe(true);
    expect(page2.sessions.every((s) => s.id !== 1)).toBe(true);
    const ids1 = new Set(page1.sessions.map((s) => s.id));
    expect(page2.sessions.some((s) => ids1.has(s.id))).toBe(false);
  });

  it('ranks semantic matches across the full filtered corpus, not a recency window', async () => {
    await resetDb();
    const reference = seedEmbeddedSession(10_000, [1, 0], '2025-06-01T00:00:00Z');
    const bestOlderMatch = seedEmbeddedSession(20_000, [0.999, 0.001], '2024-01-01T00:00:00Z');

    for (let i = 0; i < 205; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      seedEmbeddedSession(i, [0, 1], `2025-05-${day}T00:00:00Z`);
    }

    const result = await searchSessions({
      similarTo: reference.id,
      embeddingModel: MODEL,
      filter: { workspacePath: '/home/user/Projects/semantic-window' },
      limit: 1,
    });

    expect(result.sessions[0]?.id).toBe(bestOlderMatch.id);
  });
});

// ─── Strategy 4: semantic+FTS with filter (regression for PAN-457 review) ─────

describe('semantic+FTS search respects filter constraints', () => {
  const MODEL = 'text-embedding-3-small';

  beforeEach(async () => {
    // Seed 4 sessions: 2 in workspace-A, 2 in workspace-B
    // All share a distinctive keyword in summaries
    for (let i = 1; i <= 4; i++) {
      const workspace = i <= 2 ? '/home/user/Projects/workspace-A' : '/home/user/Projects/workspace-B';
      const s = upsertDiscoveredSession({
        jsonlPath: `/semantic-filter/${i}.jsonl`,
        workspacePath: workspace,
        workspaceHash: `hsf${i}`,
        messageCount: 3,
        firstTs: '2025-02-01T00:00:00Z',
        lastTs: '2025-02-01T01:00:00Z',
        modelsUsed: ['claude-sonnet-4-6'],
        primaryModel: 'claude-sonnet-4-6',
        tokenInput: 100,
        tokenOutput: 200,
        estimatedCost: 0.01,
        toolsUsed: [],
        filesTouched: [],
        panopticonManaged: false,
        panIssueId: null,
        panAgentId: null,
        fileSize: 512,
        fileMtime: '2025-02-01T00:00:00Z',
        tags: [],
      });
      updateEnrichment(s.id, {
        enrichmentLevel: 1,
        enrichmentModel: 'claude-haiku-4-5',
        summary: `tokenizer refactor session ${i}`,
      });
      // Insert a simple embedding so semantic re-ranking can run
      const emb = new Float32Array(4).fill(i * 0.1);
      insertEmbedding(s.id, MODEL, emb);
    }
  });

  it('filter excludes sessions outside requested workspace', async () => {
    // similarTo=session 1 (workspace-A); q matches all 4; filter restricts to workspace-A
    const result = await searchSessions({
      q: 'tokenizer refactor',
      similarTo: 1,
      embeddingModel: MODEL,
      filter: { workspacePath: '/home/user/Projects/workspace-A' },
    });
    expect(result.mode).toBe('semantic+fts');
    expect(result.sessions.length).toBeGreaterThanOrEqual(1);
    expect(result.sessions.every((s) => s.workspacePath === '/home/user/Projects/workspace-A')).toBe(true);
  });

  it('total reflects filtered intersection, not global FTS count', async () => {
    const result = await searchSessions({
      q: 'tokenizer refactor',
      similarTo: 1,
      embeddingModel: MODEL,
      filter: { workspacePath: '/home/user/Projects/workspace-A' },
    });
    // Only 2 of 4 sessions are in workspace-A
    expect(result.total).toBe(2);
  });
});
