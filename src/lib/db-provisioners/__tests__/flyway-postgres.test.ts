import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DatabaseProvisionerError,
  getDatabaseProvisioner,
  getSnapshotCleanerProvisioner,
} from '../index.js';
import { flywayPostgresProvisioner } from '../flyway-postgres.js';

describe('database provisioner registry', () => {
  it('returns null when no database config is present', () => {
    expect(getDatabaseProvisioner(undefined)).toBeNull();
  });

  it('selects the provider from explicit provisioner config', () => {
    expect(getDatabaseProvisioner({
      name: 'myn',
      provisioner: 'flyway-postgres',
    })).toBe(flywayPostgresProvisioner);
  });

  it('selects the provider from legacy migration config', () => {
    expect(getDatabaseProvisioner({
      name: 'myn',
      migrations: { type: 'flyway' },
    })).toBe(flywayPostgresProvisioner);
  });

  it('does not select a provider for unrelated migration config', () => {
    expect(getDatabaseProvisioner({
      name: 'app',
      migrations: { type: 'prisma' },
    })).toBeNull();
  });
});

describe('flyway postgres snapshot cleaning', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-db-provisioner-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('cleans kubectl noise from dump files', async () => {
    const file = join(dir, 'seed.sql');
    writeFileSync(file, [
      'Defaulted container "postgres" out of: postgres',
      '-- PostgreSQL database dump',
      'CREATE TABLE example(id integer);',
      'Unable to use a TTY - input is not a terminal or the right kind of file',
      '-- PostgreSQL database dump complete',
    ].join('\n'));

    const result = await getSnapshotCleanerProvisioner().cleanSnapshot({ file });

    expect(result).toMatchObject({
      outputPath: file,
      originalLines: 5,
      cleanedLines: 3,
      removedLines: 2,
    });
    expect(readFileSync(file, 'utf-8')).toBe([
      '-- PostgreSQL database dump',
      'CREATE TABLE example(id integer);',
      '-- PostgreSQL database dump complete',
    ].join('\n'));
  });

  it('reports missing refresh baseline as a provisioner error', () => {
    const seedFile = join(dir, 'seed.sql');
    writeFileSync(seedFile, 'select 1;');

    expect(() => flywayPostgresProvisioner.validateRefreshDatabase({ seedFile }))
      .toThrow(DatabaseProvisionerError);
  });
});
