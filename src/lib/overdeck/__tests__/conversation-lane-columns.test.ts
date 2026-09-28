/**
 * PAN-4223 WI-1: the four launch-time lane columns on `conversations`
 * (parent_conversation_id, gauntlet_run, lane_key, lane_role), the parent
 * join in the legacy select, the lane list, and the D21 effective-launcher walk.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when the path helpers load, so set it before the
// first dynamic import of the infra and conversation modules.
const TEST_HOME = join(tmpdir(), `lane-columns-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../infra.js');
const { OVERDECK_MIGRATION_PATH } = await import('../paths.js');
const { openDatabase } = await import('../../database/driver.js');
const {
  archiveConversation,
  createConversation,
  getConversationByName,
  listLaneConversations,
  resolveEffectiveLauncher,
} = await import('../conversations.js');

const CWD = join(TEST_HOME, 'projects', 'lexerra');

function conv(name: string, extra: Partial<Parameters<typeof createConversation>[0]> = {}) {
  return createConversation({ name, tmuxSession: `conv-${name}`, cwd: CWD, workspaceId: null, ...extra });
}

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('lane columns on conversations (PAN-4223 WI-1)', () => {
  it('round-trips the parent link and the three lane facts through getConversationByName (ac1)', () => {
    const parent = conv('orch-ac1');
    conv('lane-ac1', { parentName: 'orch-ac1', lane: { run: 'hotel', key: '663', role: 'builder' } });

    const row = getConversationByName('lane-ac1');
    expect(row).toMatchObject({
      parentConversationId: parent.id,
      parentConversationName: 'orch-ac1',
      gauntletRun: 'hotel',
      laneKey: '663',
      laneRole: 'builder',
    });
  });

  it('stores a parent link without lane facts as a successor (ac2)', () => {
    const source = conv('source-ac2');
    conv('successor-ac2', { parentName: 'source-ac2' });

    expect(getConversationByName('successor-ac2')).toMatchObject({
      parentConversationId: source.id,
      parentConversationName: 'source-ac2',
      gauntletRun: null,
      laneKey: null,
      laneRole: null,
    });
  });

  it('throws for an unknown parent and inserts no row (ac2)', () => {
    expect(() => conv('orphan-ac2', { parentName: 'nobody-ac2' }))
      .toThrow('parent conversation nobody-ac2 not found');
    expect(getConversationByName('orphan-ac2')).toBeNull();
  });

  it('throws for a lane without a parent and inserts no row (ac2)', () => {
    expect(() => conv('parentless-lane-ac2', { lane: { run: 'hotel', key: 'x', role: 'critic' } }))
      .toThrow('a lane needs a parent');
    expect(getConversationByName('parentless-lane-ac2')).toBeNull();
  });

  it('returns all five parent and lane fields as null for a root', () => {
    conv('root-plain');
    expect(getConversationByName('root-plain')).toMatchObject({
      parentConversationId: null,
      parentConversationName: null,
      gauntletRun: null,
      laneKey: null,
      laneRole: null,
    });
  });

  it('lists a run\'s lanes oldest first, including an archived lane and excluding a lane\'s successor (ac4)', () => {
    conv('orch-ac4');
    conv('lane-ac4-a', { parentName: 'orch-ac4', lane: { run: 'india', key: 'a', role: 'builder' } });
    conv('lane-ac4-b', { parentName: 'orch-ac4', lane: { run: 'india', key: 'b', role: 'builder' } });
    conv('lane-ac4-c', { parentName: 'orch-ac4', lane: { run: 'india', key: 'c', role: 'critic' } });
    // A successor of a lane carries the parent link only; it is not a lane (D21).
    conv('lane-ac4-a-successor', { parentName: 'lane-ac4-a' });
    // Another run's lane never leaks in.
    conv('lane-other-run', { parentName: 'orch-ac4', lane: { run: 'juliet', key: 'a', role: 'builder' } });
    archiveConversation('lane-ac4-b');

    const names = listLaneConversations({ run: 'india' }).map((row) => row.name);
    expect(names).toEqual(['lane-ac4-a', 'lane-ac4-b', 'lane-ac4-c']);
    expect(listLaneConversations({ run: 'india', role: 'critic' }).map((row) => row.name)).toEqual(['lane-ac4-c']);
    expect(listLaneConversations({ parentName: 'orch-ac4', key: 'a' }).map((row) => row.name))
      .toEqual(['lane-ac4-a', 'lane-other-run']);
  });

  it('resolves the effective launcher through successor chains (ac3)', () => {
    conv('root-ac3');
    conv('orch-lane-ac3', { parentName: 'root-ac3', lane: { run: 'kilo', key: 'cluster', role: 'orchestrator' } });
    conv('orch-lane-ac3-s1', { parentName: 'orch-lane-ac3' });
    conv('orch-lane-ac3-s2', { parentName: 'orch-lane-ac3-s1' });
    conv('root-ac3-s1', { parentName: 'root-ac3' });
    conv('root-ac3-s2', { parentName: 'root-ac3-s1' });

    // successor → successor → orchestrator lane: the lane.
    expect(resolveEffectiveLauncher('orch-lane-ac3-s2')?.name).toBe('orch-lane-ac3');
    // successor → successor → root: the root.
    expect(resolveEffectiveLauncher('root-ac3-s2')?.name).toBe('root-ac3');
    // A root returns itself; a lane returns itself.
    expect(resolveEffectiveLauncher('root-ac3')?.name).toBe('root-ac3');
    expect(resolveEffectiveLauncher('orch-lane-ac3')?.name).toBe('orch-lane-ac3');
    expect(resolveEffectiveLauncher('no-such-conversation')).toBeNull();
  });

  it('stops the effective-launcher walk at an already-visited id', () => {
    const a = conv('cycle-a');
    conv('cycle-b', { parentName: 'cycle-a' });
    // Parent links always point at an older row through the door; force a cycle
    // by hand to prove the visited guard terminates the walk.
    getOverdeckDatabase()
      .prepare('UPDATE conversations SET parent_conversation_id = (SELECT id FROM conversations WHERE name = ?) WHERE name = ?')
      .run('cycle-b', 'cycle-a');

    const launcher = resolveEffectiveLauncher('cycle-b');
    expect(launcher).not.toBeNull();
    expect([a.id, getConversationByName('cycle-b')?.id]).toContain(launcher?.id);
  });
});

describe('lane column top-ups (PAN-4223 WI-1 ac5)', () => {
  const LANE_COLUMNS = ['parent_conversation_id', 'gauntlet_run', 'lane_key', 'lane_role'];
  const LANE_INDEXES = ['conversations_gauntlet_run_idx', 'conversations_parent_idx'];
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

  function indexes(db: ReturnType<typeof getOverdeckDatabase>): string[] {
    return db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'conversations' ORDER BY name`)
      .all<{ name: string }>()
      .map((row) => row.name);
  }

  it('adds the four columns and two indexes to a database created without them, silently on the second run', () => {
    const dir = join(TEST_HOME, 'pre-4223');
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, 'overdeck.db');

    // A database from before this change: the init migration with the lane
    // lines removed. The `events` table it creates is the fresh-vs-existing
    // sentinel, so the next open skips the migration and runs the top-ups only.
    const migration = readFileSync(OVERDECK_MIGRATION_PATH, 'utf8')
      .split('\n')
      .filter((line) => !LANE_COLUMNS.some((column) => line.includes(column)))
      .join('\n')
      // Dropping the last FOREIGN KEY line leaves a trailing comma before `);`.
      .replace(/,(\s*\n\);)/g, '$1');
    const raw = openDatabase(dbPath);
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
    for (const column of LANE_COLUMNS) expect(columns(raw)).not.toContain(column);
    for (const index of LANE_INDEXES) expect(indexes(raw)).not.toContain(index);
    raw.close();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upgraded = getOverdeckDatabase(dbPath);
    for (const column of LANE_COLUMNS) expect(columns(upgraded)).toContain(column);
    for (const index of LANE_INDEXES) expect(indexes(upgraded)).toContain(index);
    // Foreign key survived the ADD COLUMN ... REFERENCES form.
    expect(() =>
      upgraded
        .prepare('INSERT INTO conversations (id, name, cwd, created_at, parent_conversation_id) VALUES (?, ?, ?, ?, ?)')
        .run('u1', 'fk-probe', '/w', 1, 'missing-parent'),
    ).toThrow(/FOREIGN KEY/);
    expect(errorSpy).not.toHaveBeenCalled();

    closeOverdeckDatabase();
    getOverdeckDatabase(dbPath);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
