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

// PAN-4358 review: palette.ts batch-resolves every distinct root session id
// in one call instead of one getConversationByClaudeSessionId() call per root.
vi.mock('../../../../lib/overdeck/conversation-batch-lookup.js', () => ({
  resolveConversationsByClaudeSessionIds: vi.fn(() => new Map()),
}));

// PAN-4358: title search reads overdeck.db directly; mock it so this suite
// never opens the real DB, and so each test controls its title matches.
vi.mock('../../../../lib/overdeck/conversation-title-search.js', () => ({
  searchConversationTitles: vi.fn(() => []),
}));

vi.mock('../../../../lib/config-yaml.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/config-yaml.js')>('../../../../lib/config-yaml.js');
  return {
    ...actual,
    getConversationSearchConfig: vi.fn(),
  };
});

vi.mock('../../../../lib/conversation-search/embedding-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/conversation-search/embedding-provider.js')>('../../../../lib/conversation-search/embedding-provider.js');
  return {
    ...actual,
    createConversationEmbeddingProvider: vi.fn(),
  };
});

import { getConversationSearchConfig } from '../../../../lib/config-yaml.js';
import { createConversationEmbeddingProvider } from '../../../../lib/conversation-search/embedding-provider.js';
import { runMemoryFtsStatement } from '../../../../lib/memory/fts-db.js';
import { resolveConversationsByClaudeSessionIds } from '../../../../lib/overdeck/conversation-batch-lookup.js';
import { searchConversationTitles } from '../../../../lib/overdeck/conversation-title-search.js';
import { listProjectsSync } from '../../../../lib/projects.js';
import { indexConversationFile } from '../../../../lib/conversation-search/indexer.js';
import { dimensionsForModel, openEmbeddingsDb } from '../../../../lib/database/conversation-embeddings-db.js';
import { closeConversationSearchService } from '../../services/conversation-search-service.js';
import { PAN_COMMANDS, runPaletteSearch } from '../palette.js';

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
  it('no longer offers the deleted reset-to-planned verb (PAN-3917)', () => {
    expect(PAN_COMMANDS.some((c) => c.name.startsWith('pan reset-to-planned'))).toBe(false);
  });

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-palette-search-'));
    vi.mocked(listProjectsSync).mockReturnValue([]);
    vi.mocked(resolveConversationsByClaudeSessionIds).mockClear().mockReturnValue(new Map());
    vi.mocked(runMemoryFtsStatement).mockResolvedValue([]);
    vi.mocked(searchConversationTitles).mockReturnValue([]);
  });

  afterEach(() => {
    closeConversationSearchService();
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('routes conversation hits by explicit project with cwd fallback', async () => {
    const root = tmpDir!;
    const projectDir = join(root, 'projects', 'overdeck');
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
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider);
    vi.mocked(listProjectsSync).mockReturnValue([{
      key: 'overdeck-key',
      config: { name: 'Overdeck', path: 'overdeck' },
    } as ReturnType<typeof listProjectsSync>[number]]);

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
      projectId: 'overdeck',
      projectKey: 'Overdeck',
      parentSessionId: null,
      subagentId: null,
      role: 'assistant',
    });
    expect(result.conversations[0]?.excerptSegments).toContainEqual({ text: 'needle', match: true });

    vi.mocked(resolveConversationsByClaudeSessionIds).mockReturnValue(new Map([
      ['session-a', { name: 'managed-conversation', projectKey: 'target-key', title: null, archived: false }],
    ]));
    vi.mocked(listProjectsSync).mockReturnValue([{
      key: 'target-key',
      config: { name: 'Target Project', path: 'foreign-project' },
    } as ReturnType<typeof listProjectsSync>[number]]);

    const explicitResult = await runPaletteSearch('needle', 5);
    expect(explicitResult.conversations[0]).toMatchObject({
      conversationId: 'managed-conversation',
      projectId: 'overdeck',
      projectKey: 'Target Project',
    });
  });

  it('routes a subagent hit to its parent conversation (PAN-3982)', async () => {
    const root = tmpDir!;
    const parentSessionId = '3f2b1a4c-5d6e-4f70-8a91-b2c3d4e5f607';
    const subagentsDir = join(root, 'projects', 'overdeck', parentSessionId, 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    const subagentFile = join(subagentsDir, 'agent-deadbeef01.jsonl');
    writeFileSync(subagentFile, jsonlMessage('assistant', 'The needle appears in this subagent transcript.'));

    const config: NormalizedConversationSearchConfig = {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(root, 'embeddings.db'),
    };
    const dimensions = dimensionsForModel(config.model);
    const provider = fakeProvider(dimensions);
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider);
    vi.mocked(listProjectsSync).mockReturnValue([{
      key: 'target-key',
      config: { name: 'Target Project', path: 'foreign-project' },
    } as ReturnType<typeof listProjectsSync>[number]]);
    vi.mocked(resolveConversationsByClaudeSessionIds).mockReturnValue(new Map([
      [parentSessionId, { name: 'parent-conv', projectKey: 'target-key', title: null, archived: false }],
    ]));

    const db = openEmbeddingsDb(config.dbPath, dimensions);
    expect(db.available).toBe(true);
    await indexConversationFile({
      filePath: subagentFile,
      config,
      db,
      provider,
      now: () => '2026-06-02T01:01:00.000Z',
    });
    db.close();

    const result = await runPaletteSearch('needle', 5);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      sessionId: 'agent-deadbeef01',
      parentSessionId,
      subagentId: 'deadbeef01',
      conversationId: 'parent-conv',
      projectKey: 'Target Project',
    });

    vi.mocked(resolveConversationsByClaudeSessionIds).mockReturnValue(new Map());
    const unregistered = await runPaletteSearch('needle', 5);
    expect(unregistered.conversations[0]).toMatchObject({
      conversationId: parentSessionId,
      parentSessionId,
      subagentId: 'deadbeef01',
    });
  });

  it('drops conversation hits whose transcript file was deleted after indexing', async () => {
    const root = tmpDir!;
    const projectDir = join(root, 'projects', 'overdeck');
    mkdirSync(projectDir, { recursive: true });
    const sessionFile = join(projectDir, 'session-deleted.jsonl');
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
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
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

    rmSync(sessionFile);

    const result = await runPaletteSearch('needle', 5);
    expect(result.conversations).toEqual([]);
  });

  it('keeps Phase-1 memory results when conversation search is disabled', async () => {
    const config: NormalizedConversationSearchConfig = {
      enabled: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(tmpDir!, 'embeddings.db'),
    };
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(listProjectsSync).mockReturnValue([{ key: 'overdeck' } as ReturnType<typeof listProjectsSync>[number]]);
    vi.mocked(runMemoryFtsStatement).mockResolvedValue([{
      rowid: 7,
      display_content: 'remember the needle',
      doc_type: 'memory',
      source: 'memory-a',
      project_id: 'overdeck',
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
      projectId: 'overdeck',
      displayContent: 'remember the needle',
    });
    expect(result.memory[0]?.excerptSegments).toContainEqual({ kind: 'match', value: 'needle' });
  });

  it('groups two chunk hits from one session into one conversation row with hitCount 2 (PAN-4358)', async () => {
    const root = tmpDir!;
    const projectDir = join(root, 'projects', 'overdeck');
    mkdirSync(projectDir, { recursive: true });
    const sessionFile = join(projectDir, 'session-two-hits.jsonl');
    writeFileSync(
      sessionFile,
      jsonlMessage('assistant', 'The needle appears in the first message.')
      + jsonlMessage('assistant', 'The needle appears again in the second message.'),
    );

    const config: NormalizedConversationSearchConfig = {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(root, 'embeddings.db'),
    };
    const dimensions = dimensionsForModel(config.model);
    const provider = fakeProvider(dimensions);
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider);

    const db = openEmbeddingsDb(config.dbPath, dimensions);
    await indexConversationFile({
      filePath: sessionFile,
      config,
      db,
      provider,
      now: () => '2026-06-02T01:01:00.000Z',
    });
    db.close();

    const result = await runPaletteSearch('needle', 5);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({ conversationId: 'session-two-hits', hitCount: 2 });
  });

  it('resolves every distinct root session id in one batched lookup call, regardless of hit count (PAN-4358 review)', async () => {
    const root = tmpDir!;
    const projectDir = join(root, 'projects', 'overdeck');
    mkdirSync(projectDir, { recursive: true });
    const sessionFiles = ['session-batch-a', 'session-batch-b', 'session-batch-c'].map((name) => {
      const filePath = join(projectDir, `${name}.jsonl`);
      writeFileSync(filePath, jsonlMessage('assistant', `The needle appears in ${name}.`));
      return filePath;
    });

    const config: NormalizedConversationSearchConfig = {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(root, 'embeddings.db'),
    };
    const dimensions = dimensionsForModel(config.model);
    const provider = fakeProvider(dimensions);
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider);

    const db = openEmbeddingsDb(config.dbPath, dimensions);
    for (const filePath of sessionFiles) {
      await indexConversationFile({
        filePath,
        config,
        db,
        provider,
        now: () => '2026-06-02T01:01:00.000Z',
      });
    }
    db.close();

    const result = await runPaletteSearch('needle', 5);
    expect(result.conversations).toHaveLength(3);
    expect(resolveConversationsByClaudeSessionIds).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveConversationsByClaudeSessionIds).mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(['session-batch-a', 'session-batch-b', 'session-batch-c']),
    );
  });

  it('ranks a title-only match first with no message target (PAN-4358)', async () => {
    vi.mocked(getConversationSearchConfig).mockReturnValue({
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(tmpDir!, 'embeddings.db'),
    });
    vi.mocked(searchConversationTitles).mockReturnValue([{
      conversationId: 'title-only-conv',
      projectKey: null,
      title: 'Personal portfolio deployment to GitHub',
      archived: false,
      sessionId: null,
      cwd: '/home/eltmon/Projects/portfolio',
      lastActivityAt: '2026-06-02T00:00:00.000Z',
    }]);

    const result = await runPaletteSearch('portfolio', 5);
    expect(result.conversations[0]).toMatchObject({
      conversationId: 'title-only-conv',
      matchTier: 'title',
      byteOffset: null,
      role: '',
      hitCount: 0,
    });
  });

  it('returns title matches when conversation search is disabled (PAN-4358)', async () => {
    vi.mocked(getConversationSearchConfig).mockReturnValue({
      enabled: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(tmpDir!, 'embeddings.db'),
    });
    vi.mocked(searchConversationTitles).mockReturnValue([{
      conversationId: 'title-only-conv',
      projectKey: null,
      title: 'Personal portfolio deployment to GitHub',
      archived: false,
      sessionId: null,
      cwd: '/home/eltmon/Projects/portfolio',
      lastActivityAt: '2026-06-02T00:00:00.000Z',
    }]);

    const result = await runPaletteSearch('portfolio', 5);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({ conversationId: 'title-only-conv', matchTier: 'title' });
  });

  it('carries archived: true and the title from the batched conversation lookup (PAN-4358)', async () => {
    const root = tmpDir!;
    const projectDir = join(root, 'projects', 'overdeck');
    mkdirSync(projectDir, { recursive: true });
    const sessionFile = join(projectDir, 'session-archived.jsonl');
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
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider);
    vi.mocked(resolveConversationsByClaudeSessionIds).mockReturnValue(new Map([
      ['session-archived', { name: 'session-archived', projectKey: null, title: 'T', archived: true }],
    ]));

    const db = openEmbeddingsDb(config.dbPath, dimensions);
    await indexConversationFile({
      filePath: sessionFile,
      config,
      db,
      provider,
      now: () => '2026-06-02T01:01:00.000Z',
    });
    db.close();

    const result = await runPaletteSearch('needle', 5);
    expect(result.conversations[0]).toMatchObject({ archived: true, title: 'T' });
  });

  it('ranks a prose match above a path-only match (PAN-4358 AC3)', async () => {
    const root = tmpDir!;
    const projectDir = join(root, 'projects', 'overdeck');
    mkdirSync(projectDir, { recursive: true });
    const pathSessionFile = join(projectDir, 'session-path.jsonl');
    writeFileSync(pathSessionFile, jsonlMessage('assistant', 'see /home/u/needle/x for details'));
    const textSessionFile = join(projectDir, 'session-text.jsonl');
    writeFileSync(textSessionFile, jsonlMessage('assistant', 'we found needle in the logs today'));

    const config: NormalizedConversationSearchConfig = {
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(root, 'embeddings.db'),
    };
    const dimensions = dimensionsForModel(config.model);
    const provider = fakeProvider(dimensions);
    vi.mocked(getConversationSearchConfig).mockReturnValue(config);
    vi.mocked(createConversationEmbeddingProvider).mockReturnValue(provider);

    const db = openEmbeddingsDb(config.dbPath, dimensions);
    for (const filePath of [pathSessionFile, textSessionFile]) {
      await indexConversationFile({
        filePath,
        config,
        db,
        provider,
        now: () => '2026-06-02T01:01:00.000Z',
      });
    }
    db.close();

    const result = await runPaletteSearch('needle', 5);
    expect(result.conversations.map((c) => c.conversationId)).toEqual(['session-text', 'session-path']);
    expect(result.conversations[1]).toMatchObject({ matchTier: 'path' });
  });
});
