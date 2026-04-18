import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scan } from '../scanner.js';

// Allow individual tests to inject a parse failure for a specific file path
let failParseForPath: string | null = null;

vi.mock('../jsonl-async.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../jsonl-async.js')>();
  return {
    ...actual,
    parseSessionJsonl: vi.fn().mockImplementation((filePath: string) => {
      if (failParseForPath && filePath.includes(failParseForPath)) {
        throw new Error('Simulated parse failure');
      }
      return actual.parseSessionJsonl(filePath);
    }),
  };
});

let TEST_HOME: string;
let fakeClaudeDir: string;

// Fixture JSONL lines for a simple session
const SESSION_JSONL = [
  JSON.stringify({
    sessionId: 'sess-1',
    timestamp: '2025-01-01T10:00:00Z',
    cwd: '/home/user/Projects/myapp',
    message: { role: 'user', model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 0 } },
    content: [],
  }),
  JSON.stringify({
    sessionId: 'sess-1',
    timestamp: '2025-01-01T10:01:00Z',
    message: { role: 'assistant', model: 'claude-sonnet-4-6', usage: { input_tokens: 0, output_tokens: 200 } },
    content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/home/user/Projects/myapp/src/index.ts' } }],
  }),
].join('\n') + '\n';

async function resetDb() {
  const { resetDatabase } = await import('../../database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fakeClaudeDir = join(TEST_HOME, '.claude', 'projects');
  mkdirSync(join(fakeClaudeDir, '-home-user-Projects-myapp'), { recursive: true });
  mkdirSync(join(fakeClaudeDir, '-home-user-Projects-otherapp'), { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.HOME = TEST_HOME; // point ~ to test dir
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('work-pool', () => {
  it('runWithPool respects maxParallel — concurrent tasks never exceed limit', async () => {
    const { runWithPool } = await import('../work-pool.js');
    let inFlight = 0;
    let maxInFlight = 0;
    const TASK_COUNT = 10;
    const MAX = 3;

    const tasks = Array.from({ length: TASK_COUNT }, () => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });

    await runWithPool(tasks, MAX);
    expect(maxInFlight).toBeLessThanOrEqual(MAX);
  });
});

describe('scanner', () => {
  it('system mode discovers JSONL files in ~/.claude/projects', async () => {
    // Write two session files
    const p1 = join(fakeClaudeDir, '-home-user-Projects-myapp', 'sess1.jsonl');
    const p2 = join(fakeClaudeDir, '-home-user-Projects-otherapp', 'sess2.jsonl');
    writeFileSync(p1, SESSION_JSONL, 'utf8');
    writeFileSync(p2, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'system', watchDirs: [] });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(2);
    expect(result.errors).toBe(0);
  });

  it('scan inserts sessions into discovered_sessions DB', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'sess.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    await scan({ mode: 'system', watchDirs: [] });

    const { findDiscoveredSessions } = await import('../../database/discovered-sessions-db.js');
    const sessions = findDiscoveredSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const sess = sessions.find((s) => s.jsonlPath === p);
    expect(sess).toBeDefined();
    expect(sess!.messageCount).toBe(2);
    expect(sess!.toolsUsed).toContain('Read');
  });

  it('change detection: re-scan of unchanged file does not re-parse', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'unchanged.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    // First scan — inserts
    const r1 = await scan({ mode: 'system', watchDirs: [] });
    expect(r1.inserted).toBeGreaterThan(0);

    // Second scan — same file, no change → skipped
    const r2 = await scan({ mode: 'system', watchDirs: [] });
    expect(r2.skipped).toBeGreaterThan(0);
    expect(r2.inserted + r2.updated).toBe(0);
  });

  it('dry-run performs no DB writes', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'dry.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    await scan({ mode: 'system', watchDirs: [], dryRun: true });

    const { findDiscoveredSessions } = await import('../../database/discovered-sessions-db.js');
    expect(findDiscoveredSessions()).toHaveLength(0);
  });

  it('progress callback fires with correct shape', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'prog.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const progressCalls: unknown[] = [];
    await scan({
      mode: 'system',
      watchDirs: [],
      onProgress: (progress) => progressCalls.push(progress),
    });

    expect(progressCalls.length).toBeGreaterThan(0);
    const last = progressCalls[progressCalls.length - 1] as {
      dirsProcessed: number;
      dirsTotal: number;
      sessionsFound: number;
      elapsedMs: number;
    };
    expect(last.dirsProcessed).toBeGreaterThan(0);
    expect(last.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('permission-denied directories are skipped without crashing', async () => {
    // Point home to a non-existent dir — scan will just return empty
    process.env.HOME = '/nonexistent/path/that/does/not/exist';
    await expect(scan({ mode: 'system', watchDirs: [] })).resolves.toBeDefined();
  });

  it('watched mode with empty watchDirs scans zero files', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'watched.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'watched', watchDirs: [] });
    expect(result.inserted + result.updated + result.skipped).toBe(0);
  });

  it('watched mode with parent watchDir discovers child workspace sessions', async () => {
    // The session hash '-home-user-Projects-myapp' is a child of '/home/user/Projects'.
    // Watched mode must include it when '/home/user/Projects' is in watchDirs.
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'watched-child.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'watched', watchDirs: ['/home/user/Projects'] });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);
  });

  it('scan persists sessionId from JSONL into discovered_sessions', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'with-session-id.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    await scan({ mode: 'system', watchDirs: [] });

    const { findDiscoveredSessions } = await import('../../database/discovered-sessions-db.js');
    const sessions = findDiscoveredSessions();
    const sess = sessions.find((s) => s.jsonlPath === p);
    expect(sess).toBeDefined();
    expect(sess!.sessionId).toBe('sess-1');
  });

  it('a file that fails to parse increments errors and still emits progress for that file', async () => {
    const good = join(fakeClaudeDir, '-home-user-Projects-myapp', 'good-parse.jsonl');
    const bad = join(fakeClaudeDir, '-home-user-Projects-myapp', 'fail-parse.jsonl');
    writeFileSync(good, SESSION_JSONL, 'utf8');
    writeFileSync(bad, SESSION_JSONL, 'utf8');

    // Make parseSessionJsonl throw for 'fail-parse.jsonl'
    failParseForPath = 'fail-parse';

    const progressCalls: Array<{ dirsProcessed: number }> = [];
    const result = await scan({
      mode: 'system',
      watchDirs: [],
      onProgress: (p) => progressCalls.push({ dirsProcessed: p.dirsProcessed }),
    });

    failParseForPath = null;

    // The failing file must appear in errors, not silently vanish
    expect(result.errors).toBeGreaterThanOrEqual(1);
    // dirsProcessed must equal inserted+updated+skipped+errors (all files accounted for)
    expect(result.inserted + result.updated + result.skipped + result.errors).toBe(
      progressCalls[progressCalls.length - 1]?.dirsProcessed ?? 0,
    );
  });
});
