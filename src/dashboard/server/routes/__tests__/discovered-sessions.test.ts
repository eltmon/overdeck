/**
 * Tests for discovered-sessions route helpers.
 *
 * The route uses Effect and is not straightforwardly drivable end-to-end in unit
 * tests. We test the underlying library functions called by the route and the
 * scan mode guard that the route enforces.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { scan } from '../../../../lib/conversations/scanner.js';
import { searchSessions } from '../../../../lib/conversations/search.js';
import {
  upsertDiscoveredSession,
  getDiscoveredStats,
  getDiscoveredSessionById,
  findDiscoveredSessions,
} from '../../../../lib/database/discovered-sessions-db.js';
import { enrichSessions } from '../../../../lib/conversations/enrichment/index.js';
import { embedSessions } from '../../../../lib/conversations/embeddings/index.js';
import { parseSearchParams } from '../discovered-sessions.js';

let TEST_HOME: string;
let fakeClaudeDir: string;

const SESSION_JSONL = [
  JSON.stringify({
    sessionId: 'route-test-sess',
    timestamp: '2025-03-01T10:00:00Z',
    cwd: '/home/user/Projects/myapp',
    message: { role: 'user', model: 'claude-sonnet-4-6', usage: { input_tokens: 50, output_tokens: 0 } },
    content: [],
  }),
  JSON.stringify({
    sessionId: 'route-test-sess',
    timestamp: '2025-03-01T10:01:00Z',
    message: { role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 0, output_tokens: 100 } },
    content: [],
  }),
].join('\n') + '\n';

async function resetDb() {
  const { resetDatabase } = await import('../../../../lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fakeClaudeDir = join(TEST_HOME, '.claude', 'projects');
  mkdirSync(join(fakeClaudeDir, '-home-user-Projects-myapp'), { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ─── Scan endpoint behavior ───────────────────────────────────────────────────

describe('scan (route logic)', () => {
  it('system mode discovers sessions', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'sess.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'system', watchDirs: [] });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);
  });

  it('watched mode with empty watchDirs produces no results (route safety)', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'sess.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    // Route always passes config.conversations.watchDirs — when empty, should scan nothing
    const result = await scan({ mode: 'watched', watchDirs: [] });
    expect(result.inserted + result.updated + result.skipped).toBe(0);
  });

  it('watched mode with parent watchDir discovers child workspace sessions', async () => {
    // watchDirs typically point to parent roots like ~/Projects.
    // Sessions inside ~/Projects/myapp must be discovered.
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'child.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'watched', watchDirs: ['/home/user/Projects'] });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);
  });

  it('targeted mode with dirs scans only matching sessions', async () => {
    const pA = join(fakeClaudeDir, '-home-user-Projects-myapp', 'a.jsonl');
    const pB = join(fakeClaudeDir, '-home-user-Projects-otherapp', 'b.jsonl');
    mkdirSync(join(fakeClaudeDir, '-home-user-Projects-otherapp'), { recursive: true });
    writeFileSync(pA, SESSION_JSONL, 'utf8');
    writeFileSync(pB, SESSION_JSONL, 'utf8');

    // Pass the original path that encodes to '-home-user-Projects-myapp'
    const result = await scan({
      mode: 'targeted',
      dirs: ['/home/user/Projects/myapp'],
      watchDirs: [],
    });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);
  });
});

// ─── parseSearchParams filter parsing ────────────────────────────────────────

describe('parseSearchParams', () => {
  it('parses workspace and since', () => {
    const params = new URLSearchParams('workspace=/home/user/Projects/alpha&since=7d');
    const filter = parseSearchParams(params);
    expect(filter.workspacePath).toBe('/home/user/Projects/alpha');
    expect(filter.since).toBeTruthy();
  });

  it('parses model filter', () => {
    const params = new URLSearchParams('model=claude-sonnet-4-6');
    const filter = parseSearchParams(params);
    expect(filter.primaryModel).toBe('claude-sonnet-4-6');
  });

  it('parses managed=true', () => {
    const filter = parseSearchParams(new URLSearchParams('managed=true'));
    expect(filter.managed).toBe(true);
  });

  it('parses managed=false as false', () => {
    const filter = parseSearchParams(new URLSearchParams('managed=false'));
    expect(filter.managed).toBe(false);
  });

  it('parses enriched flag', () => {
    const filter = parseSearchParams(new URLSearchParams('enriched=1'));
    expect(filter.enriched).toBe(true);
  });

  it('parses not_enriched flag', () => {
    const filter = parseSearchParams(new URLSearchParams('not_enriched=1'));
    expect(filter.notEnriched).toBe(true);
  });

  it('parses comma-separated tags', () => {
    const filter = parseSearchParams(new URLSearchParams('tags=auth,refactor'));
    expect(filter.tags).toEqual(['auth', 'refactor']);
  });

  it('parses min_cost and max_cost', () => {
    const filter = parseSearchParams(new URLSearchParams('min_cost=0.01&max_cost=1.5'));
    expect(filter.minCost).toBeCloseTo(0.01);
    expect(filter.maxCost).toBeCloseTo(1.5);
  });

  it('ignores invalid min_cost', () => {
    const filter = parseSearchParams(new URLSearchParams('min_cost=notanumber'));
    expect(filter.minCost).toBeUndefined();
  });

  it('parses min_messages', () => {
    const filter = parseSearchParams(new URLSearchParams('min_messages=10'));
    expect(filter.minMessages).toBe(10);
  });

  it('parses before and after', () => {
    const filter = parseSearchParams(new URLSearchParams('before=1d&after=30d'));
    expect(filter.before).toBeTruthy();
    expect(filter.after).toBeTruthy();
  });

  it('parses issue_id', () => {
    const filter = parseSearchParams(new URLSearchParams('issue_id=PAN-123'));
    expect(filter.issueId).toBe('PAN-123');
  });

  it('returns empty object for empty params', () => {
    const filter = parseSearchParams(new URLSearchParams());
    expect(Object.keys(filter).length).toBe(0);
  });
});

// ─── Search endpoint behavior ─────────────────────────────────────────────────

describe('search (route logic)', () => {
  beforeEach(() => {
    upsertDiscoveredSession({
      jsonlPath: '/route/1.jsonl',
      workspacePath: '/home/user/Projects/alpha',
      workspaceHash: 'hash1',
      messageCount: 5,
      firstTs: '2025-01-01T00:00:00Z',
      lastTs: '2025-01-01T01:00:00Z',
      modelsUsed: ['claude-sonnet-4-6'],
      primaryModel: 'claude-sonnet-4-6',
      tokenInput: 100,
      tokenOutput: 200,
      estimatedCost: 0.01,
      toolsUsed: ['Read'],
      filesTouched: [],
      tags: [],
      panopticonManaged: false,
      panIssueId: null,
      panAgentId: null,
      fileSize: 512,
      fileMtime: '2025-01-01T00:00:00Z',
    });
  });

  it('searchSessions returns sessions array and mode', () => {
    const result = searchSessions({});
    expect(result).toHaveProperty('sessions');
    expect(result).toHaveProperty('mode');
    expect(result.sessions.length).toBeGreaterThan(0);
  });

  it('filter by workspace returns only matching sessions', () => {
    const result = searchSessions({
      filter: { workspacePath: '/home/user/Projects/alpha' },
    });
    expect(result.sessions.every((s) => s.workspacePath === '/home/user/Projects/alpha')).toBe(true);
  });

  it('limit is honored', () => {
    // Seed 3 more sessions
    for (let i = 2; i <= 4; i++) {
      upsertDiscoveredSession({
        jsonlPath: `/route/${i}.jsonl`,
        workspacePath: `/home/user/Projects/item${i}`,
        workspaceHash: `hash${i}`,
        messageCount: 1,
        firstTs: '2025-01-01T00:00:00Z',
        lastTs: '2025-01-01T00:01:00Z',
        modelsUsed: [],
        primaryModel: null,
        tokenInput: 0,
        tokenOutput: 0,
        estimatedCost: 0,
        toolsUsed: [],
        filesTouched: [],
        tags: [],
        panopticonManaged: false,
        panIssueId: null,
        panAgentId: null,
        fileSize: null,
        fileMtime: null,
      });
    }

    const result = searchSessions({ limit: 2 });
    expect(result.sessions.length).toBeLessThanOrEqual(2);
  });

  it('searchSessions total reflects unpaginated match count', () => {
    // Seed 4 more sessions (5 total after beforeEach)
    for (let i = 2; i <= 5; i++) {
      upsertDiscoveredSession({
        jsonlPath: `/route/total-test-${i}.jsonl`,
        workspacePath: `/home/user/Projects/item${i}`,
        workspaceHash: `hash-total-${i}`,
        messageCount: 1,
        firstTs: '2025-01-01T00:00:00Z',
        lastTs: '2025-01-01T00:01:00Z',
        modelsUsed: [],
        primaryModel: null,
        tokenInput: 0,
        tokenOutput: 0,
        estimatedCost: 0,
        toolsUsed: [],
        filesTouched: [],
        tags: [],
        panopticonManaged: false,
        panIssueId: null,
        panAgentId: null,
        fileSize: null,
        fileMtime: null,
      });
    }

    const page = searchSessions({ limit: 2, offset: 0 });
    expect(page.sessions.length).toBeLessThanOrEqual(2);
    // total must reflect ALL 5 sessions, not just the 2-session page
    expect(page.total).toBeGreaterThanOrEqual(5);
  });
});

// ─── Scan targeted mode with dirs ─────────────────────────────────────────────

describe('scan targeted mode with dirs', () => {
  it('targeted mode with dirs scans only the specified workspace sessions', async () => {
    const pA = join(fakeClaudeDir, '-home-user-Projects-myapp', 'a.jsonl');
    const pB = join(fakeClaudeDir, '-home-user-Projects-otherapp', 'b.jsonl');
    mkdirSync(join(fakeClaudeDir, '-home-user-Projects-otherapp'), { recursive: true });
    writeFileSync(pA, SESSION_JSONL, 'utf8');
    writeFileSync(pB, SESSION_JSONL, 'utf8');

    // Route passes dirs when mode is targeted
    const result = await scan({
      mode: 'targeted',
      dirs: ['/home/user/Projects/myapp'],
      watchDirs: [],
    });

    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);

    const { findDiscoveredSessions } = await import('../../../../lib/database/discovered-sessions-db.js');
    const sessions = findDiscoveredSessions();
    // Only myapp sessions should be indexed (otherapp not in dirs)
    expect(sessions.some((s) => s.jsonlPath === pA)).toBe(true);
    expect(sessions.some((s) => s.jsonlPath === pB)).toBe(false);
  });

  it('targeted mode without dirs scans zero files (route must require dirs)', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'no-dirs.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'targeted', dirs: [], watchDirs: [] });
    expect(result.inserted + result.updated + result.skipped).toBe(0);
  });
});

// ─── GET /api/discovered-sessions/stats ──────────────────────────────────────

const SEED_SESSION = {
  jsonlPath: '/stats/1.jsonl',
  workspacePath: '/home/user/Projects/alpha',
  workspaceHash: 'hash-stats',
  messageCount: 3,
  firstTs: '2025-01-01T00:00:00Z',
  lastTs: '2025-01-01T01:00:00Z',
  modelsUsed: ['claude-sonnet-4-6'],
  primaryModel: 'claude-sonnet-4-6',
  tokenInput: 100,
  tokenOutput: 200,
  estimatedCost: 0.05,
  toolsUsed: [],
  filesTouched: [],
  tags: [],
  panopticonManaged: false,
  panIssueId: null,
  panAgentId: null,
  fileSize: 512,
  fileMtime: '2025-01-01T00:00:00Z',
} as const;

describe('getDiscoveredStats (GET /api/discovered-sessions/stats logic)', () => {
  it('returns zero counts on empty database', () => {
    const stats = getDiscoveredStats();
    expect(stats).toMatchObject({ total: 0, enriched: 0, embedded: 0, managedCount: 0 });
  });

  it('increments total after session is inserted', () => {
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/stats/a.jsonl', workspaceHash: 'stats-a' });
    const stats = getDiscoveredStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });

  it('managedCount counts only panopticonManaged sessions', () => {
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/stats/b.jsonl', workspaceHash: 'stats-b', panopticonManaged: true });
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/stats/c.jsonl', workspaceHash: 'stats-c', panopticonManaged: false });
    const stats = getDiscoveredStats();
    expect(stats.managedCount).toBeGreaterThanOrEqual(1);
    expect(stats.total).toBeGreaterThanOrEqual(2);
  });
});

// ─── GET /api/discovered-sessions/cost ───────────────────────────────────────

describe('cost aggregation (GET /api/discovered-sessions/cost logic)', () => {
  it('returns zero cost on empty database', () => {
    const sessions = findDiscoveredSessions({});
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCost, 0);
    expect(totalCost).toBe(0);
  });

  it('aggregates cost from all sessions', () => {
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/cost/1.jsonl', workspaceHash: 'cost-1', estimatedCost: 0.10 });
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/cost/2.jsonl', workspaceHash: 'cost-2', estimatedCost: 0.20 });
    const sessions = findDiscoveredSessions({});
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCost, 0);
    expect(totalCost).toBeCloseTo(0.30, 5);
  });

  it('filters cost by workspacePath', () => {
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/cost/3.jsonl', workspaceHash: 'cost-3', workspacePath: '/home/user/Projects/alpha', estimatedCost: 0.10 });
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/cost/4.jsonl', workspaceHash: 'cost-4', workspacePath: '/home/user/Projects/beta', estimatedCost: 0.50 });
    const sessions = findDiscoveredSessions({ workspacePath: '/home/user/Projects/alpha' });
    const totalCost = sessions.reduce((sum, s) => sum + s.estimatedCost, 0);
    expect(totalCost).toBeCloseTo(0.10, 5);
  });
});

// ─── GET /api/discovered-sessions/:id ────────────────────────────────────────

describe('getDiscoveredSessionById (GET /api/discovered-sessions/:id logic)', () => {
  it('returns null for unknown id', () => {
    const session = getDiscoveredSessionById(999999);
    expect(session).toBeNull();
  });

  it('returns the session with correct fields after insert', () => {
    upsertDiscoveredSession({ ...SEED_SESSION, jsonlPath: '/byid/1.jsonl', workspaceHash: 'byid-1' });
    const all = findDiscoveredSessions({ workspacePath: '/home/user/Projects/alpha' });
    const inserted = all.find((s) => s.jsonlPath === '/byid/1.jsonl');
    expect(inserted).toBeTruthy();

    const fetched = getDiscoveredSessionById(inserted!.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.jsonlPath).toBe('/byid/1.jsonl');
    expect(fetched!.workspacePath).toBe('/home/user/Projects/alpha');
  });
});

// ─── POST /api/discovered-sessions/enrich ────────────────────────────────────

describe('enrichSessions (POST /api/discovered-sessions/enrich logic)', () => {
  it('returns zero enriched when sessionIds is empty', async () => {
    const result = await enrichSessions({ tier: 1, sessionIds: [] });
    expect(result).toMatchObject({ enriched: 0, skipped: 0, errors: 0 });
    expect(typeof result.durationMs).toBe('number');
  });

  it('returns zero enriched when no sessions match the given IDs', async () => {
    const result = await enrichSessions({ tier: 1, sessionIds: [999999] });
    expect(result.enriched).toBe(0);
  });
});

// ─── POST /api/discovered-sessions/embed ─────────────────────────────────────

describe('embedSessions (POST /api/discovered-sessions/embed logic)', () => {
  it('returns zero embedded when sessionIds is empty', async () => {
    const result = await embedSessions({ sessionIds: [] });
    expect(result).toMatchObject({ embedded: 0, skipped: 0, errors: 0 });
    expect(typeof result.durationMs).toBe('number');
  });

  it('returns zero embedded when no sessions match the given IDs', async () => {
    const result = await embedSessions({ sessionIds: [999999] });
    expect(result.embedded).toBe(0);
  });
});
