/**
 * Build gate G5 — PAN-1937 conversation-metadata export.
 *
 * AC1: Export reads conversations + favorites from panopticon.db and populates
 *      overdeck.db; the metadata set is preserved.
 * AC2: Round-trip: every migrated conversation is readable via ConversationsResolver
 *      with correct field values, including the synthesised conversation_files pointer
 *      (locator = legacy claude_session_id).
 * AC3: JSONL backing files are never touched — the function only reads/writes DBs.
 * AC4: Lineage edges (handoff_target_conv_id / cleared_to_conv_id) resolve correctly
 *      after the INTEGER → UUID PK migration.
 * AC5: Re-running exportLegacyConversations is idempotent (INSERT OR IGNORE).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Layer } from 'effect';

import { openDatabase } from '../../../../src/lib/database/driver.js';
import { createOverdeckDatabase } from '../../../../scripts/create-overdeck-db.js';
import { makeDbLive } from '../../../../src/lib/overdeck/infra.js';
import {
  ConversationsResolver,
  ConversationsResolverLive,
} from '../../../../src/lib/overdeck/conversations.js';
import { exportLegacyConversations } from '../../../../src/lib/overdeck/conversations-export.js';

// ── Test directory helpers ────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pan-g5-export-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Legacy DB seed helpers ────────────────────────────────────────────────────

function createLegacyDb(dbPath: string) {
  const db = openDatabase(dbPath);

  // Minimal legacy schema — only the columns exportLegacyConversations reads.
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

// ── Read-back helper: run the ConversationsResolver against a real overdeck DB ──

async function readAllConversations(overdeckDbPath: string) {
  return Effect.runPromise(
    ConversationsResolver.use((r) => r.list({})).pipe(
      Effect.provide(
        Layer.provide(ConversationsResolverLive, makeDbLive(overdeckDbPath)),
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('G5 — exportLegacyConversations', () => {
  it('AC1 + AC2: migrates conversations, favorites, and synthesises conversation_files', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');
    createOverdeckDatabase({ dbPath: overdeckPath });

    const legacy = createLegacyDb(legacyPath);
    legacy.prepare(`
      INSERT INTO conversations (name, cwd, claude_session_id, title, title_source, model, effort, harness, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('conv-alpha', '/home/user/proj', 'session-uuid-alpha', 'Alpha conv', 'manual', 'claude-opus-4-8', 'high', 'claude-code', '2026-06-01T00:00:00.000Z');

    legacy.prepare(`
      INSERT INTO conversations (name, cwd, claude_session_id, title, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('conv-beta', '/home/user/proj2', null, 'Beta conv', '2026-06-02T00:00:00.000Z');

    legacy.prepare(`
      INSERT INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)
    `).run('conversation', 'conv-alpha', '2026-06-03T00:00:00.000Z');

    legacy.close();

    const result = exportLegacyConversations(legacyPath, overdeckPath);

    expect(result.conversations).toBe(2);
    expect(result.favorites).toBe(1);
    expect(result.conversationFiles).toBe(1);   // only conv-alpha has claude_session_id

    // Read back via ConversationsResolver (the overdeck read door)
    const convs = await readAllConversations(overdeckPath);
    expect(convs).toHaveLength(2);

    const alpha = convs.find((c) => c.name === 'conv-alpha');
    expect(alpha).toBeDefined();
    expect(alpha!.title).toBe('Alpha conv');
    expect(alpha!.titleSource).toBe('manual');
    expect(alpha!.model).toBe('claude-opus-4-8');
    expect(alpha!.effort).toBe('high');
    expect(alpha!.harness).toBe('claude-code');
    expect(alpha!.cwd).toBe('/home/user/proj');
    expect(alpha!.archivedAt).toBeNull();
    // The synthesised conversation_files row must be returned on the conversation
    expect(alpha!.files).toHaveLength(1);
    expect(alpha!.files[0].locator).toBe('session-uuid-alpha');
    expect(alpha!.files[0].harness).toBe('claude-code');

    const beta = convs.find((c) => c.name === 'conv-beta');
    expect(beta).toBeDefined();
    expect(beta!.files).toHaveLength(0);   // no claude_session_id
  });

  it('AC4: resolves lineage edges (handoff / clear) across INTEGER → UUID PK change', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');
    createOverdeckDatabase({ dbPath: overdeckPath });

    const legacy = createLegacyDb(legacyPath);

    // conv-src (id=1) is cleared to conv-dst (id=2).
    // conv-src (id=1) also has a handoff to conv-dst (id=2).
    legacy.prepare(`
      INSERT INTO conversations (name, cwd, created_at) VALUES (?, ?, ?)
    `).run('conv-dst', '/home/user/proj', '2026-06-01T00:00:00.000Z');

    legacy.prepare(`
      INSERT INTO conversations (name, cwd, cleared_to_conv_id, handoff_target_conv_id,
                                 handoff_doc_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('conv-src', '/home/user/proj', 1, 1, '/home/user/.overdeck/handoffs/doc.md', '2026-06-01T01:00:00.000Z');

    legacy.close();

    exportLegacyConversations(legacyPath, overdeckPath);

    const convs = await readAllConversations(overdeckPath);
    const src = convs.find((c) => c.name === 'conv-src');
    const dst = convs.find((c) => c.name === 'conv-dst');

    expect(src).toBeDefined();
    expect(dst).toBeDefined();
    // The lineage edge should point to the new UUID id of conv-dst
    expect(src!.clearedToConvId).toBe(dst!.id);
    expect(src!.handoffTargetConvId).toBe(dst!.id);
    expect(src!.handoffDocPath).toBe('/home/user/.overdeck/handoffs/doc.md');
  });

  it('AC3: archived_at is preserved and readable', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');
    createOverdeckDatabase({ dbPath: overdeckPath });

    const legacy = createLegacyDb(legacyPath);
    legacy.prepare(`
      INSERT INTO conversations (name, cwd, created_at, archived_at)
      VALUES (?, ?, ?, ?)
    `).run('conv-archived', '/tmp', '2026-05-01T00:00:00.000Z', '2026-05-15T12:00:00.000Z');
    legacy.close();

    exportLegacyConversations(legacyPath, overdeckPath);

    const convs = await readAllConversations(overdeckPath);
    const archived = convs.find((c) => c.name === 'conv-archived');
    expect(archived).toBeDefined();
    expect(archived!.archivedAt).toBeInstanceOf(Date);
    expect(archived!.archivedAt!.toISOString()).toMatch(/^2026-05-15/);
  });

  it('AC5: re-running is idempotent — rows are not duplicated', async () => {
    const legacyPath   = join(tempDir, 'panopticon.db');
    const overdeckPath = join(tempDir, 'overdeck.db');
    createOverdeckDatabase({ dbPath: overdeckPath });

    const legacy = createLegacyDb(legacyPath);
    legacy.prepare(`
      INSERT INTO conversations (name, cwd, claude_session_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run('conv-idem', '/tmp', 'uuid-idem', '2026-06-10T00:00:00.000Z');
    legacy.close();

    exportLegacyConversations(legacyPath, overdeckPath);
    // Second run must not throw or duplicate
    const result2 = exportLegacyConversations(legacyPath, overdeckPath);
    expect(result2.conversations).toBe(1);

    const convs = await readAllConversations(overdeckPath);
    // INSERT OR IGNORE means only one row exists
    expect(convs.filter((c) => c.name === 'conv-idem')).toHaveLength(1);
  });
});
