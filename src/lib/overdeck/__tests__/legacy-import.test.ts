import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../database/driver.js';

vi.mock('../conversations.js', () => ({
  isAgentConversationName: (name: string) =>
    ['agent-', 'planning-', 'specialist-'].some((p) => name.startsWith(p)),
  getConversationByName: (name: string) => (name === 'already-here' ? { id: '1' } : null),
}));

import { previewLegacyConversations } from '../legacy-import.js';

function buildFixtureDb(dir: string): string {
  const dbPath = join(dir, 'legacy.db');
  const db = openDatabase(dbPath);
  db.exec(`
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      tmux_session TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      cwd TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_attached_at TEXT,
      claude_session_id TEXT,
      title TEXT,
      model TEXT,
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

  const ins = db.prepare(
    `INSERT INTO conversations (name, tmux_session, cwd, created_at, title, model, claude_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run('user-convo-one', 'tmux-1', '/tmp', '2024-01-01T00:00:00.000Z', 'First Conv', 'claude-opus-4-8', 'sess-abc');
  ins.run('already-here', 'tmux-2', '/tmp', '2024-01-02T00:00:00.000Z', 'Already Imported', null, null);
  ins.run('agent-work-123', 'tmux-3', '/tmp', '2024-01-03T00:00:00.000Z', 'Agent', null, null);
  ins.run('planning-pan-99', 'tmux-4', '/tmp', '2024-01-04T00:00:00.000Z', 'Planner', null, null);
  ins.run('specialist-rev', 'tmux-5', '/tmp', '2024-01-05T00:00:00.000Z', 'Specialist', null, null);

  db.prepare(
    `INSERT INTO favorites (type, item_id, created_at) VALUES ('conversation', 'user-convo-one', '2024-01-01T00:00:00.000Z')`,
  ).run();

  db.close();
  return dbPath;
}

describe('previewLegacyConversations', () => {
  it('returns found:false for a non-existent path', () => {
    const result = previewLegacyConversations('/tmp/definitely-does-not-exist-pan-2044.db');
    expect(result).toEqual({ found: false });
  });

  it('excludes agent/planning/specialist conversations and returns correct shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-legacy-test-'));
    try {
      const dbPath = buildFixtureDb(dir);
      const result = previewLegacyConversations(dbPath);

      expect(result.found).toBe(true);
      if (!result.found) throw new Error('unreachable');

      expect(result.rows.map((r) => r.name)).toEqual(['already-here', 'user-convo-one']);

      const fav = result.rows.find((r) => r.name === 'user-convo-one')!;
      expect(fav.hasFavorite).toBe(true);
      expect(fav.claudeSessionId).toBe('sess-abc');
      expect(fav.model).toBe('claude-opus-4-8');
      expect(fav.alreadyImported).toBe(false);

      const existing = result.rows.find((r) => r.name === 'already-here')!;
      expect(existing.alreadyImported).toBe(true);
      expect(existing.hasFavorite).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
