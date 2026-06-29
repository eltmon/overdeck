import type { DatabaseConfig } from '../workspace-config.js';
import { flywayPostgresProvisioner } from './flyway-postgres.js';
import type { DatabaseProvisioner } from './types.js';

export function getDatabaseProvisioner(
  dbConfig: DatabaseConfig | undefined
): DatabaseProvisioner | null {
  if (!dbConfig) return null;
  if (dbConfig.provisioner === 'flyway-postgres') return flywayPostgresProvisioner;
  if (dbConfig.migrations?.type === 'flyway') return flywayPostgresProvisioner;
  return null;
}

export function getSnapshotCleanerProvisioner(): DatabaseProvisioner {
  return flywayPostgresProvisioner;
}

export type {
  DatabaseProvisioner,
  DatabaseProvisionerLogger,
  RefreshDatabaseContext,
  RefreshDatabaseResult,
  SeedDatabaseContext,
  RepairMigrationsContext,
  RepairMigrationsResult,
  SnapshotDatabaseContext,
  SnapshotDatabaseResult,
  CleanSnapshotContext,
  CleanSnapshotResult,
  StatusDatabaseContext,
} from './types.js';

export { DatabaseProvisionerError } from './types.js';
