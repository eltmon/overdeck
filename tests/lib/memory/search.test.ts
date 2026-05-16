import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeMemoryFtsDatabases, withMemoryFtsDatabase } from '../../../src/lib/memory/fts-db.js';
import { buildMatchQuery, searchMemory } from '../../../src/lib/memory/search.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-search-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  closeMemoryFtsDatabases();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function insertRow(overrides: Partial<Record<string, string>> = {}) {
  await withMemoryFtsDatabase('panopticon-cli', (db) => db.prepare(`
    INSERT INTO memory_fts (
      content,
      display_content,
      source,
      branch,
      entry_date,
      entry_time,
      entry_type,
      files,
      tags,
      doc_type,
      scope,
      project_id,
      workspace_id,
      issue_id,
      run_id,
      session_id,
      agent_role,
      agent_harness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.content ?? 'memory search observation',
    overrides.display_content ?? overrides.content ?? 'memory search observation',
    overrides.source ?? 'observation',
    overrides.branch ?? 'feature/pan-1052',
    overrides.entry_date ?? '2026-05-16',
    overrides.entry_time ?? '22:00:00.000Z',
    overrides.entry_type ?? 'memory',
    overrides.files ?? 'src/lib/memory/search.ts',
    overrides.tags ?? 'memory,search',
    overrides.doc_type ?? 'observation',
    overrides.scope ?? 'workspace',
    overrides.project_id ?? 'panopticon-cli',
    overrides.workspace_id ?? 'feature-pan-1052',
    overrides.issue_id ?? 'PAN-1052',
    overrides.run_id ?? 'run-1',
    overrides.session_id ?? 'session-1',
    overrides.agent_role ?? 'work',
    overrides.agent_harness ?? 'claude-code',
  ));
}

describe('memory FTS search', () => {
  it('escapes user input into a safe MATCH query', () => {
    expect(buildMatchQuery('memory "quoted" OR tag:review')).toBe('"memory" "quoted" "OR" "tag" "review"');
    expect(buildMatchQuery('   !!!   ')).toBe('');
  });

  it('queries project memory FTS with metadata and BM25 score', async () => {
    await insertRow({ content: 'memory search exact hit', tags: 'memory,search' });
    await insertRow({ content: 'other project memory search', project_id: 'other-project' });
    await insertRow({ content: 'other issue memory search', issue_id: 'PAN-999' });

    const hits = await searchMemory({ query: 'memory search', projectId: 'panopticon-cli', issueId: 'PAN-1052', limit: 5 });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      content: 'memory search exact hit',
      projectId: 'panopticon-cli',
      workspaceId: 'feature-pan-1052',
      issueId: 'PAN-1052',
      tags: ['memory', 'search'],
      files: ['src/lib/memory/search.ts'],
      docType: 'observation',
      scope: 'workspace',
    });
    expect(typeof hits[0]?.bm25).toBe('number');
  });

  it('overfetches three times the requested limit before tag filtering', async () => {
    for (let index = 0; index < 6; index += 1) {
      await insertRow({ content: `ranked memory search ${index}`, tags: index < 4 ? 'memory' : 'memory,keep' });
    }

    const hits = await searchMemory({ query: 'ranked memory', projectId: 'panopticon-cli', tags: ['keep'], limit: 2 });

    expect(hits.map((hit) => hit.tags)).toEqual([['memory', 'keep'], ['memory', 'keep']]);
  });

  it('applies latest reset markers unless includeArchived is set', async () => {
    await insertRow({ content: 'archived memory search', entry_time: '20:00:00.000Z' });
    await insertRow({ content: 'current memory search', entry_time: '22:00:00.000Z' });
    await withMemoryFtsDatabase('panopticon-cli', (db) => db.prepare(`
      INSERT INTO reset_markers (scope, scope_id, from_timestamp, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('issue', 'PAN-1052', '2026-05-16T21:00:00.000Z', 'test reset', '2026-05-16T21:00:00.000Z'));

    expect((await searchMemory({ query: 'memory search', projectId: 'panopticon-cli', issueId: 'PAN-1052' })).map((hit) => hit.content))
      .toEqual(['current memory search']);
    expect((await searchMemory({ query: 'memory search', projectId: 'panopticon-cli', issueId: 'PAN-1052', includeArchived: true })).map((hit) => hit.content).sort())
      .toEqual(['archived memory search', 'current memory search']);
  });
});
