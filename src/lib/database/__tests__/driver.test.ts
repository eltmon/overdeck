import { describe, expect, it } from 'vitest';
import { openDatabase } from '../driver.js';

function drainWarnings(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve));
}

describe('SQLite driver adapter', () => {
  it('opens an in-memory database and supports exec/prepare/run/get/all/iterate/close', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

      const insert = db.prepare('INSERT INTO items (name) VALUES (?)');
      const result = insert.run('first');
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(1);

      expect(db.prepare('SELECT name FROM items WHERE id = ?').get(1)).toEqual({ name: 'first' });
      expect(db.prepare('SELECT name FROM items ORDER BY id').all()).toEqual([{ name: 'first' }]);
      expect([...db.prepare('SELECT name FROM items ORDER BY id').iterate()]).toEqual([{ name: 'first' }]);
    } finally {
      db.close();
    }
  });

  it('supports array positional bind parameters', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE items (name TEXT NOT NULL, value INTEGER NOT NULL)');

      db.prepare('INSERT INTO items (name, value) VALUES (?, ?)').run(['array-bind', 7]);

      expect(db.prepare('SELECT value FROM items WHERE name = ?').get(['array-bind'])).toEqual({ value: 7 });
    } finally {
      db.close();
    }
  });

  it('supports unprefixed object keys for named bind parameters', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE items (name TEXT NOT NULL, value INTEGER NOT NULL)');

      db.prepare('INSERT INTO items (name, value) VALUES (@name, @value)').run({ name: 'named-bind', value: 11 });

      expect(db.prepare('SELECT value FROM items WHERE name = @name').get({ name: 'named-bind' })).toEqual({ value: 11 });
    } finally {
      db.close();
    }
  });

  it('sets pragmas, reads simple pragma scalars, and returns pragma row sets', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      db.pragma('journal_mode = WAL');
      db.pragma('user_version = 7');

      expect(db.pragma('user_version', { simple: true })).toBe(7);
      expect(db.pragma('table_info(items)')).toEqual([
        expect.objectContaining({ name: 'id' }),
        expect.objectContaining({ name: 'name' }),
      ]);
    } finally {
      db.close();
    }
  });

  it('commits successful transactions and rolls back thrown transactions', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE items (name TEXT NOT NULL)');

      const insertCommitted = db.transaction(() => {
        db.prepare('INSERT INTO items (name) VALUES (?)').run('committed');
      });
      insertCommitted();

      const insertRolledBack = db.transaction(() => {
        db.prepare('INSERT INTO items (name) VALUES (?)').run('rolled-back');
        throw new Error('rollback');
      });
      expect(() => insertRolledBack()).toThrow('rollback');

      expect(db.prepare('SELECT name FROM items ORDER BY name').all()).toEqual([{ name: 'committed' }]);
    } finally {
      db.close();
    }
  });

  it('uses savepoints for nested transactions so an inner rollback can leave the outer committed', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE items (name TEXT NOT NULL)');

      const inner = db.transaction(() => {
        db.prepare('INSERT INTO items (name) VALUES (?)').run('inner');
        throw new Error('inner rollback');
      });
      const outer = db.transaction(() => {
        db.prepare('INSERT INTO items (name) VALUES (?)').run('outer-before');
        expect(() => inner()).toThrow('inner rollback');
        db.prepare('INSERT INTO items (name) VALUES (?)').run('outer-after');
      });

      outer();

      expect(db.prepare('SELECT name FROM items ORDER BY name').all()).toEqual([
        { name: 'outer-after' },
        { name: 'outer-before' },
      ]);
    } finally {
      db.close();
    }
  });

  it('rejects raw boolean binds instead of coercing them', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE flags (value INTEGER NOT NULL)');

      expect(() => db.prepare('INSERT INTO flags (value) VALUES (?)').run(true as never)).toThrow(
        'SQLite boolean bind values are not supported',
      );
    } finally {
      db.close();
    }
  });

  it('round-trips Float32Array data as a Uint8Array BLOB result', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE embeddings (embedding BLOB NOT NULL)');
      const values = new Float32Array([1.25, -2.5, 3.75]);
      const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);

      db.prepare('INSERT INTO embeddings (embedding) VALUES (?)').run(bytes);
      const row = db.prepare('SELECT embedding FROM embeddings').get() as { embedding: Uint8Array };

      expect(row.embedding).toBeInstanceOf(Uint8Array);
      const roundTripped = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, values.length);
      expect([...roundTripped]).toEqual([...values]);
    } finally {
      db.close();
    }
  });

  it('suppresses only SQLite ExperimentalWarning emissions', async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on('warning', onWarning);
    try {
      process.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');
      process.emitWarning('Some other experimental feature', 'ExperimentalWarning');
      await drainWarnings();

      expect(warnings.map((warning) => warning.message)).toEqual(['Some other experimental feature']);
    } finally {
      process.off('warning', onWarning);
    }
  });
});
