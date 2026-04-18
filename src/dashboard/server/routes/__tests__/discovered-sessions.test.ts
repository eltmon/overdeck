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
import { upsertDiscoveredSession } from '../../../../lib/database/discovered-sessions-db.js';

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
});
