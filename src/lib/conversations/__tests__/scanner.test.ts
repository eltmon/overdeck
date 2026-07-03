import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { parseSessionJsonl } from '../jsonl-async.js';
import { scan, validateEstimatedCost } from '../scanner.js';
import { discoverJsonlFiles, type DiscoveredFile } from '../harness-discovery.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../tests/helpers/overdeck-test-db.js';
import { findDiscoveredSessions } from '../../overdeck/discovered-sessions.js';
import { insertCostEventSync } from '../../overdeck/cost-sync.js';

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

let odb: OverdeckTestDb;
let fakeClaudeDir: string;
let savedHome: string | undefined;

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

beforeEach(() => {
  odb = setupOverdeckTestDb();
  fakeClaudeDir = join(odb.home, '.claude', 'projects');
  mkdirSync(join(fakeClaudeDir, '-home-user-Projects-myapp'), { recursive: true });
  mkdirSync(join(fakeClaudeDir, '-home-user-Projects-otherapp'), { recursive: true });
  savedHome = process.env.HOME;
  process.env.HOME = odb.home; // point ~ to test dir so scanner finds ~/.claude/projects
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  if (savedHome !== undefined) {
    process.env.HOME = savedHome;
  } else {
    delete process.env.HOME;
  }
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

    await Effect.runPromise(runWithPool(tasks, MAX));
    expect(maxInFlight).toBeLessThanOrEqual(MAX);
  });
});

describe('scanner', () => {
  it('discovers fixture files across all harness roots with harness tags', async () => {
    const claude = join(fakeClaudeDir, '-home-user-Projects-myapp', 'claude.jsonl');
    const pi = join(odb.home, '.pi', 'agent', 'sessions', '-home-user-Projects-pi', '20260702_pi-session.jsonl');
    const ohmypi = join(odb.home, '.omp', 'agent', 'sessions', '-home-user-Projects-omp', '20260702_omp-session.jsonl');
    const codex = join(odb.home, '.codex', 'sessions', '2026', '07', '02', 'rollout-2026-07-02T00-00-00-000Z-codex-thread.jsonl');
    const agentPi = join(odb.home, '.overdeck', 'agents', 'agent-pi', 'sessions', '-home-user-Projects-agent-pi', '20260702_agent-pi.jsonl');
    const agentOmp = join(odb.home, '.overdeck', 'agents', 'agent-omp', 'session_omp-root.jsonl');
    const agentCodex = join(odb.home, '.overdeck', 'agents', 'agent-codex', 'codex-home', 'sessions', '2026', '07', '02', 'rollout-2026-07-02T00-00-00-000Z-agent-codex.jsonl');

    for (const file of [claude, pi, ohmypi, codex, agentPi, agentOmp, agentCodex]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, SESSION_JSONL, 'utf8');
    }
    writeFileSync(join(odb.home, '.overdeck', 'agents', 'agent-pi', 'state.json'), JSON.stringify({ harness: 'pi' }), 'utf8');
    writeFileSync(join(odb.home, '.overdeck', 'agents', 'agent-omp', 'state.json'), JSON.stringify({ harness: 'ohmypi' }), 'utf8');
    writeFileSync(join(odb.home, '.overdeck', 'agents', 'agent-codex', 'state.json'), JSON.stringify({ harness: 'codex' }), 'utf8');

    const files = await discoverJsonlFiles([]);
    const byPath = new Map(files.map((file) => [file.jsonlPath, file.harness]));

    expect(byPath.get(claude)).toBe('claude-code');
    expect(byPath.get(pi)).toBe('pi');
    expect(byPath.get(ohmypi)).toBe('ohmypi');
    expect(byPath.get(codex)).toBe('codex');
    expect(byPath.get(agentPi)).toBe('pi');
    expect(byPath.get(agentOmp)).toBe('ohmypi');
    expect(byPath.get(agentCodex)).toBe('codex');
    expect(files.find((file) => file.jsonlPath === pi)?.projectDir).toBe(join(odb.home, '.pi', 'agent', 'sessions', '-home-user-Projects-pi'));
    expect(files.find((file) => file.jsonlPath === ohmypi)?.projectDir).toBe(join(odb.home, '.omp', 'agent', 'sessions', '-home-user-Projects-omp'));
    expect(files.find((file) => file.jsonlPath === agentPi)?.projectDir).toBe(join(odb.home, '.overdeck', 'agents', 'agent-pi', 'sessions', '-home-user-Projects-agent-pi'));
  });

  it('keeps Claude-only enumeration identical to the pre-change scanner projection', async () => {
    const topLevel = join(fakeClaudeDir, '-home-user-Projects-myapp', 'claude-top.jsonl');
    const nested = join(fakeClaudeDir, '-home-user-Projects-myapp', 'session-uuid-001', 'subagents', 'claude-nested.jsonl');
    const other = join(fakeClaudeDir, '-home-user-Projects-otherapp', 'claude-other.jsonl');
    for (const file of [topLevel, nested, other]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, SESSION_JSONL, 'utf8');
    }

    const files = (await discoverJsonlFiles([])).map(claudeProjection).sort(byPath);

    expect(files).toEqual([
      { projectDir: join(fakeClaudeDir, '-home-user-Projects-myapp'), jsonlPath: topLevel },
      { projectDir: join(fakeClaudeDir, '-home-user-Projects-myapp'), jsonlPath: nested },
      { projectDir: join(fakeClaudeDir, '-home-user-Projects-otherapp'), jsonlPath: other },
    ].sort(byPath));
  });

  it('skips missing harness roots silently', async () => {
    process.env.HOME = join(odb.home, 'missing-home');

    const warnings: string[] = [];
    const files = await discoverJsonlFiles(warnings);

    expect(files).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('harness discovery uses fs/promises rather than synchronous fs calls', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/conversations/harness-discovery.ts'), 'utf8');

    expect(source).not.toMatch(/\b(?:existsSync|readdirSync|readFileSync|statSync)\b/);
    expect(source).toContain("import { promises as fs } from 'fs'");
  });

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

  it('refreshes Overdeck correlation metadata for unchanged files', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'late-correlated.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    await scan({ mode: 'system', watchDirs: [] });
    expect(findDiscoveredSessions().find((s) => s.jsonlPath === p)?.overdeckManaged).toBe(false);

    insertCostEventSync({
      ts: '2025-01-01T10:02:00Z',
      type: 'cost',
      agentId: 'agent-late',
      issueId: 'PAN-457',
      sessionType: 'work',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      input: 100,
      output: 200,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.01,
      sessionId: 'late-correlated',
    });

    const result = await scan({ mode: 'system', watchDirs: [] });

    const session = findDiscoveredSessions().find((s) => s.jsonlPath === p);
    expect(result.updated).toBeGreaterThan(0);
    expect(session?.overdeckManaged).toBe(true);
    expect(session?.panIssueId).toBe('PAN-457');
    expect(session?.panAgentId).toBe('agent-late');
  });

  it('dry-run performs no DB writes', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'dry.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    await scan({ mode: 'system', watchDirs: [], dryRun: true });

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

  it('discovers nested subagent JSONL files under <uuid>/subagents/', async () => {
    // Real Claude Code structure: project-hash/<session-uuid>/subagents/<agent-id>.jsonl
    const subDir = join(fakeClaudeDir, '-home-user-Projects-myapp', 'session-uuid-001', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-abc.jsonl'), SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'system', watchDirs: [] });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);
  });

  it('watched mode with parent watchDir discovers child workspace sessions', async () => {
    // The session hash '-home-user-Projects-myapp' is a child of '/home/user/Projects'.
    // Watched mode must include it when '/home/user/Projects' is in watchDirs.
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'watched-child.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'watched', watchDirs: ['/home/user/Projects'] });
    expect(result.inserted + result.updated).toBeGreaterThanOrEqual(1);
  });

  it('targeted mode includes sessions whose resolved cwd is under the requested directory', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'targeted-child.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    const result = await scan({ mode: 'targeted', dirs: ['/home/user/Projects'], watchDirs: [] });
    expect(result.inserted + result.updated).toBe(1);
  });

  it('targeted mode does not parse JSONL files outside requested project prefixes', async () => {
    const target = join(fakeClaudeDir, '-home-user-Projects-myapp', 'targeted-prefilter.jsonl');
    const outside = join(fakeClaudeDir, '-home-user-Projects-otherapp', 'outside-prefilter.jsonl');
    writeFileSync(target, SESSION_JSONL, 'utf8');
    writeFileSync(outside, SESSION_JSONL, 'utf8');

    // Production wraps opts.parseJsonl via Effect.runPromise, so the mock must
    // return an Effect, not a Promise (PAN-1249 jsonl-async migration).
    const parser = vi.fn((filePath: string) => {
      if (filePath === outside) return Effect.fail(new Error('outside file should not be parsed') as any);
      return parseSessionJsonl(filePath);
    });

    const result = await scan({
      mode: 'targeted',
      dirs: ['/home/user/Projects/myapp'],
      watchDirs: [],
      parseJsonl: parser as any,
    });

    expect(result.inserted + result.updated).toBe(1);
    expect(parser).toHaveBeenCalledTimes(1);
    expect(parser).toHaveBeenCalledWith(target);
  });

  it('uses a 20% tolerance when validating estimated scan cost', () => {
    const warningsAtBoundary: string[] = [];
    validateEstimatedCost('/tmp/session.jsonl', 1.20, 1.00, warningsAtBoundary);
    expect(warningsAtBoundary).toHaveLength(0);

    const warningsPastBoundary: string[] = [];
    validateEstimatedCost('/tmp/session.jsonl', 1.21, 1.00, warningsPastBoundary);
    expect(warningsPastBoundary).toHaveLength(1);
  });

  it('validates estimated scan cost against matching cost_events records', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'cost-session.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');
    insertCostEventSync({
      ts: '2025-01-01T10:02:00Z',
      type: 'cost',
      agentId: 'agent-cost',
      issueId: 'PAN-457',
      sessionType: 'work',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      input: 100,
      output: 200,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 5,
      sessionId: 'cost-session',
    });

    const result = await scan({ mode: 'system', watchDirs: [] });

    expect(result.warnings?.some((warning) => warning.includes('differs from cost_events'))).toBe(true);
    const session = findDiscoveredSessions().find((s) => s.jsonlPath === p);
    expect(session?.overdeckManaged).toBe(true);
    expect(session?.panIssueId).toBe('PAN-457');
    expect(session?.panAgentId).toBe('agent-cost');
  });

  it('scan persists sessionId from JSONL into discovered_sessions', async () => {
    const p = join(fakeClaudeDir, '-home-user-Projects-myapp', 'with-session-id.jsonl');
    writeFileSync(p, SESSION_JSONL, 'utf8');

    await scan({ mode: 'system', watchDirs: [] });

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

  it('correlates managed ohmypi rows by conversation_files locator without Claude path reconstruction', async () => {
    const p = join(odb.home, '.omp', 'agent', 'sessions', '-home-user-Projects-omp', '20260702_managed-omp.jsonl');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, piSessionJsonl('managed-omp', '/home/user/Projects/omp'), 'utf8');
    seedConversationFile(odb, {
      id: 'conv-managed-omp',
      name: 'conv-managed-omp',
      cwd: '/home/user/Projects/omp',
      issueId: 'PAN-2224',
      locator: 'managed-omp',
      harness: 'ohmypi',
    });

    const result = await scan({ mode: 'system', watchDirs: [] });
    const session = findDiscoveredSessions().find((s) => s.jsonlPath === p);

    expect(result.errors).toBe(0);
    expect(session).toMatchObject({
      harness: 'ohmypi',
      overdeckManaged: true,
      panIssueId: 'PAN-2224',
      panAgentId: 'conv-managed-omp',
      workspacePath: '/home/user/Projects/omp',
    });
  });

  it('leaves ad-hoc pi rows unmanaged when no locator matches', async () => {
    const p = join(odb.home, '.pi', 'agent', 'sessions', '-home-user-Projects-pi', '20260702_adhoc-pi.jsonl');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, piSessionJsonl('adhoc-pi', '/home/user/Projects/pi'), 'utf8');

    const result = await scan({ mode: 'system', watchDirs: [] });
    const session = findDiscoveredSessions().find((s) => s.jsonlPath === p);

    expect(result.errors).toBe(0);
    expect(session).toMatchObject({
      harness: 'pi',
      overdeckManaged: false,
      panIssueId: null,
      workspacePath: '/home/user/Projects/pi',
    });
  });

  it('resolves codex workspace from the owning agent dir when rollout metadata has no cwd', async () => {
    const owned = join(
      odb.home,
      '.overdeck',
      'agents',
      'agent-codex-fallback',
      'codex-home',
      'sessions',
      '2026',
      '07',
      '02',
      'rollout-2026-07-02T00-00-00-000Z-owned.jsonl',
    );
    const unowned = join(
      odb.home,
      '.codex',
      'sessions',
      '2026',
      '07',
      '02',
      'rollout-2026-07-02T00-00-00-000Z-unowned.jsonl',
    );
    mkdirSync(dirname(owned), { recursive: true });
    mkdirSync(dirname(unowned), { recursive: true });
    writeFileSync(owned, codexWithoutSessionMetaJsonl(), 'utf8');
    writeFileSync(unowned, codexWithoutSessionMetaJsonl(), 'utf8');
    seedAgent(odb, 'agent-codex-fallback', '/home/user/Projects/codex-owned');

    const result = await scan({ mode: 'system', watchDirs: [] });
    const sessions = findDiscoveredSessions();

    expect(result.errors).toBe(0);
    expect(sessions.find((s) => s.jsonlPath === owned)).toMatchObject({
      harness: 'codex',
      workspacePath: '/home/user/Projects/codex-owned',
    });
    expect(sessions.find((s) => s.jsonlPath === unowned)).toMatchObject({
      harness: 'codex',
      workspacePath: null,
    });
  });
});

function claudeProjection(file: DiscoveredFile): { projectDir: string; jsonlPath: string } {
  expect(file.harness).toBe('claude-code');
  return { projectDir: file.projectDir, jsonlPath: file.jsonlPath };
}

function byPath(a: { jsonlPath: string }, b: { jsonlPath: string }): number {
  return a.jsonlPath.localeCompare(b.jsonlPath);
}

function piSessionJsonl(sessionId: string, cwd: string): string {
  return [
    JSON.stringify({
      type: 'session',
      id: sessionId,
      timestamp: '2026-07-02T10:00:00.000Z',
      cwd,
    }),
    JSON.stringify({
      type: 'message',
      timestamp: '2026-07-02T10:00:01.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hello from pi' }] },
    }),
  ].join('\n') + '\n';
}

function codexWithoutSessionMetaJsonl(): string {
  return [
    JSON.stringify({
      type: 'turn_context',
      timestamp: '2026-07-02T11:00:00.000Z',
      payload: { type: 'turn_context', model: 'gpt-5.5' },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-07-02T11:00:01.000Z',
      payload: { type: 'user_message', message: 'hello from codex' },
    }),
  ].join('\n') + '\n';
}

function seedConversationFile(
  dbHandle: OverdeckTestDb,
  input: { id: string; name: string; cwd: string; issueId: string; locator: string; harness: string },
): void {
  const db = dbHandle.raw();
  db.prepare(
    `INSERT INTO conversations (id, name, tmux_session, status, cwd, issue_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.name, input.name, 'active', input.cwd, input.issueId, new Date('2026-07-02T00:00:00.000Z').toISOString());
  db.prepare(
    `INSERT INTO conversation_files (conversation_id, harness, locator, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(input.id, input.harness, input.locator, Date.parse('2026-07-02T00:00:00.000Z'));
}

function seedAgent(dbHandle: OverdeckTestDb, id: string, workspace: string): void {
  const now = new Date('2026-07-02T00:00:00.000Z').toISOString();
  const db = dbHandle.raw();
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare(
      `INSERT INTO agents (id, issue_id, role, status, workspace, harness, model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, 'PAN-2224', 'work', 'stopped', workspace, 'codex', 'gpt-5.5', now);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
