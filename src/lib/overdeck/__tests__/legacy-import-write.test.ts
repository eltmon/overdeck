import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../../database/driver.js';

let TEST_HOME: string;
let LEGACY_DB_PATH: string;

async function resetDb() {
  const { resetDatabase } = await import('../../database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-legacy-write-test-'));
  mkdirSync(join(TEST_HOME, 'db'), { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;

  LEGACY_DB_PATH = join(TEST_HOME, 'legacy.db');
  const legacyDb = openDatabase(LEGACY_DB_PATH);
  legacyDb.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      tmux_session TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      cwd TEXT NOT NULL DEFAULT '/',
      created_at TEXT NOT NULL,
      ended_at TEXT,
      last_attached_at TEXT,
      session_file TEXT,
      claude_session_id TEXT,
      title TEXT,
      title_source TEXT,
      title_seed TEXT,
      total_cost REAL DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      archived_at TEXT,
      model TEXT,
      effort TEXT,
      fork_status TEXT,
      fork_error TEXT,
      harness TEXT,
      delivery_method TEXT,
      spawn_error TEXT,
      handoff_doc_path TEXT,
      handoff_target_conv_id INTEGER,
      fork_fallback_reason TEXT,
      cleared_to_conv_id INTEGER,
      fork_request TEXT,
      fork_retry_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(type, item_id)
    );
  `);
  legacyDb.close();
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

function seedLegacy(rows: {
  name: string;
  created_at: string;
  title?: string | null;
  model?: string | null;
  claude_session_id?: string | null;
  archived_at?: string | null;
  total_cost?: number;
  total_tokens?: number;
  handoff_target_conv_id?: number | null;
  cleared_to_conv_id?: number | null;
}[]): void {
  const db = openDatabase(LEGACY_DB_PATH);
  const ins = db.prepare(
    `INSERT INTO conversations (name, created_at, title, model, claude_session_id, archived_at, total_cost, total_tokens, handoff_target_conv_id, cleared_to_conv_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    ins.run(
      r.name,
      r.created_at,
      r.title ?? null,
      r.model ?? null,
      r.claude_session_id ?? null,
      r.archived_at ?? null,
      r.total_cost ?? 0,
      r.total_tokens ?? 0,
      r.handoff_target_conv_id ?? null,
      r.cleared_to_conv_id ?? null,
    );
  }
  db.close();
}

function seedLegacyFavorite(name: string): void {
  const db = openDatabase(LEGACY_DB_PATH);
  db.prepare(`INSERT OR IGNORE INTO favorites (type, item_id, created_at) VALUES ('conversation', ?, '2024-01-01')`).run(name);
  db.close();
}

describe('importLegacyConversation (write door)', () => {
  it('inserts a row and registers a conversation_files locator when claudeSessionId is present', async () => {
    const { importLegacyConversation } = await import('../conversations.js');
    const { getOverdeckDatabaseSync } = await import('../infra.js');

    const { uuid } = importLegacyConversation({
      name: 'my-conv',
      tmuxSession: null,
      status: 'active',
      cwd: '/home/user',
      createdAt: new Date('2024-03-15T10:00:00.000Z').getTime(),
      endedAt: null,
      lastAttachedAt: null,
      sessionFile: null,
      claudeSessionId: 'sess-xyz',
      title: 'My Conversation',
      titleSource: 'auto',
      titleSeed: 'My Conversation',
      totalCost: 1.5,
      totalTokens: 3000,
      archivedAt: null,
      model: 'claude-opus-4-8',
      effort: 'medium',
      forkStatus: null,
      forkError: null,
      harness: 'claude-code',
      deliveryMethod: null,
      spawnError: null,
      handoffDocPath: null,
      forkFallbackReason: null,
      forkRequest: null,
      forkRetryCount: 0,
    });

    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(10);

    const db = getOverdeckDatabaseSync();
    const conv = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(uuid) as Record<string, unknown> | undefined;
    expect(conv).toBeDefined();
    expect(conv!.name).toBe('my-conv');
    expect(conv!.title).toBe('My Conversation');
    expect(conv!.title_source).toBe('auto');
    expect(conv!.total_cost).toBe(1.5);
    expect(conv!.total_tokens).toBe(3000);
    expect(conv!.model).toBe('claude-opus-4-8');
    expect(conv!.created_at).toBe(new Date('2024-03-15T10:00:00.000Z').getTime());
    expect(conv!.archived_at).toBeNull();
    expect(conv!.handoff_target_conv_id).toBeNull();
    expect(conv!.cleared_to_conv_id).toBeNull();

    const file = db.prepare(`SELECT locator FROM conversation_files WHERE conversation_id = ?`).get(uuid) as { locator: string } | undefined;
    expect(file?.locator).toBe('sess-xyz');
  });

  it('does not issue DELETE against the conversations table (no createConversation behaviour)', async () => {
    const { createConversation, importLegacyConversation, getConversationByName } = await import('../conversations.js');

    createConversation({ name: 'existing-conv', tmuxSession: 'conv-existing-conv', cwd: '/', title: 'Keep me' });

    importLegacyConversation({
      name: 'new-import',
      tmuxSession: null,
      status: 'active',
      cwd: '/',
      createdAt: Date.now(),
      endedAt: null,
      lastAttachedAt: null,
      sessionFile: null,
      claudeSessionId: null,
      title: 'Imported',
      titleSource: null,
      titleSeed: null,
      totalCost: 0,
      totalTokens: 0,
      archivedAt: null,
      model: null,
      effort: null,
      forkStatus: null,
      forkError: null,
      harness: null,
      deliveryMethod: null,
      spawnError: null,
      handoffDocPath: null,
      forkFallbackReason: null,
      forkRequest: null,
      forkRetryCount: 0,
    });

    const existing = getConversationByName('existing-conv');
    expect(existing).not.toBeNull();
    expect(existing!.title).toBe('Keep me');
  });
});

describe('importLegacyConversations (orchestration)', () => {
  it('skips and reports a row already present by name', async () => {
    const { createConversation } = await import('../conversations.js');
    const { importLegacyConversations } = await import('../legacy-import.js');

    createConversation({ name: 'pre-existing', tmuxSession: 'conv-pre-existing', cwd: '/' });
    seedLegacy([{ name: 'pre-existing', created_at: '2024-01-01T00:00:00.000Z' }]);

    const result = importLegacyConversations(LEGACY_DB_PATH, ['pre-existing']);
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].name).toBe('pre-existing');
  });

  it('skips and reports a row with a matching claude_session_id', async () => {
    const { createConversation } = await import('../conversations.js');
    const { getOverdeckDatabaseSync } = await import('../infra.js');
    const { importLegacyConversations } = await import('../legacy-import.js');

    const conv = createConversation({ name: 'session-owner', tmuxSession: 'conv-session-owner', cwd: '/', claudeSessionId: 'sess-already' });
    // conversation_files already inserted by createConversation
    void conv;

    seedLegacy([{ name: 'other-conv', created_at: '2024-01-01T00:00:00.000Z', claude_session_id: 'sess-already' }]);
    const result = importLegacyConversations(LEGACY_DB_PATH, ['other-conv']);
    expect(result.skipped[0]?.reason).toContain('claude_session_id');
    void getOverdeckDatabaseSync;
  });

  it('fails a row with an unparseable created_at and does not insert it', async () => {
    const { importLegacyConversations } = await import('../legacy-import.js');
    const { getOverdeckDatabaseSync } = await import('../infra.js');

    seedLegacy([{ name: 'bad-date', created_at: 'not-a-date' }]);
    const result = importLegacyConversations(LEGACY_DB_PATH, ['bad-date']);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe('bad-date');
    expect(result.imported).toHaveLength(0);

    const db = getOverdeckDatabaseSync();
    const row = db.prepare(`SELECT id FROM conversations WHERE name = 'bad-date'`).get();
    expect(row).toBeUndefined();
  });

  it('remaps handoff_target_conv_id and cleared_to_conv_id when both targets are imported', async () => {
    const { importLegacyConversations } = await import('../legacy-import.js');
    const { getOverdeckDatabaseSync } = await import('../infra.js');

    const legacyDb = openDatabase(LEGACY_DB_PATH);
    legacyDb.prepare(
      `INSERT INTO conversations (name, created_at) VALUES ('source', '2024-01-01T00:00:00.000Z')`,
    ).run();
    const sourceId = (legacyDb.prepare(`SELECT id FROM conversations WHERE name = 'source'`).get() as { id: number }).id;
    legacyDb.prepare(
      `INSERT INTO conversations (name, created_at) VALUES ('target', '2024-01-02T00:00:00.000Z')`,
    ).run();
    const targetId = (legacyDb.prepare(`SELECT id FROM conversations WHERE name = 'target'`).get() as { id: number }).id;
    legacyDb.prepare(
      `UPDATE conversations SET handoff_target_conv_id = ?, cleared_to_conv_id = ? WHERE name = 'source'`,
    ).run(targetId, targetId);
    legacyDb.close();

    const result = importLegacyConversations(LEGACY_DB_PATH, ['source', 'target']);
    expect(result.imported).toContain('source');
    expect(result.imported).toContain('target');
    expect(result.warnings).toHaveLength(0);

    const db = getOverdeckDatabaseSync();
    const sourceRow = db.prepare(`SELECT handoff_target_conv_id, cleared_to_conv_id FROM conversations WHERE name = 'source'`).get() as Record<string, unknown>;
    const targetRow = db.prepare(`SELECT id FROM conversations WHERE name = 'target'`).get() as { id: string };
    expect(sourceRow.handoff_target_conv_id).toBe(targetRow.id);
    expect(sourceRow.cleared_to_conv_id).toBe(targetRow.id);
    void sourceId;
  });

  it('sets FK to NULL and adds warning when target was not imported', async () => {
    const { importLegacyConversations } = await import('../legacy-import.js');
    const { getOverdeckDatabaseSync } = await import('../infra.js');

    const legacyDb = openDatabase(LEGACY_DB_PATH);
    legacyDb.prepare(`INSERT INTO conversations (name, created_at) VALUES ('source', '2024-01-01T00:00:00.000Z')`).run();
    legacyDb.prepare(`UPDATE conversations SET handoff_target_conv_id = 999 WHERE name = 'source'`).run();
    legacyDb.close();

    const result = importLegacyConversations(LEGACY_DB_PATH, ['source']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].name).toBe('source');

    const db = getOverdeckDatabaseSync();
    const row = db.prepare(`SELECT handoff_target_conv_id FROM conversations WHERE name = 'source'`).get() as Record<string, unknown>;
    expect(row.handoff_target_conv_id).toBeNull();
  });

  it('skips and reports agent/planning/specialist names even when explicitly requested', async () => {
    const { importLegacyConversations } = await import('../legacy-import.js');
    const { getOverdeckDatabaseSync } = await import('../infra.js');

    seedLegacy([
      { name: 'agent-work-pan-2044', created_at: '2024-01-01T00:00:00.000Z' },
      { name: 'planning-pan-2044', created_at: '2024-01-01T00:00:00.000Z' },
      { name: 'user-session', created_at: '2024-01-01T00:00:00.000Z' },
    ]);

    const result = importLegacyConversations(LEGACY_DB_PATH, ['agent-work-pan-2044', 'planning-pan-2044', 'user-session']);
    expect(result.imported).toContain('user-session');
    expect(result.imported).not.toContain('agent-work-pan-2044');
    expect(result.imported).not.toContain('planning-pan-2044');
    expect(result.skipped.map((s) => s.name)).toContain('agent-work-pan-2044');
    expect(result.skipped.map((s) => s.name)).toContain('planning-pan-2044');

    const db = getOverdeckDatabaseSync();
    expect(db.prepare(`SELECT id FROM conversations WHERE name = 'agent-work-pan-2044'`).get()).toBeUndefined();
  });

  it('carries favorites for imported conversations', async () => {
    const { importLegacyConversations } = await import('../legacy-import.js');
    const { listFavoritedIds } = await import('../conversations.js');

    seedLegacy([{ name: 'fav-conv', created_at: '2024-01-01T00:00:00.000Z' }]);
    seedLegacyFavorite('fav-conv');

    const result = importLegacyConversations(LEGACY_DB_PATH, ['fav-conv']);
    expect(result.imported).toContain('fav-conv');
    expect(result.favoritesCarried).toBe(1);

    const favs = listFavoritedIds('conversation');
    expect(favs).toContain('fav-conv');
  });
});
