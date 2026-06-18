/**
 * Tests for workspace-jx0iq — Cutover parity pass per domain.
 *
 * AC1: After cutover with an open GitHub issue + a live work-agent session,
 *      IssuesResolver returns the in-flight issue and AgentsResolver returns
 *      the work-agent row.
 * AC2: After cutover, ConversationsResolver returns the conversation metadata
 *      migrated from the legacy panopticon.db.
 * AC3: panopticon.db row counts are unchanged after cutover — the legacy file
 *      is opened read-only and never written to.
 * AC4: CutoverResult reports the correct counts for all three export steps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Layer } from 'effect';

import { openDatabase } from '../../../../src/lib/database/driver.js';
import { createOverdeckDatabase } from '../../../../scripts/create-overdeck-db.js';
import {
  makeDbLive,
  Projects,
  Records,
  Tmux,
} from '../../../../src/lib/overdeck/infra.js';
import {
  IssuesResolver,
  IssuesResolverLive,
} from '../../../../src/lib/overdeck/issues.js';
import {
  AgentsResolver,
  AgentsResolverLive,
} from '../../../../src/lib/overdeck/agents.js';
import {
  ConversationsResolver,
  ConversationsResolverLive,
} from '../../../../src/lib/overdeck/conversations.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
import type { ProjectConfig } from '../../../../src/lib/projects.js';
import {
  makeCutoverEffect,
  type CutoverOptions,
} from '../../../../src/lib/overdeck/cutover.js';

// ── Temp-dir lifecycle ────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pan-cutover-parity-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Legacy DB seed helper (mirrors g5-conversations-export.test.ts) ───────────

function createLegacyDb(dbPath: string) {
  const db = openDatabase(dbPath);

  db.exec(`
    CREATE TABLE conversations (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      name                   TEXT    NOT NULL UNIQUE,
      cwd                    TEXT    NOT NULL DEFAULT '/',
      status                 TEXT    NOT NULL DEFAULT 'active',
      issue_id               TEXT,
      claude_session_id      TEXT,
      title                  TEXT,
      title_source           TEXT,
      model                  TEXT,
      effort                 TEXT,
      harness                TEXT,
      created_at             TEXT    NOT NULL,
      archived_at            TEXT,
      handoff_doc_path       TEXT,
      handoff_target_conv_id INTEGER,
      cleared_to_conv_id     INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE favorites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(type, item_id)
    )
  `);

  return db;
}

// ── Fake service layers for the cutover's Projects / Records / Tmux deps ──────

const FAKE_PROJECT: ProjectConfig = {
  id: 'overdeck',
  name: 'overdeck',
  path: '/home/eltmon/Projects/overdeck',
  tracker: 'github',
  github_repo: 'eltmon/overdeck',
} as unknown as ProjectConfig;

function makeFakeProjectsLayer(issueId: string): Layer.Layer<Projects> {
  return Layer.succeed(
    Projects,
    Projects.of({
      list:         ()  => Effect.succeed([FAKE_PROJECT]),
      get:          ()  => Effect.succeed(null),
      resolveIssue: (id) => Effect.succeed(id === issueId ? FAKE_PROJECT : null),
    }),
  );
}

function makeFakeRecordsLayer(record: PanIssueRecord | null): Layer.Layer<Records> {
  return Layer.succeed(
    Records,
    Records.of({
      writeIssue:         () => Effect.succeed(join(tmpdir(), 'noop.json')),
      readIssue:          () => Effect.succeed(record),
      readSpec:           () => Effect.succeed(null),
      writeAgentIdentity: () => Effect.void,
    }),
  );
}

function makeFakeTmuxLayer(sessions: string[]): Layer.Layer<Tmux> {
  return Layer.succeed(
    Tmux,
    Tmux.of({
      sessionExists:   () => Effect.succeed(false),
      killSession:     () => Effect.void,
      readRuntimeJson: () => Effect.succeed(null),
      listSessions:    () => Effect.succeed(sessions),
    }),
  );
}

function makeRecord(issueId = 'PAN-1234'): PanIssueRecord {
  return {
    issueId,
    schemaVersion: 2,
    harness: 'claude-code',
    model:   'claude-sonnet-4-6',
    pipeline: {
      issueId,
      reviewStatus:  'pending',
      testStatus:    'pending',
      readyForMerge: false,
      updatedAt:     new Date().toISOString(),
    },
    closeOut: {
      usage:  { byStage: {}, totals: {} },
      merges: [],
      ranOn:  'test',
    },
  };
}

// ── Run the cutover Effect with the given opts + fake infra ───────────────────

async function runCutover(
  opts: CutoverOptions,
  {
    sessions = [],
    record   = null,
    issueId  = '',
  }: { sessions?: string[]; record?: PanIssueRecord | null; issueId?: string } = {},
) {
  // Caller must create the overdeck.db schema before seeding data.
  const overdeckDbPath = opts.overdeckDbPath!;
  createOverdeckDatabase({ dbPath: overdeckDbPath });

  return Effect.runPromise(
    makeCutoverEffect(opts).pipe(
      Effect.provide(makeFakeProjectsLayer(issueId)),
      Effect.provide(makeFakeRecordsLayer(record)),
      Effect.provide(makeFakeTmuxLayer(sessions)),
    ),
  );
}

// ── Read back per-domain state from the resulting overdeck.db ─────────────────

const FakeRecordsForRead = Layer.succeed(
  Records,
  Records.of({
    writeIssue:         () => Effect.succeed(join(tmpdir(), 'noop.json')),
    readIssue:          () => Effect.succeed(null),
    readSpec:           () => Effect.succeed(null),
    writeAgentIdentity: () => Effect.void,
  }),
);

const FakeTmuxForRead = Layer.succeed(
  Tmux,
  Tmux.of({
    sessionExists:   () => Effect.succeed(false),
    killSession:     () => Effect.void,
    readRuntimeJson: () => Effect.succeed(null),
    listSessions:    () => Effect.succeed([]),
  }),
);

async function readDomainState(overdeckDbPath: string) {
  const dbLayer  = makeDbLive(overdeckDbPath);
  const baseInfra = Layer.mergeAll(dbLayer, FakeRecordsForRead, FakeTmuxForRead);

  const resolverLayer = Layer.mergeAll(
    IssuesResolverLive,
    AgentsResolverLive,
    ConversationsResolverLive,
  ).pipe(Layer.provide(baseInfra));

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const issues        = yield* IssuesResolver.use((r) => r.list({}));
        const agents        = yield* AgentsResolver.use((r) => r.list({}));
        const conversations = yield* ConversationsResolver.use((r) => r.list({}));
        return { issues, agents, conversations };
      }).pipe(Effect.provide(resolverLayer)),
    ),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Cutover parity pass', () => {
  it('AC1: Issues domain has in-flight issue + agent after reconstruction', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');

    // Empty legacy DB (no conversations needed to test the issues domain).
    const legacy = createLegacyDb(legacyPath);
    legacy.close();

    const record = makeRecord('PAN-1234');
    await runCutover(
      {
        legacyDbPath:   legacyPath,
        overdeckDbPath: overdeckPath,
        sources:        { openIssueIds: new Set(['PAN-1234']) },
      },
      { sessions: ['agent-pan-1234'], record, issueId: 'PAN-1234' },
    );

    const { issues, agents } = await readDomainState(overdeckPath);

    const issue = issues.find((i) => i.id === 'PAN-1234');
    expect(issue).toBeDefined();
    expect(issue!.stage).toBe('working');

    const agent = agents.find((a) => a.id === 'agent-pan-1234');
    expect(agent).toBeDefined();
    expect(agent!.issueId).toBe('PAN-1234');
    expect(agent!.role).toBe('work');
    expect(agent!.status).toBe('running');
  });

  it('AC2: Conversations domain has migrated data after export', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');

    const legacy = createLegacyDb(legacyPath);
    legacy.prepare(
      'INSERT INTO conversations (name, cwd, claude_session_id, title, harness, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('conv-alpha', '/home/user', 'session-uuid-alpha', 'Alpha', 'claude-code', '2026-06-01T00:00:00.000Z');
    legacy.prepare(
      'INSERT INTO conversations (name, cwd, created_at) VALUES (?, ?, ?)',
    ).run('conv-beta', '/home/user', '2026-06-02T00:00:00.000Z');
    legacy.close();

    // Cutover with no open issues — only the conversation export matters here.
    await runCutover({
      legacyDbPath:   legacyPath,
      overdeckDbPath: overdeckPath,
      sources:        { openIssueIds: new Set() },
    });

    const { conversations } = await readDomainState(overdeckPath);

    expect(conversations).toHaveLength(2);
    const alpha = conversations.find((c) => c.name === 'conv-alpha');
    expect(alpha).toBeDefined();
    expect(alpha!.files).toHaveLength(1);
    expect(alpha!.files[0].locator).toBe('session-uuid-alpha');
    expect(alpha!.files[0].harness).toBe('claude-code');

    const beta = conversations.find((c) => c.name === 'conv-beta');
    expect(beta).toBeDefined();
    expect(beta!.files).toHaveLength(0);
  });

  it('AC3: panopticon.db is not modified by the cutover (row count is unchanged)', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');

    const legacy = createLegacyDb(legacyPath);
    legacy.prepare(
      'INSERT INTO conversations (name, cwd, created_at) VALUES (?, ?, ?)',
    ).run('conv-guard', '/tmp', '2026-06-01T00:00:00.000Z');
    legacy.close();

    // Snapshot the row count before cutover.
    const beforeDb    = openDatabase(legacyPath);
    const beforeCount = beforeDb.prepare('SELECT COUNT(*) AS n FROM conversations').get<{ n: number }>()!.n;
    beforeDb.close();

    await runCutover({
      legacyDbPath:   legacyPath,
      overdeckDbPath: overdeckPath,
      sources:        { openIssueIds: new Set() },
    });

    // Row count must be identical — no INSERTs or UPDATEs touched legacy.
    const afterDb    = openDatabase(legacyPath);
    const afterCount = afterDb.prepare('SELECT COUNT(*) AS n FROM conversations').get<{ n: number }>()!.n;
    afterDb.close();

    expect(afterCount).toBe(beforeCount);
  });

  it('AC4: CutoverResult reports correct counts across all three steps', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');

    const legacy = createLegacyDb(legacyPath);
    legacy.prepare(
      'INSERT INTO conversations (name, cwd, claude_session_id, created_at) VALUES (?, ?, ?, ?)',
    ).run('conv-x', '/tmp', 'sess-x', '2026-06-01T00:00:00.000Z');
    legacy.prepare(
      'INSERT INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)',
    ).run('conversation', 'conv-x', '2026-06-01T00:00:00.000Z');
    legacy.close();

    const record = makeRecord('PAN-999');
    const result = await runCutover(
      {
        legacyDbPath:   legacyPath,
        overdeckDbPath: overdeckPath,
        sources:        { openIssueIds: new Set(['PAN-999']) },
      },
      { sessions: [], record, issueId: 'PAN-999' },
    );

    expect(result.overdeckDbPath).toBe(overdeckPath);
    expect(result.conversationsExported).toBe(1);
    expect(result.conversationFilesExported).toBe(1);  // sess-x → conversation_files
    expect(result.favoritesExported).toBe(1);
    expect(result.issuesUpserted).toBe(1);             // PAN-999 in open set
    expect(result.agentsUpserted).toBe(0);             // no live session
  });
});
