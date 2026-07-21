import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
  const { closeOverdeckDatabaseSync } = await import('../../overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-1866-backlog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('backlog_sequence schema migration (PAN-1866)', { timeout: 30_000 }, () => {
  it('creates backlog_sequence table on fresh init', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();
    const cols = db.prepare("PRAGMA table_info(backlog_sequence)").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('issue_id');
    expect(colNames).toContain('rank');
    expect(colNames).toContain('project_key');
    expect(colNames).toContain('condition');
  });

  it('applies v57 migration on a v56 database without disturbing other tables', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();

    // Force version back to 56 and drop the backlog_sequence table to simulate v56 state
    db.exec('DROP TABLE IF EXISTS backlog_sequence');
    db.pragma('user_version = 56');

    // Re-run migrations
    const { runMigrations } = await import('../schema.js');
    runMigrations(db);

    // backlog_sequence should now exist
    const cols = db.prepare("PRAGMA table_info(backlog_sequence)").all() as Array<{ name: string }>;
    expect(cols.length).toBeGreaterThan(0);

    // review_status should still exist (pre-existing table not disturbed)
    const rsInfo = db.prepare("PRAGMA table_info(review_status)").all() as Array<{ name: string }>;
    expect(rsInfo.length).toBeGreaterThan(0);
  });
});

describe('upsertBacklogSequence full-sync (PAN-2010)', { timeout: 30_000 }, () => {
  const node = (issue: string, rank: number) => ({
    issue, rank, size: 'M', importance: 'high', score: 50,
    condition: 'ok', dependsOn: [], why: 'why', gate: 'auto', planning: 'auto',
  });
  const doc = (nodes: ReturnType<typeof node>[], generatedAt: string) =>
    ({ project: 'p', generatedAt, nodes, edges: [] }) as unknown as import('../../backlog/types.js').SequenceDoc;

  it('purges rows for issues no longer in the sequence (closed / re-sequenced out)', async () => {
    const { upsertBacklogSequence, getBacklogSequence } = await import('../backlog-sequence-db.js');

    upsertBacklogSequence('p', doc([node('PAN-1', 1), node('PAN-2', 2), node('PAN-3', 3)], '2026-01-01T00:00:00Z'));
    expect(getBacklogSequence('p').map((n) => n.issueId).sort()).toEqual(['PAN-1', 'PAN-2', 'PAN-3']);

    // PAN-2 is closed → drops out of the next sequence. It must NOT linger in the cache.
    upsertBacklogSequence('p', doc([node('PAN-1', 1), node('PAN-3', 2)], '2026-01-02T00:00:00Z'));
    const after = getBacklogSequence('p').map((n) => n.issueId).sort();
    expect(after).toEqual(['PAN-1', 'PAN-3']);
    expect(after).not.toContain('PAN-2');
  });

  it('empties the cache for the project when the new sequence has no nodes', async () => {
    const { upsertBacklogSequence, getBacklogSequence } = await import('../backlog-sequence-db.js');
    upsertBacklogSequence('p', doc([node('PAN-1', 1)], '2026-01-01T00:00:00Z'));
    upsertBacklogSequence('p', doc([], '2026-01-02T00:00:00Z'));
    expect(getBacklogSequence('p')).toEqual([]);
  });
});

describe('getBacklogSequenceForRoot epic enrichment (PAN-2081)', { timeout: 30_000 }, () => {
  const node = (issue: string, rank: number, isEpic?: boolean) => ({
    issue, rank, size: 'M', importance: 'high', score: 50,
    condition: 'ok', dependsOn: [], why: 'why', gate: 'auto', planning: 'auto',
    ...(isEpic === undefined ? {} : { isEpic }),
  });

  it('surfaces isEpic from sequence.md while preserving contains edges', async () => {
    const { getBacklogSequenceForRoot } = await import('../backlog-sequence-db.js');
    const projectRoot = join(TEST_HOME, 'project');
    mkdirSync(join(projectRoot, '.pan', 'backlog'), { recursive: true });
    const doc = {
      version: 1,
      project: 'p',
      generatedAt: '2026-01-01T00:00:00Z',
      model: 'test',
      pass: 'creation',
      openCount: 2,
      nodes: [node('PAN-2075', 1, true), node('PAN-2076', 2, false)],
      edges: [{ from: 'PAN-2075', to: 'PAN-2076', type: 'contains', source: 'ai-inferred', confidence: 1 }],
    };
    writeFileSync(
      join(projectRoot, '.pan', 'backlog', 'sequence.md'),
      `# Backlog Sequence\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`,
      'utf-8',
    );

    const result = getBacklogSequenceForRoot(projectRoot);

    expect(result.nodes.map((n) => ({ issueId: n.issueId, isEpic: n.isEpic }))).toEqual([
      { issueId: 'PAN-2075', isEpic: true },
      { issueId: 'PAN-2076', isEpic: false },
    ]);
    expect(result.edges).toEqual([{ from: 'PAN-2075', to: 'PAN-2076', type: 'contains' }]);
  });
});
