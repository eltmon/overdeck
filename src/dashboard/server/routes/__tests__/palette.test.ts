import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedConversationSearchConfig } from '../../../../lib/config-yaml.js';
import type { ConversationEmbeddingProvider } from '../../../../lib/conversation-search/embedding-provider.js';

vi.mock('../../../../lib/projects.js', () => ({
  listProjectsSync: vi.fn(() => []),
}));

vi.mock('../../../../lib/memory/fts-db.js', () => ({
  runMemoryFtsStatement: vi.fn(),
}));

vi.mock('../../../../lib/overdeck/conversations.js', () => ({
  getConversationByClaudeSessionId: vi.fn(),
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
import { getConversationByClaudeSessionId } from '../../../../lib/overdeck/conversations.js';
import { listProjectsSync } from '../../../../lib/projects.js';
import { indexConversationFile } from '../../../../lib/conversation-search/indexer.js';
import { dimensionsForModel, openEmbeddingsDb } from '../../../../lib/database/conversation-embeddings-db.js';
import { closeConversationSearchService } from '../../services/conversation-search-service.js';
import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import { dashboardSessionCookieHeader, _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { PAN_COMMANDS, paletteRouteLayer, runPaletteSearch } from '../palette.js';

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

async function requestPaletteSearch(headers: Record<string, string> = {}) {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/palette/search?q=needle', { headers }));
  return Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(paletteRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
  ));
}

describe('palette conversation search', () => {
  it('offers reset-to-planned in the command palette', () => {
    expect(PAN_COMMANDS).toContainEqual(expect.objectContaining({
      name: 'pan reset-to-planned <id>',
    }));
  });

  beforeEach(() => {
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-dashboard-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-palette-search-'));
    vi.mocked(listProjectsSync).mockReturnValue([]);
    vi.mocked(getConversationByClaudeSessionId).mockReturnValue(null);
    vi.mocked(runMemoryFtsStatement).mockResolvedValue([]);
  });

  afterEach(() => {
    closeConversationSearchService();
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  it('requires auth but accepts cookie-authenticated GETs from split-host frontends', async () => {
    vi.mocked(getConversationSearchConfigSync).mockReturnValue({
      enabled: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyRef: undefined,
      dbPath: join(tmpDir!, 'disabled-embeddings.db'),
    });
    await expect(requestPaletteSearch()).resolves.toMatchObject({ status: 401 });

    const cookie = dashboardSessionCookieHeader().split(';')[0]!;
    await expect(requestPaletteSearch({
      cookie,
      referer: 'https://feature-pan-3703.overdeck.localhost/',
    })).resolves.toMatchObject({ status: 200 });
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
    vi.mocked(getConversationSearchConfigSync).mockReturnValue(config);
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
      role: 'assistant',
    });
    expect(result.conversations[0]?.excerptSegments).toContainEqual({ text: 'needle', match: true });

    vi.mocked(getConversationByClaudeSessionId).mockReturnValue({
      name: 'managed-conversation',
      projectKey: 'target-key',
    } as NonNullable<ReturnType<typeof getConversationByClaudeSessionId>>);
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
    vi.mocked(getConversationSearchConfigSync).mockReturnValue(config);
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
});
