import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedConversationSearchConfig } from '../../../../lib/config-yaml.js';
import type { ConversationEmbeddingProvider } from '../../../../lib/conversation-search/embedding-provider.js';

vi.mock('../../../../lib/projects.js', () => ({
  listProjectsSync: vi.fn(() => []),
}));

vi.mock('../../../../lib/memory/fts-db.js', () => ({
  runMemoryFtsStatement: vi.fn(),
}));

vi.mock('../../../../lib/config-yaml.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/config-yaml.js')>('../../../../lib/config-yaml.js');
  return {
    ...actual,
    getConversationSearchConfigSync: vi.fn(),
  };
});

vi.mock('../../../../lib/conversation-search/embedding-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/conversation-search/embedding-provider.js')>('../../../../lib/conversation-search/embedding-provider.js');
  return {
    ...actual,
    createConversationEmbeddingProvider: vi.fn(),
  };
});

import { getConversationSearchConfigSync } from '../../../../lib/config-yaml.js';
import { createConversationEmbeddingProvider } from '../../../../lib/conversation-search/embedding-provider.js';
import { runMemoryFtsStatement } from '../../../../lib/memory/fts-db.js';
import { listProjectsSync } from '../../../../lib/projects.js';
import { indexConversationFile } from '../../../../lib/conversation-search/indexer.js';
import { dimensionsForModel, openEmbeddingsDb } from '../../../../lib/database/conversation-embeddings-db.js';
import { closeConversationSearchService } from '../../services/conversation-search-service.js';
import { runPaletteSearch } from '../palette.js';

let tmpDir: string | undefined;

function makeVector(dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions);
  vector[0] = 1;
  return vector;
}

function fakeProvider(dimensions: number): ConversationEmbeddingProvider {
  return {
    provider: 'openai',
    model: 'text-embedding-3-small',
    enabled: true,
    estimateCost: vi.fn(),
    embed: vi.fn(async (texts: string[]) => ({
      embeddings: texts.map(() => makeVector(dimensions)),
      model: 'text-embedding-3-small',
    })),
  };
}

function jsonlMessage(role: string, text: string): string {
  return `${JSON.stringify({
    type: role,
    timestamp: '2026-06-02T01:00:00.000Z',
    message: { role, content: [{ type: 'text', text }] },
  })}\n`;
}

describe('palette conversation search', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-palette-search-'));
    vi.mocked(listProjectsSync).mockReturnValue([]);
    vi.mocked(runMemoryFtsStatement).mockResolvedValue([]);
  });

  afterEach(() => {
    closeConversationSearchService();
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('returns conversation hits from an indexed fixture session', async () => {
    const root = tmpDir!;
    const projectDir = join(root, 'projects', 'panopticon-cli');
    mkdirSync(projectDir, { recursive: true });
    const sessionFile = join(projectDir, 'session-a.jsonl');
    writeFileSync(sessionFile, jsonlMessage('assistant', 'The needle appears in this fixture transcript.'));

    const config: NormalizedConversationSearchConfig = {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(root, 'embeddings.db'),
    };
    const dimensions = dimensionsForModel(config.model);
    const provider = fakeProvider(dimensions);
    vi.mocked(getConversationSearchConfigSync).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider);

    const db = openEmbeddingsDb(config.dbPath, dimensions);
    expect(db.available).toBe(true);
    await indexConversationFile({
      filePath: sessionFile,
      config,
      db,
      provider,
      now: () => '2026-06-02T01:01:00.000Z',
    });
    db.close();

    const result = await runPaletteSearch('needle', 5);

    expect(result.memory).toEqual([]);
    expect(result.observations).toEqual([]);
    expect(result.summaries).toEqual([]);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      sessionId: 'session-a',
      conversationId: 'session-a',
      projectId: 'panopticon-cli',
      role: 'assistant',
    });
    expect(result.conversations[0]?.excerptSegments).toContainEqual({ text: 'needle', match: true });
  });

  it('keeps Phase-1 memory results when conversation search is disabled', async () => {
    const config: NormalizedConversationSearchConfig = {
      enabled: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(tmpDir!, 'embeddings.db'),
    };
    vi.mocked(getConversationSearchConfigSync).mockReturnValue(config);
    vi.mocked(listProjectsSync).mockReturnValue([{ key: 'panopticon-cli' } as ReturnType<typeof listProjectsSync>[number]]);
    vi.mocked(runMemoryFtsStatement).mockResolvedValue([{
      rowid: 7,
      display_content: 'remember the needle',
      doc_type: 'memory',
      source: 'memory-a',
      project_id: 'panopticon-cli',
      workspace_id: '',
      issue_id: '',
      entry_date: '2026-06-02',
      entry_time: '01:00:00',
      tags: 'fixture',
      excerpt: 'remember the ⦇needle⦈',
      bm25: 0.1,
    }]);

    const result = await runPaletteSearch('needle', 5);

    expect(result.conversations).toEqual([]);
    expect(result.memory).toHaveLength(1);
    expect(result.memory[0]).toMatchObject({
      id: 'memory-a',
      projectId: 'panopticon-cli',
      displayContent: 'remember the needle',
    });
    expect(result.memory[0]?.excerptSegments).toContainEqual({ kind: 'match', value: 'needle' });
  });
});
