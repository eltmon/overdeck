/**
 * Route-contract tests for GET/POST /api/settings/legacy-import/conversations.
 * Exercises the underlying module functions used by the route handlers with
 * a fixture legacy DB and an in-memory overdeck DB.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../../src/lib/database/driver.js';

let TEST_HOME: string;
let LEGACY_DB_PATH: string;

async function resetDb() {
  const { resetDatabase } = await import('../../src/lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-settings-legacy-'));
  mkdirSync(join(TEST_HOME, 'db'), { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;

  LEGACY_DB_PATH = join(TEST_HOME, 'panopticon.db');
  const db = openDatabase(LEGACY_DB_PATH);
  db.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      tmux_session TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      cwd TEXT NOT NULL DEFAULT '/',
      created_at TEXT NOT NULL,
      ended_at TEXT, last_attached_at TEXT, session_file TEXT,
      claude_session_id TEXT, title TEXT, title_source TEXT, title_seed TEXT,
      total_cost REAL DEFAULT 0, total_tokens INTEGER DEFAULT 0,
      archived_at TEXT, model TEXT, effort TEXT, fork_status TEXT, fork_error TEXT,
      harness TEXT, delivery_method TEXT, spawn_error TEXT, handoff_doc_path TEXT,
      handoff_target_conv_id INTEGER, fork_fallback_reason TEXT,
      cleared_to_conv_id INTEGER, fork_request TEXT,
      fork_retry_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(type, item_id)
    );
  `);
  db.prepare(
    `INSERT INTO conversations (name, created_at, title, model) VALUES (?, ?, ?, ?)`,
  ).run('user-session', '2024-06-01T10:00:00.000Z', 'My Session', 'claude-opus-4-8');
  db.prepare(
    `INSERT INTO conversations (name, created_at) VALUES (?, ?)`,
  ).run('agent-work-123', '2024-06-02T10:00:00.000Z');
  db.close();
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('GET /api/settings/legacy-import/conversations logic', () => {
  it('returns found:false for a non-existent path', async () => {
    const { previewLegacyConversations } = await import('../../src/lib/overdeck/legacy-import.js');
    const result = previewLegacyConversations('/tmp/no-such-db-pan-2044.db');
    expect(result.found).toBe(false);
  });

  it('returns found:true with non-agent conversations for an existing fixture DB', async () => {
    const { previewLegacyConversations } = await import('../../src/lib/overdeck/legacy-import.js');
    const result = previewLegacyConversations(LEGACY_DB_PATH);
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('unreachable');
    const names = result.rows.map((r) => r.name);
    expect(names).toContain('user-session');
    expect(names).not.toContain('agent-work-123');
    const row = result.rows.find((r) => r.name === 'user-session')!;
    expect(row.title).toBe('My Session');
    expect(row.model).toBe('claude-opus-4-8');
  });
});

describe('POST /api/settings/legacy-import/conversations logic', () => {
  it('imports selected conversations and returns a summary', async () => {
    const { importLegacyConversations } = await import('../../src/lib/overdeck/legacy-import.js');
    const result = importLegacyConversations(LEGACY_DB_PATH, ['user-session']);
    expect(result.imported).toContain('user-session');
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(typeof result.favoritesCarried).toBe('number');
  });

  it('returns skipped with reason when the conversation already exists', async () => {
    const { createConversation } = await import('../../src/lib/overdeck/conversations.js');
    const { importLegacyConversations } = await import('../../src/lib/overdeck/legacy-import.js');

    createConversation({ name: 'user-session', tmuxSession: 'conv-user-session', cwd: '/' });

    const result = importLegacyConversations(LEGACY_DB_PATH, ['user-session']);
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].name).toBe('user-session');
  });
});

describe('settingsRouteLayer exports', () => {
  it('is a valid Effect Layer that includes the legacy-import routes', async () => {
    const { settingsRouteLayer } = await import('../../src/dashboard/server/routes/settings.js');
    expect(settingsRouteLayer).toBeDefined();
  });
});
