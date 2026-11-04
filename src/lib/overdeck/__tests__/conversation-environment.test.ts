/**
 * PAN-4645 WI-9: the conversations owner column. A pre-change database gains
 * `environment_id` and `released_to` silently; the boot backfill stamps every
 * local row; inserts carry the local environment id; reads expose both fields.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// OVERDECK_HOME is captured when the path helpers load, so set it before the
// first dynamic import of the infra and conversation modules.
const TEST_HOME = join(tmpdir(), `conversation-environment-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
delete process.env.OVERDECK_DISABLE_DEACON;

vi.mock('../../../dashboard/server/event-store.js', () => ({ getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })) }));

const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../infra.js');
const { OVERDECK_MIGRATION_PATH } = await import('../paths.js');
const { openDatabase } = await import('../../database/driver.js');
const { createConversation, getConversationByName } = await import('../conversations.js');
const {
  _resetConversationEnvironmentForTests,
  backfillLocalConversationEnvironmentIds,
  bootConversationEnvironment,
  localEnvironmentId,
  setLocalEnvironmentId,
} = await import('../conversation-environment.js');
const { upsertVaultBrowseRow } = await import('../conversation-vault-rows.js');

const CWD = join(TEST_HOME, 'projects', 'demo');

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetConversationEnvironmentForTests();
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

function columns(db: ReturnType<typeof getOverdeckDatabase>): string[] {
  return db.prepare('PRAGMA table_info(conversations)').all<{ name: string }>().map((column) => column.name);
}

describe('owner column top-ups (PAN-4645 WI-9)', () => {
  const COLUMNS = ['environment_id', 'released_to'];

  it('ac1: a database created without the columns gains both, silently on the second open', () => {
    const dir = join(TEST_HOME, 'pre-4645');
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'overdeck.db');
    // Strip the two columns from the conversations table only (linked_conversations has its own environment_id).
    const withoutColumns = (statement: string): string => (/CREATE TABLE `conversations` /.test(statement)
      ? statement.split('\n').filter((line) => !/^\t`(environment_id|released_to)` /.test(line)).join('\n')
      : statement);
    const raw = openDatabase(dbPath);
    for (const statement of readFileSync(OVERDECK_MIGRATION_PATH, 'utf8').split('--> statement-breakpoint').map(withoutColumns)) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
    for (const column of COLUMNS) expect(columns(raw)).not.toContain(column);
    raw.close();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upgraded = getOverdeckDatabase(dbPath);
    for (const column of COLUMNS) expect(columns(upgraded)).toContain(column);
    const indexes = upgraded.prepare('PRAGMA index_list(conversations)').all<{ name: string }>().map((index) => index.name);
    expect(indexes).toContain('conversations_environment_idx');
    expect(errorSpy).not.toHaveBeenCalled();

    closeOverdeckDatabase();
    getOverdeckDatabase(dbPath);
    expect(errorSpy).not.toHaveBeenCalled();
    closeOverdeckDatabase();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('owner column values (PAN-4645 WI-9)', () => {
  it('ac3: a row created after setLocalEnvironmentId carries the id; before it, null', () => {
    const before = createConversation({ name: 'before-boot', tmuxSession: 'conv-before-boot', cwd: CWD, workspaceId: null });
    expect(before.environmentId).toBeNull();
    expect(before.releasedTo).toBeNull();

    setLocalEnvironmentId('11111111-2222-4333-8444-555555555555');
    expect(localEnvironmentId()).toBe('11111111-2222-4333-8444-555555555555');
    createConversation({ name: 'after-boot', tmuxSession: 'conv-after-boot', cwd: CWD, workspaceId: null });
    const read = getConversationByName('after-boot');
    expect(read?.environmentId).toBe('11111111-2222-4333-8444-555555555555');
    expect(read?.releasedTo).toBeNull();
  });

  it('ac2: the boot backfill stamps every local row without an owner and leaves vault rows alone', async () => {
    const db = getOverdeckDatabase();
    db.prepare("UPDATE conversations SET environment_id = NULL WHERE origin = 'local'").run();
    createConversation({ name: 'legacy-row', tmuxSession: 'conv-legacy-row', cwd: CWD, workspaceId: null });
    upsertVaultBrowseRow({
      vaultId: '00000000-0000-4000-8000-000000000042',
      title: 'saved elsewhere',
      harness: 'claude-code',
      ownerLabel: 'laptop',
      cwd: '/home/other/proj',
      model: null,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    });
    const nullsBefore = db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE environment_id IS NULL AND origin = 'local'").get<{ n: number }>();
    expect(nullsBefore?.n).toBeGreaterThanOrEqual(3);

    writeFileSync(join(TEST_HOME, 'environment-id.json'), JSON.stringify({
      v: 1, environmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', label: 'desk', createdAt: '2026-11-01T00:00:00.000Z',
    }), { mode: 0o600 });
    const first = await bootConversationEnvironment({});
    expect(first).toEqual({ environmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', backfilled: nullsBefore!.n, skipped: null });
    expect(localEnvironmentId()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    const unstamped = db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE environment_id IS NULL AND origin = 'local'").get<{ n: number }>();
    expect(unstamped?.n).toBe(0);
    const vault = db.prepare("SELECT environment_id FROM conversations WHERE origin = 'vault'").all<{ environment_id: string | null }>();
    expect(vault.length).toBeGreaterThan(0);
    expect(vault.every((row) => row.environment_id === null)).toBe(true);
    expect(getConversationByName('legacy-row')?.environmentId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    // Idempotent: nothing left to fill; a peer dashboard sets the id but backfills nothing.
    expect(backfillLocalConversationEnvironmentIds(db, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(0);
    _resetConversationEnvironmentForTests();
    db.prepare("UPDATE conversations SET environment_id = NULL WHERE name = 'legacy-row'").run();
    const peer = await bootConversationEnvironment({ OVERDECK_DISABLE_DEACON: '1' });
    expect(peer).toEqual({ environmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', backfilled: 0, skipped: 'peer' });
    expect(getConversationByName('legacy-row')?.environmentId).toBeNull();
  });
});
