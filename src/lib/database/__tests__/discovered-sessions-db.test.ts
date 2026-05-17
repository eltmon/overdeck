import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(
    tmpdir(),
    `pan-457-disc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('discovered-sessions-db', () => {
  // ─── CRUD ────────────────────────────────────────────────────────────────

  it('upsertDiscoveredSession inserts a new row and returns it', async () => {
    const { upsertDiscoveredSession } = await import('../discovered-sessions-db.js');
    const session = upsertDiscoveredSession({
      jsonlPath: '/home/user/.claude/projects/-home-user-Projects/sessions/abc.jsonl',
      workspacePath: '/home/user/Projects',
      workspaceHash: '-home-user-Projects',
      messageCount: 10,
      firstTs: '2025-01-01T00:00:00Z',
      lastTs: '2025-01-01T01:00:00Z',
      primaryModel: 'claude-sonnet-4-6',
      modelsUsed: ['claude-sonnet-4-6'],
      tokenInput: 1000,
      tokenOutput: 500,
      estimatedCost: 0.005,
      toolsUsed: ['Read', 'Edit'],
      filesTouched: ['/home/user/Projects/foo.ts'],
    });
    expect(session.id).toBeGreaterThan(0);
    expect(session.jsonlPath).toBe(
      '/home/user/.claude/projects/-home-user-Projects/sessions/abc.jsonl',
    );
    expect(session.workspacePath).toBe('/home/user/Projects');
    expect(session.messageCount).toBe(10);
    expect(session.primaryModel).toBe('claude-sonnet-4-6');
    expect(session.modelsUsed).toEqual(['claude-sonnet-4-6']);
    expect(session.toolsUsed).toEqual(['Read', 'Edit']);
    expect(session.filesTouched).toEqual(['/home/user/Projects/foo.ts']);
    expect(session.enrichmentLevel).toBe(0);
    expect(session.panopticonManaged).toBe(false);
    expect(session.scannedAt).toBeTruthy();
  });

  it('upsertDiscoveredSession is idempotent — re-insert updates without duplicates', async () => {
    const { upsertDiscoveredSession, findDiscoveredSessions } = await import(
      '../discovered-sessions-db.js'
    );
    const path = '/home/user/.claude/projects/-home/sessions/s1.jsonl';
    upsertDiscoveredSession({ jsonlPath: path, messageCount: 5, fileSize: 1000 });
    upsertDiscoveredSession({ jsonlPath: path, messageCount: 10, fileSize: 2000 });
    const all = findDiscoveredSessions();
    expect(all.length).toBe(1);
    expect(all[0].messageCount).toBe(10);
    expect(all[0].fileSize).toBe(2000);
  });

  it('getDiscoveredSessionByJsonlPath returns null for unknown path', async () => {
    const { getDiscoveredSessionByJsonlPath } = await import('../discovered-sessions-db.js');
    expect(getDiscoveredSessionByJsonlPath('/no/such/file.jsonl')).toBeNull();
  });

  it('getDiscoveredSessionById returns the correct session', async () => {
    const { upsertDiscoveredSession, getDiscoveredSessionById } = await import(
      '../discovered-sessions-db.js'
    );
    const inserted = upsertDiscoveredSession({ jsonlPath: '/tmp/a.jsonl' });
    const fetched = getDiscoveredSessionById(inserted.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.jsonlPath).toBe('/tmp/a.jsonl');
  });

  // ─── Filter composition ───────────────────────────────────────────────────

  it('findDiscoveredSessions filters by managed flag', async () => {
    const { upsertDiscoveredSession, findDiscoveredSessions } = await import(
      '../discovered-sessions-db.js'
    );
    upsertDiscoveredSession({ jsonlPath: '/a.jsonl', panopticonManaged: true });
    upsertDiscoveredSession({ jsonlPath: '/b.jsonl', panopticonManaged: false });
    const managed = findDiscoveredSessions({ managed: true });
    expect(managed.length).toBe(1);
    expect(managed[0].panopticonManaged).toBe(true);
    const unmanaged = findDiscoveredSessions({ unmanaged: true });
    expect(unmanaged.length).toBe(1);
    expect(unmanaged[0].panopticonManaged).toBe(false);
  });

  it('findDiscoveredSessions filters by enriched/notEnriched', async () => {
    const { upsertDiscoveredSession, updateEnrichment, findDiscoveredSessions } = await import(
      '../discovered-sessions-db.js'
    );
    const s1 = upsertDiscoveredSession({ jsonlPath: '/enriched.jsonl' });
    upsertDiscoveredSession({ jsonlPath: '/plain.jsonl' });
    updateEnrichment(s1.id, { enrichmentLevel: 1, enrichmentModel: 'claude-haiku-4-5', summary: 'A quick summary' });
    const enriched = findDiscoveredSessions({ enriched: true });
    expect(enriched.length).toBe(1);
    expect(enriched[0].jsonlPath).toBe('/enriched.jsonl');
    const notEnriched = findDiscoveredSessions({ notEnriched: true });
    expect(notEnriched.length).toBe(1);
    expect(notEnriched[0].jsonlPath).toBe('/plain.jsonl');
  });

  it('findDiscoveredSessions filters by minCost and maxCost', async () => {
    const { upsertDiscoveredSession, findDiscoveredSessions } = await import(
      '../discovered-sessions-db.js'
    );
    upsertDiscoveredSession({ jsonlPath: '/cheap.jsonl', estimatedCost: 0.01 });
    upsertDiscoveredSession({ jsonlPath: '/expensive.jsonl', estimatedCost: 5.00 });
    const cheap = findDiscoveredSessions({ maxCost: 0.5 });
    expect(cheap.length).toBe(1);
    expect(cheap[0].jsonlPath).toBe('/cheap.jsonl');
    const expensive = findDiscoveredSessions({ minCost: 1.0 });
    expect(expensive.length).toBe(1);
    expect(expensive[0].jsonlPath).toBe('/expensive.jsonl');
  });

  it('aggregateDiscoveredSessionCostBy groups the full filtered corpus by workspace', async () => {
    const { upsertDiscoveredSession, aggregateDiscoveredSessionCostBy } = await import(
      '../discovered-sessions-db.js'
    );
    upsertDiscoveredSession({
      jsonlPath: '/alpha-1.jsonl',
      workspacePath: '/work/alpha',
      estimatedCost: 0.04,
      tokenInput: 100,
      tokenOutput: 20,
      lastTs: '2026-01-10T00:00:00Z',
    });
    upsertDiscoveredSession({
      jsonlPath: '/alpha-2.jsonl',
      workspacePath: '/work/alpha',
      estimatedCost: 0.03,
      tokenInput: 50,
      tokenOutput: 10,
      lastTs: '2026-01-11T00:00:00Z',
    });
    upsertDiscoveredSession({
      jsonlPath: '/beta.jsonl',
      workspacePath: '/work/beta',
      estimatedCost: 0.20,
      tokenInput: 500,
      tokenOutput: 200,
      lastTs: '2025-12-01T00:00:00Z',
    });

    const summary = aggregateDiscoveredSessionCostBy('workspace', { since: '2026-01-01T00:00:00Z' });

    expect(summary.groupBy).toBe('workspace');
    expect(summary.grandTotal).toBeCloseTo(0.07);
    expect(summary.totalTokensIn).toBe(150);
    expect(summary.totalTokensOut).toBe(30);
    expect(summary.entries).toEqual([
      {
        key: '/work/alpha',
        totalCost: 0.07,
        sessionCount: 2,
        totalTokensIn: 150,
        totalTokensOut: 30,
      },
    ]);
  });

  it('findDiscoveredSessions filters by tags', async () => {
    const { upsertDiscoveredSession, updateEnrichment, findDiscoveredSessions } = await import(
      '../discovered-sessions-db.js'
    );
    const s = upsertDiscoveredSession({ jsonlPath: '/tagged.jsonl' });
    updateEnrichment(s.id, { enrichmentLevel: 1, enrichmentModel: 'test', tags: ['auth', 'security'] });
    upsertDiscoveredSession({ jsonlPath: '/untagged.jsonl' });
    const results = findDiscoveredSessions({ tags: ['auth'] });
    expect(results.length).toBe(1);
    expect(results[0].jsonlPath).toBe('/tagged.jsonl');
  });

  // ─── FTS5 insert/search ───────────────────────────────────────────────────

  it('searchFts returns matching sessions after syncFts', async () => {
    const { upsertDiscoveredSession, syncFts, searchFts } = await import(
      '../discovered-sessions-db.js'
    );
    const s = upsertDiscoveredSession({ jsonlPath: '/fts-test.jsonl' });
    // Manually set summary via DB and sync FTS
    const { getDatabase } = await import('../index.js');
    getDatabase()
      .prepare(`UPDATE discovered_sessions SET summary = ? WHERE id = ?`)
      .run('Fixed a memory leak in the cache layer', s.id);
    syncFts(s.id);
    const results = searchFts('memory leak');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe(s.id);
  });

  it('searchFts returns [] for malformed FTS query instead of throwing', async () => {
    const { searchFts } = await import('../discovered-sessions-db.js');
    // SQLite FTS5 MATCH rejects invalid syntax at runtime; we must not propagate
    const malformed = ['', 'foo OR', '(', 'a:b', '"unclosed', 'AND OR'];
    for (const q of malformed) {
      expect(() => searchFts(q)).not.toThrow();
      expect(searchFts(q)).toEqual([]);
    }
  });

  it('searchFts returns empty array for non-matching query', async () => {
    const { upsertDiscoveredSession, syncFts, searchFts } = await import(
      '../discovered-sessions-db.js'
    );
    const s = upsertDiscoveredSession({ jsonlPath: '/no-match.jsonl' });
    const { getDatabase } = await import('../index.js');
    getDatabase()
      .prepare(`UPDATE discovered_sessions SET summary = ? WHERE id = ?`)
      .run('Refactored authentication module', s.id);
    syncFts(s.id);
    const results = searchFts('database optimization');
    expect(results.length).toBe(0);
  });

  it('updateEnrichment per-row FTS sync: re-enriching a session does not corrupt FTS for other sessions', async () => {
    const { upsertDiscoveredSession, updateEnrichment, searchFts } = await import(
      '../discovered-sessions-db.js'
    );

    // Enrich two sessions with distinct summaries
    const s1 = upsertDiscoveredSession({ jsonlPath: '/fts-session-A.jsonl' });
    const s2 = upsertDiscoveredSession({ jsonlPath: '/fts-session-B.jsonl' });

    updateEnrichment(s1.id, {
      enrichmentLevel: 1,
      enrichmentModel: 'claude-haiku-4-5',
      summary: 'session A: memory leak fix in cache layer',
    });
    updateEnrichment(s2.id, {
      enrichmentLevel: 1,
      enrichmentModel: 'claude-haiku-4-5',
      summary: 'session B: authentication refactor',
    });

    // Both are searchable
    expect(searchFts('memory leak').some((r) => r.id === s1.id)).toBe(true);
    expect(searchFts('authentication refactor').some((r) => r.id === s2.id)).toBe(true);

    // Re-enrich session A with updated summary
    updateEnrichment(s1.id, {
      enrichmentLevel: 2,
      enrichmentModel: 'claude-sonnet-4-6',
      summary: 'session A: database connection pooling',
    });

    // Old summary for A is no longer in FTS
    expect(searchFts('memory leak').some((r) => r.id === s1.id)).toBe(false);
    // New summary for A is in FTS
    expect(searchFts('connection pooling').some((r) => r.id === s1.id)).toBe(true);
    // Session B is untouched
    expect(searchFts('authentication refactor').some((r) => r.id === s2.id)).toBe(true);
  });

  it('upsertDiscoveredSession preserves enriched tags when scanner omits tags', async () => {
    const { upsertDiscoveredSession, updateEnrichment, getDiscoveredSessionByJsonlPath } = await import(
      '../discovered-sessions-db.js'
    );
    const s = upsertDiscoveredSession({ jsonlPath: '/rescan-tags.jsonl', filesTouched: ['old.ts'] });
    updateEnrichment(s.id, {
      enrichmentLevel: 1,
      enrichmentModel: 'test',
      summary: 'Changed auth tags',
      tags: ['auth', 'security'],
    });

    upsertDiscoveredSession({ jsonlPath: '/rescan-tags.jsonl', filesTouched: ['new.ts'], messageCount: 7 });

    const updated = getDiscoveredSessionByJsonlPath('/rescan-tags.jsonl');
    expect(updated?.tags).toEqual(['auth', 'security']);
    expect(updated?.filesTouched).toEqual(['new.ts']);
  });

  it('upsertDiscoveredSession refreshes FTS for enriched rows when files change', async () => {
    const { upsertDiscoveredSession, updateEnrichment, searchFts } = await import(
      '../discovered-sessions-db.js'
    );
    const s = upsertDiscoveredSession({ jsonlPath: '/rescan-fts.jsonl', filesTouched: ['oldtoken.ts'] });
    updateEnrichment(s.id, {
      enrichmentLevel: 1,
      enrichmentModel: 'test',
      summary: 'Keeps the same summary',
      tags: ['stable'],
    });
    expect(searchFts('oldtoken').some((r) => r.id === s.id)).toBe(true);

    upsertDiscoveredSession({ jsonlPath: '/rescan-fts.jsonl', filesTouched: ['newtoken.ts'] });

    expect(searchFts('oldtoken').some((r) => r.id === s.id)).toBe(false);
    expect(searchFts('newtoken').some((r) => r.id === s.id)).toBe(true);
  });

  // ─── Embedding storage round-trip ─────────────────────────────────────────

  it('insertEmbedding and getEmbedding round-trip correctly', async () => {
    const { upsertDiscoveredSession, insertEmbedding, getEmbedding } = await import(
      '../discovered-sessions-db.js'
    );
    const session = upsertDiscoveredSession({ jsonlPath: '/embed-test.jsonl' });
    const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    insertEmbedding(session.id, 'text-embedding-3-small', vec);
    const retrieved = getEmbedding(session.id, 'text-embedding-3-small');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(4);
    expect(retrieved![0]).toBeCloseTo(0.1);
    expect(retrieved![1]).toBeCloseTo(0.2);
    expect(retrieved![2]).toBeCloseTo(0.3);
    expect(retrieved![3]).toBeCloseTo(0.4);
  });

  it('insertEmbedding is idempotent — re-insert overwrites old embedding', async () => {
    const { upsertDiscoveredSession, insertEmbedding, loadEmbeddings } = await import(
      '../discovered-sessions-db.js'
    );
    const session = upsertDiscoveredSession({ jsonlPath: '/embed-overwrite.jsonl' });
    insertEmbedding(session.id, 'text-embedding-3-small', new Float32Array([1.0, 0.0]));
    insertEmbedding(session.id, 'text-embedding-3-small', new Float32Array([0.0, 1.0]));
    const all = loadEmbeddings('text-embedding-3-small');
    expect(all.length).toBe(1);
    expect(all[0].embedding[0]).toBeCloseTo(0.0);
    expect(all[0].embedding[1]).toBeCloseTo(1.0);
  });

  it('insertEmbedding stores only the Float32Array view bytes', async () => {
    const { upsertDiscoveredSession, insertEmbedding, getEmbedding } = await import(
      '../discovered-sessions-db.js'
    );
    const session = upsertDiscoveredSession({ jsonlPath: '/embed-view.jsonl' });
    const backing = new Float32Array([99, 1, 2, 3, 100]);
    const view = new Float32Array(backing.buffer, Float32Array.BYTES_PER_ELEMENT, 3);
    insertEmbedding(session.id, 'text-embedding-3-small', view);
    const retrieved = getEmbedding(session.id, 'text-embedding-3-small');
    expect(Array.from(retrieved ?? [])).toEqual([1, 2, 3]);
  });

  it('getEmbedding returns null for missing model', async () => {
    const { upsertDiscoveredSession, getEmbedding } = await import(
      '../discovered-sessions-db.js'
    );
    const session = upsertDiscoveredSession({ jsonlPath: '/no-embed.jsonl' });
    expect(getEmbedding(session.id, 'text-embedding-3-small')).toBeNull();
  });

  // ─── Stats ────────────────────────────────────────────────────────────────

  it('getDiscoveredStats returns correct counts', async () => {
    const { upsertDiscoveredSession, updateEnrichment, insertEmbedding, getDiscoveredStats } =
      await import('../discovered-sessions-db.js');
    const s1 = upsertDiscoveredSession({ jsonlPath: '/s1.jsonl', panopticonManaged: true });
    upsertDiscoveredSession({ jsonlPath: '/s2.jsonl' });
    updateEnrichment(s1.id, { enrichmentLevel: 1, enrichmentModel: 'haiku', summary: 'test' });
    insertEmbedding(s1.id, 'text-embedding-3-small', new Float32Array([0.5, 0.5]));
    const stats = getDiscoveredStats();
    expect(stats.total).toBe(2);
    expect(stats.enriched).toBe(1);
    expect(stats.embedded).toBe(1);
    expect(stats.managedCount).toBe(1);
  });
});
