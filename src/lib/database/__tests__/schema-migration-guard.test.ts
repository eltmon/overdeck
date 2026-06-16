/**
 * PAN-1932: Schema migration must not downgrade user_version.
 *
 * Verifies that opening a database whose user_version is greater than the
 * SCHEMA_VERSION known to this code leaves user_version unchanged and runs no
 * migration branch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { openDatabase, type SqliteDatabase } from '../driver.js';
import { runMigrations, SCHEMA_VERSION } from '../schema.js';

let TEST_HOME: string;

function freshDb(name: string): SqliteDatabase {
  return openDatabase(join(TEST_HOME, `${name}.db`));
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-1932-migration-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(() => {
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('schema migration user_version guard (PAN-1932)', () => {
  it('leaves a newer user_version unchanged and does not downgrade', () => {
    const db = freshDb('newer-version');
    const futureVersion = SCHEMA_VERSION + 5;
    db.pragma(`user_version = ${futureVersion}`);

    runMigrations(db);

    const userVersion = db.pragma('user_version', { simple: true }) as number;
    expect(userVersion).toBe(futureVersion);
  });

  it('still returns early when user_version equals SCHEMA_VERSION', () => {
    const db = freshDb('exact-version');
    db.pragma(`user_version = ${SCHEMA_VERSION}`);

    runMigrations(db);

    const userVersion = db.pragma('user_version', { simple: true }) as number;
    expect(userVersion).toBe(SCHEMA_VERSION);
  });

  it('still migrates an older database forward to SCHEMA_VERSION', () => {
    const db = freshDb('older-version');
    db.pragma('user_version = 0');

    runMigrations(db);

    const userVersion = db.pragma('user_version', { simple: true }) as number;
    expect(userVersion).toBe(SCHEMA_VERSION);
  });
});
