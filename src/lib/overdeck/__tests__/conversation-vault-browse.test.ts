/**
 * PAN-4436: Session Vault browse copies in `conversations` — the origin columns,
 * the browse-row door, and the readers that must never see a browse row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when the path helpers load, so set it before the
// first dynamic import of the infra and conversation modules.
const TEST_HOME = join(tmpdir(), `vault-browse-rows-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../infra.js');
const { OVERDECK_MIGRATION_PATH } = await import('../paths.js');
const { openDatabase } = await import('../../database/driver.js');
const {
  archiveConversation,
  createConversation,
  getConversationByName,
  listConversations,
  listVaultBrowseConversations,
  setConversationProjectKey,
} = await import('../conversations.js');
const { removeVaultBrowseRow, upsertVaultBrowseRow, vaultBrowseReadOnlyMessage } = await import('../conversation-vault-rows.js');

const CWD = join(TEST_HOME, 'projects', 'lexerra');

function vaultId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function input(id: string, extra: Partial<Parameters<typeof upsertVaultBrowseRow>[0]> = {}) {
  return {
    vaultId: id,
    title: 'saved on the laptop',
    harness: 'claude-code' as const,
    ownerLabel: 'laptop',
    cwd: '/home/other/proj',
    model: 'claude-opus-5-5',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    ...extra,
  };
}

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('browse-row door (PAN-4436 WI-3)', () => {
  it('inserts an ended vault row with no conversation files', () => {
    const id = vaultId(1);
    expect(upsertVaultBrowseRow(input(id))).toBe('inserted');
    const row = getConversationByName(`vault-${id}`);
    expect(row).toMatchObject({
      origin: 'vault',
      status: 'ended',
      vaultOwnerLabel: 'laptop',
      title: 'saved on the laptop',
      titleSource: 'manual',
      tmuxSession: `conv-vault-${id}`,
      harness: 'claude-code',
      cwd: '/home/other/proj',
      archivedAt: null,
    });
    expect(row?.endedAt).not.toBeNull();
    const files = getOverdeckDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM conversation_files cf JOIN conversations c ON c.id = cf.conversation_id WHERE c.name = ?`)
      .get(`vault-${id}`) as { n: number };
    expect(files.n).toBe(0);
    expect(vaultBrowseReadOnlyMessage(row!)).toBe(`Read-only copy from laptop. To continue it here, run: pan vault resume ${id}`);
  });

  it('reports updated for a new title and unchanged for identical input', () => {
    const id = vaultId(2);
    upsertVaultBrowseRow(input(id));
    expect(upsertVaultBrowseRow(input(id, { title: 'renamed' }))).toBe('updated');
    expect(getConversationByName(`vault-${id}`)?.title).toBe('renamed');
    expect(upsertVaultBrowseRow(input(id, { title: 'renamed' }))).toBe('unchanged');
  });

  it('never writes a null ended_at, even for an unparseable timestamp', () => {
    const id = vaultId(3);
    upsertVaultBrowseRow(input(id, { updatedAt: 'not a date', createdAt: 'nope' }));
    expect(getConversationByName(`vault-${id}`)?.endedAt).not.toBeNull();
  });

  it('keeps archive state and project key across an upsert', () => {
    const id = vaultId(4);
    upsertVaultBrowseRow(input(id));
    archiveConversation(`vault-${id}`);
    setConversationProjectKey(`vault-${id}`, 'overdeck');
    expect(upsertVaultBrowseRow(input(id, { title: 'new title' }))).toBe('updated');
    const row = getConversationByName(`vault-${id}`);
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.projectKey).toBe('overdeck');
    expect(row?.title).toBe('new title');
  });

  it('returns conflict and leaves a local row holding the name untouched', () => {
    const id = vaultId(5);
    getOverdeckDatabase()
      .prepare(`INSERT INTO conversations (id, name, cwd, title, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('local-5', `vault-${id}`, CWD, 'local title', 1);
    expect(upsertVaultBrowseRow(input(id))).toBe('conflict');
    expect(getConversationByName(`vault-${id}`)).toMatchObject({ origin: 'local', title: 'local title', cwd: CWD });
    expect(removeVaultBrowseRow(id)).toBe(false);
    expect(getConversationByName(`vault-${id}`)).not.toBeNull();
  });

  it('listConversations omits browse rows; listVaultBrowseConversations returns only them', () => {
    const id = vaultId(6);
    upsertVaultBrowseRow(input(id));
    createConversation({ name: 'local-list-6', tmuxSession: 'conv-local-list-6', cwd: CWD, workspaceId: null });
    const local = listConversations();
    expect(local.map((row) => row.name)).toContain('local-list-6');
    expect(local.map((row) => row.name)).not.toContain(`vault-${id}`);
    expect(local.some((row) => row.origin === 'vault')).toBe(false);
    const browse = listVaultBrowseConversations();
    expect(browse.map((row) => row.name)).toContain(`vault-${id}`);
    expect(browse.every((row) => row.origin === 'vault')).toBe(true);
  });

  it('reserves the vault- name prefix', () => {
    expect(() => createConversation({ name: 'vault-x', tmuxSession: 'conv-vault-x', cwd: CWD, workspaceId: null }))
      .toThrow('conversation names starting with "vault-" are reserved for Session Vault browse copies');
  });

  it('removes a browse row that a local fork points at, detaching the fork', () => {
    const id = vaultId(7);
    upsertVaultBrowseRow(input(id));
    createConversation({ name: 'fork-of-7', tmuxSession: 'conv-fork-of-7', cwd: CWD, workspaceId: null, parentName: `vault-${id}` });
    expect(getConversationByName('fork-of-7')?.parentConversationId).not.toBeNull();
    expect(removeVaultBrowseRow(id)).toBe(true);
    expect(getConversationByName(`vault-${id}`)).toBeNull();
    expect(getConversationByName('fork-of-7')?.parentConversationId).toBeNull();
    expect(removeVaultBrowseRow(id)).toBe(false);
  });
});

describe('origin column top-ups (PAN-4436 WI-3)', () => {
  const COLUMNS = ['origin', 'vault_owner_label'];
  let dbPath = '';

  afterEach(() => {
    vi.restoreAllMocks();
    closeOverdeckDatabase();
    if (dbPath) rmSync(join(dbPath, '..'), { recursive: true, force: true });
    dbPath = '';
  });

  function columns(db: ReturnType<typeof getOverdeckDatabase>): string[] {
    return db.prepare('PRAGMA table_info(conversations)').all<{ name: string }>().map((column) => column.name);
  }

  it('adds both columns to a database created without them, silently on the second run', () => {
    const dir = join(TEST_HOME, 'pre-4436');
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, 'overdeck.db');

    // A database from before this change: the init migration without the two lines.
    const migration = readFileSync(OVERDECK_MIGRATION_PATH, 'utf8')
      .split('\n')
      .filter((line) => !/^\t`(origin|vault_owner_label)` /.test(line))
      .join('\n');
    const raw = openDatabase(dbPath);
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
    for (const column of COLUMNS) expect(columns(raw)).not.toContain(column);
    raw.close();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upgraded = getOverdeckDatabase(dbPath);
    for (const column of COLUMNS) expect(columns(upgraded)).toContain(column);
    upgraded.prepare('INSERT INTO conversations (id, name, cwd, created_at) VALUES (?, ?, ?, ?)').run('u1', 'probe', '/w', 1);
    expect(upgraded.prepare('SELECT origin FROM conversations WHERE id = ?').get('u1')).toEqual({ origin: 'local' });
    expect(errorSpy).not.toHaveBeenCalled();

    closeOverdeckDatabase();
    getOverdeckDatabase(dbPath);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
