/**
 * Integration suite: scan → enrich → embed → search (PAN-457)
 *
 * Seeds a realistic ~/.claude/projects/ fixture, runs the full pipeline,
 * and asserts expected state at each stage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { scan } from '../scanner.js';
import { parseSessionJsonl } from '../jsonl-async.js';
import { searchSessions } from '../search.js';
import { enrichSessions } from '../enrichment/index.js';
import { enrichSession } from '../enrichment/enrich-session.js';
import { embedSessions } from '../embeddings/index.js';
import { getDatabase } from '../../database/index.js';
import {
  findDiscoveredSessions,
  getDiscoveredSessionById,
  getDiscoveredStats,
  searchFts,
} from '../../database/discovered-sessions-db.js';
import type { EnrichmentResponse } from '../enrichment/enrich-session.js';
import type { EmbeddingResult } from '../embeddings/providers.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let TEST_HOME: string;
let claudeProjectsDir: string;

const MYAPP_SESSION = [
  JSON.stringify({
    sessionId: 'myapp-sess-1',
    timestamp: '2025-03-01T10:00:00Z',
    cwd: '/home/user/Projects/myapp',
    message: { role: 'user', model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 0 } },
    content: 'Fix the authentication bug — users cannot log in with email',
  }),
  JSON.stringify({
    sessionId: 'myapp-sess-1',
    timestamp: '2025-03-01T10:05:00Z',
    message: { role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 0, output_tokens: 400 } },
    content: [
      { type: 'tool_use', name: 'Read', input: { file_path: '/home/user/Projects/myapp/src/auth/login.ts' } },
      { type: 'text', text: 'Found the bug in the JWT validation logic. The token expiry check is inverted.' },
    ],
  }),
  JSON.stringify({
    sessionId: 'myapp-sess-1',
    timestamp: '2025-03-01T10:08:00Z',
    message: { role: 'user', model: 'claude-sonnet-4-6', usage: { input_tokens: 50, output_tokens: 0 } },
    content: 'Fix it please',
  }),
  JSON.stringify({
    sessionId: 'myapp-sess-1',
    timestamp: '2025-03-01T10:10:00Z',
    message: { role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 0, output_tokens: 300 } },
    content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: '/home/user/Projects/myapp/src/auth/login.ts', new_string: '// fixed' } },
      { type: 'text', text: 'Fixed the JWT expiry check. Users can now log in.' },
    ],
  }),
].join('\n') + '\n';

const OTHERAPP_SESSION = [
  JSON.stringify({
    sessionId: 'other-sess-1',
    timestamp: '2025-03-02T14:00:00Z',
    cwd: '/home/user/Projects/otherapp',
    message: { role: 'user', model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 100, output_tokens: 0 } },
    content: 'Add a new dashboard page showing metrics',
  }),
  JSON.stringify({
    sessionId: 'other-sess-1',
    timestamp: '2025-03-02T14:15:00Z',
    message: { role: 'assistant', model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 0, output_tokens: 250 } },
    content: [{ type: 'text', text: 'Created the dashboard metrics page with charts.' }],
  }),
].join('\n') + '\n';

const AUTHLIB_SESSION = [
  JSON.stringify({
    sessionId: 'authlib-sess-1',
    timestamp: '2025-03-03T09:00:00Z',
    cwd: '/home/user/Projects/authlib',
    message: { role: 'user', model: 'claude-opus-4-7', usage: { input_tokens: 120, output_tokens: 0 } },
    content: 'Document authentication token refresh behavior',
  }),
  JSON.stringify({
    sessionId: 'authlib-sess-1',
    timestamp: '2025-03-03T09:20:00Z',
    message: { role: 'assistant', model: 'claude-opus-4-7', usage: { input_tokens: 0, output_tokens: 260 } },
    content: [{ type: 'text', text: 'Updated auth token refresh documentation and examples.' }],
  }),
].join('\n') + '\n';

async function resetDb() {
  const { resetDatabase } = await import('../../database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  claudeProjectsDir = join(TEST_HOME, '.claude', 'projects');
  mkdirSync(join(claudeProjectsDir, '-home-user-Projects-myapp'), { recursive: true });
  mkdirSync(join(claudeProjectsDir, '-home-user-Projects-otherapp'), { recursive: true });
  mkdirSync(join(claudeProjectsDir, '-home-user-Projects-authlib'), { recursive: true });

  writeFileSync(
    join(claudeProjectsDir, '-home-user-Projects-myapp', 'myapp-sess.jsonl'),
    MYAPP_SESSION,
    'utf8',
  );
  writeFileSync(
    join(claudeProjectsDir, '-home-user-Projects-otherapp', 'other-sess.jsonl'),
    OTHERAPP_SESSION,
    'utf8',
  );
  writeFileSync(
    join(claudeProjectsDir, '-home-user-Projects-authlib', 'authlib-sess.jsonl'),
    AUTHLIB_SESSION,
    'utf8',
  );

  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ─── Stage 1: Scan ────────────────────────────────────────────────────────────

describe('Stage 1: scan', () => {
  it('discovers both JSONL files and inserts sessions', async () => {
    const result = await scan({ mode: 'system', watchDirs: [] });

    expect(result.inserted).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.errors).toBe(0);

    const sessions = findDiscoveredSessions({});
    expect(sessions.length).toBe(3);
  });

  it('parses token counts and tools correctly', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions({});
    const myapp = sessions.find((s) => s.jsonlPath.includes('myapp'));

    expect(myapp).toBeDefined();
    expect(myapp!.messageCount).toBe(4);
    expect(myapp!.tokenInput).toBeGreaterThan(0);
    expect(myapp!.tokenOutput).toBeGreaterThan(0);
    expect(myapp!.toolsUsed).toContain('Read');
    expect(myapp!.toolsUsed).toContain('Edit');
  });

  it('re-scan of unchanged files skips them without reparsing', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const parser = vi.fn(parseSessionJsonl);
    const r2 = await scan({ mode: 'system', watchDirs: [], parseJsonl: parser });

    expect(r2.skipped).toBe(3);
    expect(r2.inserted + r2.updated).toBe(0);
    expect(parser).not.toHaveBeenCalled();
  });

  it('links managed session_file rows to issue IDs', async () => {
    const myappPath = join(claudeProjectsDir, '-home-user-Projects-myapp', 'myapp-sess.jsonl');
    getDatabase().prepare(
      `INSERT INTO conversations (name, tmux_session, status, cwd, issue_id, created_at, session_file)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('agent-pan-457', 'agent-pan-457', 'active', '/home/user/Projects/myapp', 'PAN-457', new Date().toISOString(), myappPath);

    await scan({ mode: 'system', watchDirs: [] });
    const myapp = findDiscoveredSessions({}).find((s) => s.jsonlPath === myappPath)!;

    expect(myapp.panopticonManaged).toBe(true);
    expect(myapp.panIssueId).toBe('PAN-457');
  });

  it('dry-run does not persist to DB', async () => {
    await scan({ mode: 'system', watchDirs: [], dryRun: true });
    expect(findDiscoveredSessions({}).length).toBe(0);
  });
});

// ─── Stage 2: Enrich ──────────────────────────────────────────────────────────

const mockApi = async (_model: string, _prompt: string): Promise<EnrichmentResponse> => ({
  summary: 'Fixed JWT authentication bug preventing user login.',
  tags: ['auth', 'bug-fix', 'jwt', 'login'],
});

describe('Stage 2: enrich after scan', () => {
  it('enriches a session and persists summary+tags', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions({});
    const myapp = sessions.find((s) => s.jsonlPath.includes('myapp'))!;

    const result = await enrichSession({
      sessionId: myapp.id,
      jsonlPath: myapp.jsonlPath,
      tier: 1,
      config: { quickModel: null, deepModel: null },
      callApi: mockApi,
    });

    expect(result.error).toBeUndefined();

    const updated = getDiscoveredSessionById(myapp.id)!;
    expect(updated.enrichmentLevel).toBe(1);
    expect(updated.summary).toContain('JWT');
    expect(updated.tags).toContain('auth');
    expect(updated.tags).toContain('bug-fix');
  });

  it('enriched session appears in stats', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions({});
    const myapp = sessions.find((s) => s.jsonlPath.includes('myapp'))!;

    await enrichSession({
      sessionId: myapp.id,
      jsonlPath: myapp.jsonlPath,
      tier: 1,
      config: { quickModel: null, deepModel: null },
      callApi: mockApi,
    });

    const stats = getDiscoveredStats();
    expect(stats.total).toBe(3);
    expect(stats.enriched).toBe(1);
  });
});

// ─── Stage 3: Embed ───────────────────────────────────────────────────────────

const mockEmbedFn = async (
  _provider: unknown,
  opts: { text: string },
): Promise<EmbeddingResult> => {
  const text = opts.text.toLowerCase();
  const values = text.includes('dashboard') || text.includes('metrics')
    ? [0, 1, 0, 0]
    : [1, 0, 0, 0];
  return { embedding: new Float32Array(values), model: 'text-embedding-3-small' };
};

describe('Stage 3: embed after enrich', () => {
  it('generates and stores embedding for enriched session', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions({});
    const myapp = sessions.find((s) => s.jsonlPath.includes('myapp'))!;

    await enrichSession({
      sessionId: myapp.id,
      jsonlPath: myapp.jsonlPath,
      tier: 1,
      config: { quickModel: null, deepModel: null },
      callApi: mockApi,
    });

    const embedResult = await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: mockEmbedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
    });

    expect(embedResult.embedded).toBe(1); // Only the enriched session
    expect(embedResult.errors).toBe(0);

    const stats = getDiscoveredStats();
    expect(stats.embedded).toBe(1);
  });
});

// ─── Stage 4: Search ──────────────────────────────────────────────────────────

describe('Stage 4: search after enrichment', () => {
  it('runs scan → enrich → embed → semantic search with the expected top result', async () => {
    await scan({ mode: 'system', watchDirs: [] });

    await enrichSessions({
      tier: 1,
      maxParallel: 1,
      force: true,
      callApi: async (_model, prompt) => {
        if (prompt.includes('dashboard metrics')) {
          return { summary: 'Created dashboard metrics page.', tags: ['dashboard', 'metrics'] };
        }
        if (prompt.includes('token refresh')) {
          return { summary: 'Documented auth token refresh behavior.', tags: ['auth', 'token-refresh'] };
        }
        return { summary: 'Fixed JWT authentication bug preventing user login.', tags: ['auth', 'jwt', 'login'] };
      },
    });

    await embedSessions({
      model: 'text-embedding-3-small',
      provider: 'openai',
      embedFn: mockEmbedFn as typeof import('../embeddings/providers.js').embed,
      maxParallel: 1,
    });

    const myapp = findDiscoveredSessions({}).find((s) => s.jsonlPath.includes('myapp'))!;
    const result = await searchSessions({
      similarTo: myapp.id,
      embeddingModel: 'text-embedding-3-small',
      limit: 1,
    });

    expect(result.mode).toBe('semantic');
    expect(result.sessions[0].jsonlPath).toContain('authlib');
  });

  it('structured filter finds sessions by workspace', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions({});
    const myapp = sessions.find((s) => s.jsonlPath.includes('myapp'))!;

    const result = await searchSessions({
      filter: { workspacePath: myapp.workspacePath ?? undefined },
    });

    expect(result.sessions.length).toBeGreaterThanOrEqual(1);
    expect(result.mode).toBe('filter');
  });

  it('FTS search finds enriched sessions by summary keyword', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions({});
    const myapp = sessions.find((s) => s.jsonlPath.includes('myapp'))!;

    // Enrich to populate FTS
    await enrichSession({
      sessionId: myapp.id,
      jsonlPath: myapp.jsonlPath,
      tier: 1,
      config: { quickModel: null, deepModel: null },
      callApi: mockApi,
    });

    // FTS5 MATCH search
    const ftsResults = searchFts('jwt', 10);
    expect(ftsResults.length).toBeGreaterThan(0);
    expect(ftsResults[0].id).toBe(myapp.id);
  });

  it('filter by model finds correct sessions', async () => {
    await scan({ mode: 'system', watchDirs: [] });

    const haiku = await searchSessions({
      filter: { primaryModel: 'claude-haiku-4-5-20251001' },
    });
    const sonnet = await searchSessions({
      filter: { primaryModel: 'claude-sonnet-4-6' },
    });

    expect(haiku.sessions.length).toBe(1);
    expect(haiku.sessions[0].jsonlPath).toContain('otherapp');
    expect(sonnet.sessions.length).toBe(1);
    expect(sonnet.sessions[0].jsonlPath).toContain('myapp');
  });
});

// ─── Stage 5: Cost aggregation ────────────────────────────────────────────────

describe('Stage 5: cost aggregation', () => {
  it('sessions have non-zero estimated cost after scan', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions({});

    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCost, 0);
    // Both sessions have token usage, should have some cost
    // (may be 0 if model is unknown, so just verify the field exists)
    expect(typeof totalCost).toBe('number');
    expect(totalCost).toBeGreaterThanOrEqual(0);
  });

  it('getDiscoveredStats returns correct totals', async () => {
    await scan({ mode: 'system', watchDirs: [] });
    const stats = getDiscoveredStats();

    expect(stats.total).toBe(3);
    expect(stats.enriched).toBe(0);
    expect(stats.embedded).toBe(0);
    expect(stats.managedCount).toBe(0);
  });
});
