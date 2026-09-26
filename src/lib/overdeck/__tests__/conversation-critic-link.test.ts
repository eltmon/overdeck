/**
 * PAN-4223 WI-15: the critic link column (critic_of_conversation_id), its
 * read-time join, the createConversation checks, and the schema top-up.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `critic-link-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../infra.js');
const { OVERDECK_MIGRATION_PATH } = await import('../paths.js');
const { openDatabase } = await import('../../database/driver.js');
const { createConversation, getConversationByName } = await import('../conversations.js');

const CWD = join(TEST_HOME, 'projects', 'lexerra');

function conv(name: string, extra: Partial<Parameters<typeof createConversation>[0]> = {}) {
  return createConversation({ name, tmuxSession: `conv-${name}`, cwd: CWD, workspaceId: null, ...extra });
}

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
  conv('root');
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('critic link (PAN-4223 WI-15)', () => {
  it('reads back the judged builder on a critic lane, and null on a builder lane', () => {
    const builder = conv('builder-663', { parentName: 'root', lane: { run: 'hotel', key: '663', role: 'builder' } });
    conv('critic-663', { parentName: 'root', lane: { run: 'hotel', key: '663', role: 'critic', criticOfName: 'builder-663' } });
    expect(getConversationByName('critic-663')).toMatchObject({ criticOfConversationId: builder.id, criticOfConversationName: 'builder-663' });
    expect(getConversationByName('builder-663')).toMatchObject({ criticOfConversationId: null, criticOfConversationName: null });
  });

  it('refuses an unknown target and a builder that links a builder, inserting nothing', () => {
    expect(() => conv('critic-lost', { parentName: 'root', lane: { run: 'hotel', key: 'x', role: 'critic', criticOfName: 'nobody' } }))
      .toThrow('critic target nobody not found');
    expect(getConversationByName('critic-lost')).toBeNull();
    expect(() => conv('builder-bad', { parentName: 'root', lane: { run: 'hotel', key: 'x', role: 'builder', criticOfName: 'builder-663' } }))
      .toThrow('only critic and verifier lanes link a builder');
    expect(getConversationByName('builder-bad')).toBeNull();
  });
});

describe('critic link top-up (PAN-4223 WI-15)', () => {
  let dbPath = '';

  afterEach(() => {
    vi.restoreAllMocks();
    closeOverdeckDatabase();
    if (dbPath) rmSync(join(dbPath, '..'), { recursive: true, force: true });
    dbPath = '';
  });

  it('adds critic_of_conversation_id and its index to an older database, silently on the second run', () => {
    const dir = join(TEST_HOME, 'pre-critic-link');
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, 'overdeck.db');
    const migration = readFileSync(OVERDECK_MIGRATION_PATH, 'utf8')
      .split('\n')
      .filter((line) => !line.includes('critic_of_conversation_id'))
      .join('\n')
      .replace(/,(\s*\n\);)/g, '$1');
    const raw = openDatabase(dbPath);
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
    const columns = (db: typeof raw) => db.prepare('PRAGMA table_info(conversations)').all<{ name: string }>().map((column) => column.name);
    expect(columns(raw)).not.toContain('critic_of_conversation_id');
    raw.close();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upgraded = getOverdeckDatabase(dbPath);
    expect(columns(upgraded)).toContain('critic_of_conversation_id');
    expect(upgraded.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'conversations_critic_of_idx'`).all()).toHaveLength(1);
    closeOverdeckDatabase();
    getOverdeckDatabase(dbPath);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
