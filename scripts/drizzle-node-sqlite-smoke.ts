import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

import { eq, sql } from 'drizzle-orm';
import { drizzle, type RemoteCallback } from 'drizzle-orm/sqlite-proxy';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { openDatabase, type SqliteDatabase } from '../src/lib/database/driver.js';

const parents = sqliteTable('g1_parents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalId: text('external_id').notNull(),
});

const children = sqliteTable(
  'g1_children',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parentId: integer('parent_id')
      .notNull()
      .references(() => parents.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    active: integer('active').notNull().default(1),
  },
  (table) => [
    uniqueIndex('g1_children_active_parent_kind_unique')
      .on(table.parentId, table.kind)
      .where(sql`${table.active} = 1`),
  ],
);

function createRemoteCallback(db: SqliteDatabase): RemoteCallback {
  const toRowValues = (row: Record<string, unknown>): unknown[] => Object.values(row);

  return async (statementSql, params, method) => {
    const statement = db.prepare(statementSql);

    if (method === 'run') {
      statement.run(params);
      return { rows: [] };
    }

    if (method === 'get') {
      const row = statement.get(params);
      return { rows: row ? toRowValues(row) : [] };
    }

    return { rows: statement.all(params).map(toRowValues) };
  };
}

async function assertRejects(operation: () => Promise<unknown>, expectedMessage: RegExp): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;

    while (current) {
      messages.push(current instanceof Error ? current.message : String(current));
      current = current instanceof Error ? current.cause : undefined;
    }

    assert.match(messages.join('\n'), expectedMessage);
    return;
  }

  assert.fail(`Expected operation to reject with ${expectedMessage}`);
}

async function main(): Promise<void> {
  assert.equal(process.versions.bun, undefined, 'G1 smoke must run under Node, not Bun');

  const dir = mkdtempSync(join(tmpdir(), 'pan-drizzle-node-sqlite-'));
  const dbPath = join(dir, 'g1.sqlite');
  const rawDb = openDatabase(dbPath);

  try {
    rawDb.exec('PRAGMA foreign_keys = ON');
    rawDb.exec(`
      CREATE TABLE g1_parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT NOT NULL
      );

      CREATE TABLE g1_children (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL REFERENCES g1_parents(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE UNIQUE INDEX g1_children_active_parent_kind_unique
        ON g1_children(parent_id, kind)
        WHERE active = 1;
    `);

    const db = drizzle(createRemoteCallback(rawDb), { schema: { parents, children } });
    let parentId = 0;

    await db.transaction(async (tx) => {
      await tx.insert(parents).values({ externalId: 'PAN-1938' });

      const [parent] = await tx
        .select({ id: parents.id })
        .from(parents)
        .where(eq(parents.externalId, 'PAN-1938'));

      assert.ok(parent, 'expected inserted parent row');
      parentId = parent.id;

      await tx.insert(children).values({
        parentId,
        kind: 'resolver-writer',
        active: 1,
      });

      const [roundTrip] = await tx
        .select({
          childKind: children.kind,
          parentExternalId: parents.externalId,
        })
        .from(children)
        .innerJoin(parents, eq(children.parentId, parents.id))
        .where(eq(children.parentId, parentId));

      assert.deepEqual(roundTrip, {
        childKind: 'resolver-writer',
        parentExternalId: 'PAN-1938',
      });
    });

    await assertRejects(
      () => db.delete(parents).where(eq(parents.id, parentId)).run(),
      /FOREIGN KEY constraint failed/i,
    );

    await assertRejects(
      () =>
        db.insert(children).values({
          parentId,
          kind: 'resolver-writer',
          active: 1,
        }).run(),
      /UNIQUE constraint failed/i,
    );

    await db.insert(children).values({
      parentId,
      kind: 'resolver-writer',
      active: 0,
    }).run();

    const inactiveRows = await db
      .select({ id: children.id })
      .from(children)
      .where(eq(children.active, 0));

    assert.equal(inactiveRows.length, 1, 'partial unique index must allow inactive duplicates');
  } finally {
    rawDb.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
