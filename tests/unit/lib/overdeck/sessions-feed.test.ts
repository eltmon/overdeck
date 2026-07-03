import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-sessions-feed-test-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  const { resetDiscoveredSessionsSchemaBootstrap } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
  closeOverdeckDatabaseSync();
  resetDiscoveredSessionsSchemaBootstrap();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

async function db() {
  const { getOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  return getOverdeckDatabaseSync();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function setConversationTimes(name: string, createdAt: number, archivedAt: number): Promise<void> {
  (await db()).prepare(`UPDATE conversations SET created_at = ?, archived_at = ? WHERE name = ?`).run(createdAt, archivedAt, name);
}

async function sourceTotals(filter = {}): Promise<Record<string, number>> {
  const { getSessionsFeedFacets } = await import('../../../../src/lib/overdeck/sessions-feed.js');
  return Object.fromEntries(getSessionsFeedFacets(filter).sources.map((bucket) => [bucket.value, bucket.count]));
}

describe('sessions feed', () => {
  it('returns discovered and archived rows in global last_ts/id order', async () => {
    const { createConversation, archiveConversation, updateConversationCost } = await import('../../../../src/lib/overdeck/conversations.js');
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    upsertDiscoveredSession({
      jsonlPath: '/tmp/older.jsonl',
      sessionId: 'sess-older',
      lastTs: iso(base - 10_000),
      firstTs: iso(base - 20_000),
      primaryModel: 'older-model',
    });
    createConversation({
      name: 'archived-newer',
      tmuxSession: 'conv-archived-newer',
      cwd: '/archived',
      claudeSessionId: 'sess-archived-newer',
      model: 'archived-model',
      harness: 'claude-code',
    });
    updateConversationCost('archived-newer', 0.25);
    archiveConversation('archived-newer');
    await setConversationTimes('archived-newer', base - 4_000, base - 1_000);
    upsertDiscoveredSession({
      jsonlPath: '/tmp/middle.jsonl',
      sessionId: 'sess-middle',
      lastTs: iso(base - 5_000),
      firstTs: iso(base - 6_000),
      primaryModel: 'middle-model',
    });

    const page = listSessionsFeed({ limit: 10 });

    expect(page.rows.map((row) => [row.source, row.sessionId])).toEqual([
      ['managed-archived', 'sess-archived-newer'],
      ['discovered', 'sess-middle'],
      ['discovered', 'sess-older'],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('carries conversation refs on discovered rows', async () => {
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    createConversation({
      name: 'managed-discovered-ref',
      tmuxSession: 'conv-managed-discovered-ref',
      cwd: '/managed',
      claudeSessionId: 'sess-managed-discovered-ref',
      title: 'Managed Discovered Ref',
      harness: 'claude-code',
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/managed-discovered-ref.jsonl',
      sessionId: 'sess-managed-discovered-ref',
      lastTs: iso(base - 1_000),
      firstTs: iso(base - 2_000),
    });

    expect(listSessionsFeed({ limit: 10 }).rows[0]).toMatchObject({
      source: 'discovered',
      conversationName: 'managed-discovered-ref',
      conversationTitle: 'Managed Discovered Ref',
    });
  });

  it('walks a keyset cursor exactly once even when newer rows arrive', async () => {
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();
    const seeded = Array.from({ length: 5 }, (_, index) => `sess-${index}`);

    for (const [index, sessionId] of seeded.entries()) {
      upsertDiscoveredSession({
        jsonlPath: `/tmp/${sessionId}.jsonl`,
        sessionId,
        lastTs: iso(base - index * 1_000),
        firstTs: iso(base - index * 1_000 - 100),
      });
    }

    const seen: string[] = [];
    let page = listSessionsFeed({ limit: 2 });
    seen.push(...page.rows.map((row) => row.sessionId!));
    upsertDiscoveredSession({
      jsonlPath: '/tmp/concurrent-newer.jsonl',
      sessionId: 'sess-concurrent-newer',
      lastTs: iso(base + 10_000),
      firstTs: iso(base + 9_000),
    });

    while (page.nextCursor) {
      page = listSessionsFeed({ limit: 2, cursor: page.nextCursor });
      seen.push(...page.rows.map((row) => row.sessionId!));
    }

    expect(seen).toEqual(seeded);
    expect(new Set(seen).size).toBe(seeded.length);
  });

  it('does not skip rows when cursor keys collide across sources', async () => {
    const { createConversation, archiveConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    createConversation({
      name: 'archived-cursor-collision',
      tmuxSession: 'conv-archived-cursor-collision',
      cwd: '/archived',
      claudeSessionId: 'archived-cursor-collision',
      harness: 'claude-code',
    });
    archiveConversation('archived-cursor-collision');
    await setConversationTimes('archived-cursor-collision', base - 2_000, base - 1_000);
    upsertDiscoveredSession({
      jsonlPath: '/tmp/discovered-cursor-collision.jsonl',
      sessionId: 'discovered-cursor-collision',
      lastTs: iso(base - 1_000),
      firstTs: iso(base - 2_000),
    });

    const first = listSessionsFeed({ limit: 1 });
    const second = listSessionsFeed({ limit: 1, cursor: first.nextCursor! });

    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(1);
    expect(new Set([first.rows[0].source, second.rows[0].source])).toEqual(new Set(['discovered', 'managed-archived']));
  });

  it('continues from non-null cursors into null last_ts rows', async () => {
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    upsertDiscoveredSession({
      jsonlPath: '/tmp/non-null-last-ts.jsonl',
      sessionId: 'non-null-last-ts',
      lastTs: iso(base - 1_000),
      firstTs: iso(base - 2_000),
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/null-last-ts.jsonl',
      sessionId: 'null-last-ts',
    });

    const first = listSessionsFeed({ limit: 1 });
    const second = listSessionsFeed({ limit: 1, cursor: first.nextCursor! });

    expect(first.rows[0].sessionId).toBe('non-null-last-ts');
    expect(second.rows[0].sessionId).toBe('null-last-ts');
  });

  it('deduplicates archived conversations over their discovered row and carries discoveredId', async () => {
    const { createConversation, archiveConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    const discovered = upsertDiscoveredSession({
      jsonlPath: '/tmp/dedup.jsonl',
      sessionId: 'sess-dedup',
      workspacePath: '/dedup',
      lastTs: iso(base - 1_000),
      firstTs: iso(base - 2_000),
    });
    createConversation({
      name: 'archived-dedup',
      tmuxSession: 'conv-archived-dedup',
      cwd: '/dedup',
      claudeSessionId: 'sess-dedup',
      title: 'Archived Dedup',
      harness: 'claude-code',
    });
    archiveConversation('archived-dedup');
    await setConversationTimes('archived-dedup', base - 3_000, base - 500);

    const rows = listSessionsFeed({ limit: 10 }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'managed-archived',
      sessionId: 'sess-dedup',
      discoveredId: discovered.id,
      conversationName: 'archived-dedup',
      conversationTitle: 'Archived Dedup',
    });
  });

  it('keyword-searches managed archived rows as part of the unified feed', async () => {
    const { createConversation, archiveConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    createConversation({
      name: 'archived-keyword-target',
      tmuxSession: 'conv-archived-keyword-target',
      cwd: '/archived',
      claudeSessionId: 'sess-archived-keyword-target',
      title: 'Needle Managed Archive',
      harness: 'claude-code',
    });
    archiveConversation('archived-keyword-target');
    await setConversationTimes('archived-keyword-target', base - 2_000, base - 1_000);
    upsertDiscoveredSession({
      jsonlPath: '/tmp/non-matching-discovered.jsonl',
      sessionId: 'non-matching-discovered',
      summary: 'ordinary discovered summary',
      lastTs: iso(base - 500),
      firstTs: iso(base - 1_000),
    });

    const rows = listSessionsFeed({ query: 'needle', limit: 10 }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'managed-archived',
      conversationName: 'archived-keyword-target',
      conversationTitle: 'Needle Managed Archive',
    });
  });

  it('computes facets over the full filtered corpus independently from page size', async () => {
    const { upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { getSessionsFeedFacets, listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    upsertDiscoveredSession({
      jsonlPath: '/tmp/facet-a.jsonl',
      sessionId: 'facet-a',
      primaryModel: 'model-a',
      estimatedCost: 0.05,
      tags: ['alpha'],
      toolsUsed: ['Bash'],
      filesTouched: ['/repo/a.ts'],
      lastTs: iso(base - 1_000),
      firstTs: iso(base - 2_000),
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/facet-b.jsonl',
      sessionId: 'facet-b',
      primaryModel: 'model-a',
      estimatedCost: 2,
      tags: ['alpha', 'beta'],
      toolsUsed: ['Read'],
      filesTouched: ['/repo/b.ts'],
      lastTs: iso(base - 2_000),
      firstTs: iso(base - 3_000),
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/facet-c.jsonl',
      sessionId: 'facet-c',
      primaryModel: 'model-c',
      estimatedCost: 20,
      tags: ['gamma'],
      toolsUsed: ['Write'],
      filesTouched: ['/repo/c.ts'],
      lastTs: iso(base - 40 * 24 * 60 * 60 * 1000),
      firstTs: iso(base - 40 * 24 * 60 * 60 * 1000 - 1_000),
    });

    const page = listSessionsFeed({ limit: 1 });
    const facets = getSessionsFeedFacets();

    expect(page.rows).toHaveLength(1);
    expect(facets.sources).toEqual([{ value: 'discovered', count: 3 }]);
    expect(facets.primaryModels).toContainEqual({ value: 'model-a', count: 2 });
    expect(facets.tags).toContainEqual({ value: 'alpha', count: 2 });
    expect(facets.tools).toContainEqual({ value: 'Bash', count: 1 });
    expect(facets.files).toContainEqual({ value: '/repo/c.ts', count: 1 });
    expect(facets.costBuckets).toEqual([
      { value: '<$0.10', count: 1 },
      { value: '$1-10', count: 1 },
      { value: '>$10', count: 1 },
    ]);
  });

  it('applies every conversation filter field to rows and facets', async () => {
    const { updateEnrichment, upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
    const { listSessionsFeed } = await import('../../../../src/lib/overdeck/sessions-feed.js');
    const base = Date.now();

    const target = upsertDiscoveredSession({
      jsonlPath: '/tmp/filter-target.jsonl',
      harness: 'claude-code',
      sessionId: 'filter-target',
      workspacePath: '/target',
      primaryModel: 'target-model',
      overdeckManaged: true,
      panIssueId: 'PAN-1917',
      messageCount: 12,
      estimatedCost: 2.5,
      tags: ['target-tag'],
      toolsUsed: ['TargetTool'],
      filesTouched: ['/target.ts'],
      lastTs: iso(base - 1_000),
      firstTs: iso(base - 2_000),
    });
    updateEnrichment(target.id, {
      enrichmentLevel: 2,
      enrichmentModel: 'enricher',
      summary: 'target summary',
      tags: ['target-tag'],
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/filter-unmanaged.jsonl',
      harness: 'ohmypi',
      sessionId: 'filter-unmanaged',
      workspacePath: '/other',
      primaryModel: 'other-model',
      messageCount: 1,
      estimatedCost: 0.01,
      tags: ['other-tag'],
      toolsUsed: ['OtherTool'],
      filesTouched: ['/other.ts'],
      lastTs: iso(base - 100_000),
      firstTs: iso(base - 101_000),
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/filter-older.jsonl',
      sessionId: 'filter-older',
      workspacePath: '/old',
      primaryModel: 'old-model',
      messageCount: 4,
      estimatedCost: 12,
      lastTs: iso(base - 20 * 24 * 60 * 60 * 1000),
      firstTs: iso(base - 20 * 24 * 60 * 60 * 1000 - 1_000),
    });

    const cases = [
      { filter: { harness: 'claude-code' }, expected: 2 },
      { filter: { workspacePath: '/target' }, expected: 1 },
      { filter: { primaryModel: 'target-model' }, expected: 1 },
      { filter: { managed: true }, expected: 1 },
      { filter: { unmanaged: true }, expected: 2 },
      { filter: { since: iso(base - 2_000) }, expected: 1 },
      { filter: { before: iso(base - 50_000) }, expected: 2 },
      { filter: { after: iso(base - 3_000) }, expected: 1 },
      { filter: { minCost: 2 }, expected: 2 },
      { filter: { maxCost: 0.5 }, expected: 1 },
      { filter: { minMessages: 10 }, expected: 1 },
      { filter: { tags: ['target-tag'] }, expected: 1 },
      { filter: { tools: ['TargetTool'] }, expected: 1 },
      { filter: { files: ['/target.ts'] }, expected: 1 },
      { filter: { issueId: 'PAN-1917' }, expected: 1 },
      { filter: { enriched: true }, expected: 1 },
      { filter: { notEnriched: true }, expected: 2 },
      { filter: { enrichmentLevel: 2 }, expected: 1 },
      { filter: { enrichmentLevelLessThan: 2 }, expected: 2 },
    ];

    for (const { filter, expected } of cases) {
      const rows = listSessionsFeed({ ...filter, limit: 10 }).rows;
      const totals = await sourceTotals(filter);
      const facetTotal = Object.values(totals).reduce((sum, count) => sum + count, 0);
      expect(rows, JSON.stringify(filter)).toHaveLength(expected);
      expect(facetTotal, JSON.stringify(filter)).toBe(expected);
    }
  });
});
