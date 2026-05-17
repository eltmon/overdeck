import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation } from '@panctl/contracts';
import {
  observationMarkdownPath,
  renderObservationMarkdownLine,
  writeObservation,
} from '../../../src/lib/memory/observations.js';
import { closeMemoryFtsDatabases, withMemoryFtsDatabase } from '../../../src/lib/memory/fts-db.js';
import { readMemoryHealthSnapshot } from '../../../src/lib/memory/health.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

function observation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: 'obs-1',
    timestamp: '2026-05-16T20:33:00.000Z',
    ...identity,
    gitBranch: 'feature/pan-1052',
    sourceTranscriptOffset: 123,
    actionStatus: 'Implemented observation writer',
    narrative: 'The observation writer now persists JSONL and markdown.',
    summary: 'Observation writer persists activity entries.',
    files: ['src/lib/memory/observations.ts'],
    tags: ['handoff'],
    tokens: { prompt: 10, completion: 5, total: 15 },
    model: 'stub-model',
    ...overrides,
  };
}

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-observations-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  closeMemoryFtsDatabases();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('observation writer', () => {
  it('appends observations to date-scoped JSONL and updates the markdown mirror', async () => {
    const entry = observation();
    const result = await writeObservation(entry);

    expect(result).toEqual({
      jsonlPath: join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.jsonl'),
      markdownPath: join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.md'),
    });
    expect(observationMarkdownPath(entry)).toBe(result.markdownPath);

    const jsonl = await readFile(result.jsonlPath, 'utf8');
    expect(jsonl.trim().split('\n').map((line) => JSON.parse(line))).toEqual([entry]);

    const markdown = await readFile(result.markdownPath, 'utf8');
    expect(markdown).toBe(`${renderObservationMarkdownLine(entry)}\n`);
  });

  it('uses O_APPEND for JSONL while keeping markdown mirror idempotent by observation id', async () => {
    const first = observation({ actionStatus: 'First status' });
    const second = observation({ actionStatus: 'Updated status', summary: 'Updated summary.' });

    await writeObservation(first);
    await writeObservation(second);

    const jsonlPath = join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.jsonl');
    const markdownPath = join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.md');

    const jsonlEntries = (await readFile(jsonlPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(jsonlEntries).toHaveLength(2);
    expect(jsonlEntries.map((entry) => entry.actionStatus)).toEqual(['First status', 'Updated status']);

    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('Updated status');
    expect(markdown).not.toContain('First status');
    expect(markdown.match(/<!-- obs:obs-1 -->/g)).toHaveLength(1);

    const files = await readdir(join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations'));
    expect(files.sort()).toEqual(['2026-05-16.jsonl', '2026-05-16.md']);
  });

  it('indexes observations into memory_fts with a JSONL byte-offset back-reference', async () => {
    const entry = observation({
      narrative: 'Narrative details about prompt memory indexing.',
      summary: 'Summary details about prompt memory indexing.',
      tags: ['handoff', 'memory'],
    });

    const result = await writeObservation(entry);

    const ftsRows = await withMemoryFtsDatabase(entry.projectId, (db) => db.prepare(`
      SELECT rowid, content, display_content, source, branch, entry_date, entry_time, entry_type,
             files, tags, doc_type, scope, project_id, workspace_id, issue_id, run_id,
             session_id, agent_role, agent_harness
      FROM memory_fts
      WHERE memory_fts MATCH 'prompt memory indexing'
    `).all() as Array<Record<string, unknown>>);
    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0]).toMatchObject({
      content: 'Narrative details about prompt memory indexing.\n\nSummary details about prompt memory indexing.',
      display_content: 'Summary details about prompt memory indexing.',
      source: 'obs-1',
      branch: 'feature/pan-1052',
      entry_date: '2026-05-16',
      entry_time: '20:33:00.000Z',
      entry_type: 'memory',
      files: 'src/lib/memory/observations.ts',
      tags: 'handoff,memory',
      doc_type: 'observation',
      scope: 'workspace',
      project_id: entry.projectId,
      workspace_id: entry.workspaceId,
      issue_id: entry.issueId,
      run_id: entry.runId,
      session_id: entry.sessionId,
      agent_role: entry.agentRole,
      agent_harness: entry.agentHarness,
    });

    const indexRow = await withMemoryFtsDatabase(entry.projectId, (db) => db.prepare(`
      SELECT id, observation_path_jsonl, byte_offset
      FROM observation_index
      WHERE id = ?
    `).get(entry.id) as { id: string; observation_path_jsonl: string; byte_offset: number });
    expect(indexRow).toEqual({ id: entry.id, observation_path_jsonl: result.jsonlPath, byte_offset: 0 });

    const raw = await readFile(indexRow.observation_path_jsonl, 'utf8');
    const indexedJson = raw.slice(indexRow.byte_offset).split('\n')[0];
    expect(JSON.parse(indexedJson)).toEqual(entry);
  });

  it('does not block JSONL writes when FTS indexing fails and records health', async () => {
    const entry = observation();
    const result = await writeObservation(entry, {
      indexObservation: async () => {
        throw new Error('sqlite unavailable');
      },
    });

    const jsonl = await readFile(result.jsonlPath, 'utf8');
    expect(JSON.parse(jsonl.trim())).toEqual(entry);
    await expect(readFile(result.markdownPath, 'utf8')).resolves.toContain('Implemented observation writer');

    const health = await readMemoryHealthSnapshot(entry);
    expect(health).toMatchObject({
      status: 'degraded',
      last_success: null,
      extractions_attempted: 1,
      extractions_succeeded: 0,
      failed_by_reason: { 'fts-index-failed': 1 },
    });
    expect(health.last_failure).toBeTruthy();
  });

  it('renders summary when actionStatus is null and compacts multiline fields', () => {
    const line = renderObservationMarkdownLine(observation({
      actionStatus: null,
      summary: 'Discussed\nnext steps',
      files: [],
      tags: [],
    }));

    expect(line).toBe('- <!-- obs:obs-1 --> **20:33** Discussed next steps');
  });
});
