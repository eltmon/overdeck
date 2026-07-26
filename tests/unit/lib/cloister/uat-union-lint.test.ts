/**
 * Tests for the assembly union lint (PAN-3166) — the Flyway version rule.
 *
 * The lint's whole value is that it fails CLOSED: renumbering is the narrow,
 * provable case and every kind of doubt holds the member out. Most of what is
 * pinned here is therefore the doubt.
 */

import { describe, it, expect } from 'vitest';
import {
  MigrationVersionLedger,
  analyzeMigration,
  compareMigrationVersions,
  migrationEntries,
  migrationRootOf,
  migrationVersionOf,
  planUnionLint,
  resolveUnionCollisions,
  seedUnionLedger,
  type UnionLintPort,
} from '../../../../src/lib/cloister/uat-union-lint.js';

const DIR = 'backend/src/main/resources/db/migration';

/** The three real MIN migrations that collided in min-quartz-0726. */
const SQL = {
  taskComment: 'ALTER TABLE task_comment ADD COLUMN author_type VARCHAR(32) NOT NULL DEFAULT \'USER\';',
  kaiaBinding: 'CREATE TABLE kaia_session_task (id BIGSERIAL PRIMARY KEY, kaia_session_id BIGINT NOT NULL);',
  voiceConfig: 'ALTER TABLE voice_config ALTER COLUMN model DROP NOT NULL;',
};

describe('migrationVersionOf', () => {
  it('reads the version out of a Flyway filename', () => {
    expect(migrationVersionOf(`${DIR}/V256__Kaia_session_task_binding.sql`)).toBe('256');
  });

  it('normalizes underscore and dot version separators to the same version', () => {
    expect(migrationVersionOf('V1_1__A.sql')).toBe('1.1');
    expect(migrationVersionOf('V1.1__B.sql')).toBe('1.1');
  });

  it('ignores repeatable migrations and non-migration files', () => {
    expect(migrationVersionOf(`${DIR}/R__refresh_views.sql`)).toBeNull();
    expect(migrationVersionOf('src/main/java/Application.java')).toBeNull();
    expect(migrationVersionOf('docs/V256-notes.md')).toBeNull();
  });
});

describe('migrationRootOf', () => {
  it('scopes a migration to its own directory', () => {
    expect(migrationRootOf(`${DIR}/V1__init.sql`)).toBe(`${DIR}/`);
    expect(migrationRootOf('services/billing/db/V1__init.sql')).toBe('services/billing/db/');
  });
});

describe('migrationEntries', () => {
  it('records each migration under its own root', () => {
    const entries = migrationEntries([`${DIR}/V255__A.sql`, 'services/b/db/V255__B.sql', 'README.md']);
    expect(entries).toEqual([
      { root: `${DIR}/`, version: '255', path: `${DIR}/V255__A.sql` },
      { root: 'services/b/db/', version: '255', path: 'services/b/db/V255__B.sql' },
    ]);
  });
});

describe('analyzeMigration', () => {
  it('collects the primary object of a recognized statement', () => {
    expect([...analyzeMigration(SQL.taskComment).objects]).toEqual(['task_comment']);
  });

  it('collects a foreign key parent, not just the table being created', () => {
    const sql = 'CREATE TABLE kaia_session_task (id BIGSERIAL PRIMARY KEY, task_id BIGINT REFERENCES task(id));';
    expect([...analyzeMigration(sql).objects].sort()).toEqual(['kaia_session_task', 'task']);
  });

  it('collects the source table a data migration reads', () => {
    const sql = 'INSERT INTO task_archive (id) SELECT id FROM task;';
    expect([...analyzeMigration(sql).objects].sort()).toEqual(['task', 'task_archive']);
  });

  it('strips schema qualifiers and quoting so one table has one name', () => {
    expect([...analyzeMigration('ALTER TABLE "public"."Task_Comment" ADD COLUMN x int;').objects]).toEqual(['task_comment']);
  });

  it('ignores commented-out statements', () => {
    const sql = '-- ALTER TABLE task ADD COLUMN x int;\nALTER TABLE voice_config ALTER COLUMN model DROP NOT NULL;';
    expect([...analyzeMigration(sql).objects]).toEqual(['voice_config']);
  });

  it('reports a function or trigger body as unrecognized — it can read any table', () => {
    const sql = 'CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN UPDATE audit SET n = n + 1; END; $$ LANGUAGE plpgsql;';
    expect(analyzeMigration(sql).unrecognized.length).toBeGreaterThan(0);
  });

  it('reports any statement shape it does not know as unrecognized', () => {
    expect(analyzeMigration('GRANT SELECT ON task TO reporting;').unrecognized.length).toBeGreaterThan(0);
  });
});

describe('MigrationVersionLedger', () => {
  it('sees no collision when a member re-lists a base migration under the same name', () => {
    const ledger = new MigrationVersionLedger([`${DIR}/V255__Base.sql`]);
    expect(ledger.collisions([`${DIR}/V255__Base.sql`, `${DIR}/V256__Mine.sql`], 'MIN-902')).toEqual([]);
  });

  it('reports a collision when two different files claim one version in one root', () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__A.sql`], 'MIN-858');
    const [collision] = ledger.collisions([`${DIR}/V256__B.sql`], 'MIN-902');
    expect(collision).toMatchObject({
      version: '256',
      root: `${DIR}/`,
      incoming: { path: `${DIR}/V256__B.sql`, issueId: 'MIN-902' },
      existing: { path: `${DIR}/V256__A.sql`, issueId: 'MIN-858' },
    });
  });

  // Guardrail (6): one repo is not one Flyway namespace.
  it('does not collide the same version across two migration roots', () => {
    const ledger = new MigrationVersionLedger(['services/a/db/V1__init.sql']);
    expect(ledger.collisions(['services/b/db/V1__init.sql'], 'MIN-1')).toEqual([]);
  });

  it('never mutates on collision detection — a rejected member frees its version', () => {
    const ledger = new MigrationVersionLedger([]);
    expect(ledger.collisions([`${DIR}/V256__A.sql`], 'MIN-1')).toEqual([]);
    expect(ledger.collisions([`${DIR}/V256__B.sql`], 'MIN-2')).toEqual([]);
  });

  // Guardrail (2): the allocator reserves the whole union.
  it('takes the next integer when the gap after the collision is free', () => {
    const ledger = new MigrationVersionLedger([`${DIR}/V256__Base.sql`, `${DIR}/V260__Later.sql`]);
    expect(ledger.allocateSlotAfter(`${DIR}/`, '256')).toBe('257');
  });

  it('takes the next integer when nothing follows the collision at all', () => {
    const ledger = new MigrationVersionLedger([`${DIR}/V256__Base.sql`]);
    expect(ledger.allocateSlotAfter(`${DIR}/`, '256')).toBe('257');
  });

  // FIELD EVIDENCE: allocating the next UNUSED integer moved a migration to the
  // tail, past V257 which indexed the column it adds — `column task_id does not
  // exist` at boot. The slot must be the next GAP, not the next free number.
  it('never moves a migration past a later one — it threads a dotted slot into the occupied gap', () => {
    const ledger = new MigrationVersionLedger([
      `${DIR}/V256__Add_author_type_to_task_comment.sql`,
      `${DIR}/V257__Unique_resumable_kaia_task_session.sql`,
      `${DIR}/V258__Voice_config_nullable_model.sql`,
    ]);
    expect(ledger.allocateSlotAfter(`${DIR}/`, '256')).toBe('256.1');
  });

  it('holds out a second collision at the same version rather than ordering it behind the first', () => {
    const ledger = new MigrationVersionLedger([`${DIR}/V256__A.sql`, `${DIR}/V257__B.sql`]);
    expect(ledger.allocateSlotAfter(`${DIR}/`, '256')).toBe('256.1');
    // 256.2 would sit AFTER the slot just handed out, and nothing proved this
    // migration may follow that one — they were concurrent, both at V256. The
    // allocator refuses to invent that order; the caller holds out.
    expect(ledger.allocateSlotAfter(`${DIR}/`, '256')).toBeNull();
  });

  it('refuses to step over a dotted version the repo already carries', () => {
    // 124.2 sorts after 124.1, so it would move this migration past one that
    // may depend on it — the same shape as the V259 field failure, one decimal
    // place down.
    const ledger = new MigrationVersionLedger([
      `${DIR}/V124__A.sql`,
      `${DIR}/V124.1__AlreadyThreaded.sql`,
      `${DIR}/V125__B.sql`,
    ]);
    expect(ledger.allocateSlotAfter(`${DIR}/`, '124')).toBeNull();
  });

  it('returns null when not even a dotted slot fits, so the caller holds out', () => {
    // V256.1 already occupies the only space between 256 and 257; anything the
    // allocator could emit would sort at or after it.
    const ledger = new MigrationVersionLedger([`${DIR}/V256__A.sql`, `${DIR}/V256.1__B.sql`]);
    expect(ledger.allocateSlotAfter(`${DIR}/`, '256')).toBeNull();
  });

  it('refuses to reassign a dotted version — that ordering is the author\'s', () => {
    const ledger = new MigrationVersionLedger([`${DIR}/V256.1__A.sql`]);
    expect(ledger.allocateSlotAfter(`${DIR}/`, '256.1')).toBeNull();
  });

  it('allocates per migration root, so one service does not constrain another', () => {
    const ledger = new MigrationVersionLedger(['services/a/db/V2__x.sql', 'services/b/db/V2__y.sql']);
    // b's own V2 is the collision; a's V2 is a different history entirely.
    expect(ledger.allocateSlotAfter('services/b/db/', '2')).toBe('3');
  });
});

describe('compareMigrationVersions', () => {
  it('orders a dotted version between its integer and the next', () => {
    expect(compareMigrationVersions('256', '256.1')).toBeLessThan(0);
    expect(compareMigrationVersions('256.1', '257')).toBeLessThan(0);
  });

  it('treats a missing part as zero', () => {
    expect(compareMigrationVersions('256', '256.0')).toBe(0);
  });

  it('compares numerically, not lexically', () => {
    expect(compareMigrationVersions('9', '10')).toBeLessThan(0);
    expect(compareMigrationVersions('256.10', '256.9')).toBeGreaterThan(0);
  });
});

describe('resolveUnionCollisions', () => {
  function reader(files: Record<string, string>) {
    return async (path: string) => {
      const sql = files[path];
      if (sql === undefined) throw new Error(`no such migration: ${path}`);
      return sql;
    };
  }

  it('renumbers when the colliding migrations are provably independent', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__Add_author_type_to_task_comment.sql`], 'MIN-858');

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V256__Kaia_session_task_binding.sql`],
      issueId: 'MIN-902',
      readMigration: reader({
        [`${DIR}/V256__Kaia_session_task_binding.sql`]: SQL.kaiaBinding,
        [`${DIR}/V256__Add_author_type_to_task_comment.sql`]: SQL.taskComment,
      }),
    });

    expect(disposition).toEqual({
      kind: 'renumber',
      renames: [{
        from: `${DIR}/V256__Kaia_session_task_binding.sql`,
        to: `${DIR}/V257__Kaia_session_task_binding.sql`,
        fromVersion: '256',
        toVersion: '257',
      }],
      note: 'V256__Kaia_session_task_binding.sql → V257__Kaia_session_task_binding.sql',
    });
  });

  // The min-quartz-0726 batch, end to end. V257 already existed and indexes
  // the column the moved migration adds, so the only correct slot is 256.1.
  it('reproduces the field batch: threads the Kaia binding to V256.1, not the tail', async () => {
    const AUTHOR = `${DIR}/V256__Add_author_type_to_task_comment.sql`;
    const KAIA = `${DIR}/V256__Kaia_session_task_binding.sql`;
    const ledger = new MigrationVersionLedger([
      AUTHOR,
      `${DIR}/V257__Unique_resumable_kaia_task_session.sql`,
      `${DIR}/V258__Voice_config_nullable_model.sql`,
    ]);

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [KAIA],
      issueId: 'MIN-902',
      readMigration: reader({
        [KAIA]: SQL.kaiaBinding,
        [AUTHOR]: SQL.taskComment,
      }),
    });

    expect(disposition).toMatchObject({ kind: 'renumber' });
    const { renames } = disposition as { renames: Array<{ to: string; toVersion: string }> };
    expect(renames[0]!.toVersion).toBe('256.1');
    expect(renames[0]!.to).toBe(`${DIR}/V256.1__Kaia_session_task_binding.sql`);
  });

  it('holds out when no slot preserves order, instead of moving to the tail', async () => {
    const A = `${DIR}/V256__A.sql`;
    const B = `${DIR}/V256__B.sql`;
    // 256.1 already occupies the gap, so nothing can be threaded after 256.
    const ledger = new MigrationVersionLedger([A, `${DIR}/V256.1__Threaded.sql`, `${DIR}/V257__C.sql`]);

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [B],
      issueId: 'MIN-902',
      readMigration: reader({ [A]: SQL.taskComment, [B]: SQL.kaiaBinding }),
    });

    expect(disposition.kind).toBe('hold-out');
    expect((disposition as { reason: string }).reason).toContain('no slot exists between V256');
  });

  it('holds out when both migrations touch the same table', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__A.sql`], 'MIN-858');

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V256__B.sql`],
      issueId: 'MIN-902',
      readMigration: reader({
        [`${DIR}/V256__B.sql`]: 'ALTER TABLE task_comment ADD COLUMN b int;',
        [`${DIR}/V256__A.sql`]: SQL.taskComment,
      }),
    });

    expect(disposition.kind).toBe('hold-out');
    expect((disposition as { reason: string }).reason).toContain('both touch task_comment');
  });

  // Guardrail (1): a distinct primary table does not prove independence.
  it('holds out when one migration REFERENCES the table the other alters', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__Add_author_type_to_task_comment.sql`], 'MIN-858');

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V256__Child.sql`],
      issueId: 'MIN-902',
      readMigration: reader({
        [`${DIR}/V256__Child.sql`]: 'CREATE TABLE comment_flag (id BIGSERIAL PRIMARY KEY, comment_id BIGINT REFERENCES task_comment(id));',
        [`${DIR}/V256__Add_author_type_to_task_comment.sql`]: SQL.taskComment,
      }),
    });

    expect(disposition.kind).toBe('hold-out');
    expect((disposition as { reason: string }).reason).toContain('task_comment');
  });

  it('holds out when a data migration reads the other migration\'s table', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__Alter_voice.sql`], 'MIN-898');

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V256__Backfill.sql`],
      issueId: 'MIN-902',
      readMigration: reader({
        [`${DIR}/V256__Backfill.sql`]: 'INSERT INTO voice_audit (id) SELECT id FROM voice_config;',
        [`${DIR}/V256__Alter_voice.sql`]: SQL.voiceConfig,
      }),
    });

    expect(disposition.kind).toBe('hold-out');
    expect((disposition as { reason: string }).reason).toContain('voice_config');
  });

  it('holds out on SQL it does not recognize rather than guessing independence', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__A.sql`], 'MIN-858');

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V256__Trigger.sql`],
      issueId: 'MIN-902',
      readMigration: reader({
        [`${DIR}/V256__Trigger.sql`]: 'CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN UPDATE task SET x = 1; END; $$ LANGUAGE plpgsql;',
        [`${DIR}/V256__A.sql`]: SQL.taskComment,
      }),
    });

    expect(disposition.kind).toBe('hold-out');
    expect((disposition as { reason: string }).reason).toContain('does not recognize');
  });

  it('holds out when a migration cannot be read', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__A.sql`], 'MIN-858');

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V256__B.sql`],
      issueId: 'MIN-902',
      readMigration: reader({}),
    });

    expect(disposition.kind).toBe('hold-out');
    expect((disposition as { reason: string }).reason).toContain('could not be read');
  });

  // Guardrail (2): dotted/underscore versions are explicit ordering, never renumbered.
  it('holds out a dotted version instead of renumbering it', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V1_1__A.sql`], 'MIN-858');

    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V1.1__B.sql`],
      issueId: 'MIN-902',
      readMigration: reader({
        [`${DIR}/V1.1__B.sql`]: SQL.kaiaBinding,
        [`${DIR}/V1_1__A.sql`]: SQL.taskComment,
      }),
    });

    expect(disposition.kind).toBe('hold-out');
    expect((disposition as { reason: string }).reason).toContain('not a plain integer');
  });

  it('is a no-op when nothing collides', async () => {
    const ledger = new MigrationVersionLedger([`${DIR}/V255__Base.sql`]);
    const disposition = await resolveUnionCollisions({
      ledger,
      files: [`${DIR}/V256__New.sql`],
      issueId: 'MIN-902',
      readMigration: reader({}),
    });
    expect(disposition).toEqual({ kind: 'ok' });
  });
});

// Guardrail (5): a guard that disables itself on error is worse than no guard.
describe('fail-closed reads', () => {
  const port = (overrides: Partial<UnionLintPort> = {}): UnionLintPort => ({
    listMigrationFiles: async () => [],
    readMigrationFile: async () => '',
    renameMigrations: async () => 'sha',
    ...overrides,
  });

  it('seedUnionLedger propagates a read failure instead of seeding an empty union', async () => {
    await expect(
      seedUnionLedger(port({ listMigrationFiles: async () => { throw new Error('git exploded'); } }), 'uat/min-x-0726', []),
    ).rejects.toThrow('git exploded');
  });

  it('survives an unreadable CANDIDATE branch — planUnionLint holds that one member out', async () => {
    // One broken branch must not fail the whole batch: the same read fails
    // again in planUnionLint, which holds that member out, so its versions
    // never enter the union and the missing reservation cannot mis-allocate.
    const git = port({
      listMigrationFiles: async (ref: string) => {
        if (ref === 'feature/min-902') throw new Error('bad object');
        return [];
      },
    });
    await expect(seedUnionLedger(git, 'uat/min-x-0726', ['feature/min-902'])).resolves.toBeTruthy();

    const plan = await planUnionLint({
      git,
      ledger: new MigrationVersionLedger([]),
      generationBranch: 'uat/min-x-0726',
      featureBranch: 'feature/min-902',
      issueId: 'MIN-902',
    });
    expect(plan.disposition.kind).toBe('hold-out');
  });

  it('returns null (lint disabled) only when the port genuinely omits the listing', async () => {
    expect(await seedUnionLedger({}, 'uat/min-x-0726', [])).toBeNull();
  });

  it('planUnionLint holds the member out when its branch cannot be listed', async () => {
    const plan = await planUnionLint({
      git: port({ listMigrationFiles: async () => { throw new Error('fatal: bad object'); } }),
      ledger: new MigrationVersionLedger([]),
      generationBranch: 'uat/min-x-0726',
      featureBranch: 'feature/min-902',
      issueId: 'MIN-902',
    });

    expect(plan.disposition.kind).toBe('hold-out');
    expect((plan.disposition as { reason: string }).reason).toContain('cannot rule out');
    expect((plan.disposition as { reason: string }).reason).toContain('bad object');
  });

  it('holds out rather than renumbering when no rename primitive is wired', async () => {
    const ledger = new MigrationVersionLedger([]);
    ledger.record([`${DIR}/V256__A.sql`], 'MIN-858');
    const plan = await planUnionLint({
      git: {
        listMigrationFiles: async () => [`${DIR}/V256__B.sql`],
        // readMigrationFile/renameMigrations absent — renumbering impossible.
      },
      ledger,
      generationBranch: 'uat/min-x-0726',
      featureBranch: 'feature/min-902',
      issueId: 'MIN-902',
    });
    expect(plan.disposition.kind).toBe('hold-out');
  });
});
