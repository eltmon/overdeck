import type { ProjectConfig, DatabaseConfig } from '../workspace-config.js';

export interface DatabaseProvisionerLogger {
  setText(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  fail(message: string): void;
  succeed(message: string): void;
  log(message: string): void;
}

export interface DatabaseProvisionerErrorOptions {
  status?: number;
}

export class DatabaseProvisionerError extends Error {
  readonly status: number;

  constructor(message: string, options: DatabaseProvisionerErrorOptions = {}) {
    super(message);
    this.name = 'DatabaseProvisionerError';
    this.status = options.status ?? 500;
  }
}

export interface RefreshDatabaseContext {
  issueId: string;
  projectConfig: ProjectConfig;
  workspacePath: string;
  pgContainer: string;
  apiContainer: string;
  databaseName: string;
  seedFile: string;
  seedVerifyQuery?: string;
  logger?: DatabaseProvisionerLogger;
}

export interface RefreshDatabaseResult {
  seedVerifyResult?: string;
}

export interface SeedDatabaseContext {
  workspaceOrIssue: string;
  projectConfig: ProjectConfig;
  workspacePath: string;
  pgContainer: string;
  databaseName: string;
  seedFile: string;
  force?: boolean;
  logger?: DatabaseProvisionerLogger;
}

export interface RepairMigrationsContext {
  issueId: string;
  projectConfig: ProjectConfig;
  workspacePath: string;
  pgContainer: string;
  databaseName: string;
  logger?: DatabaseProvisionerLogger;
  log?: (message: string) => void;
}

export interface RepairMigrationsResult {
  repaired: boolean;
  message: string;
}

export interface SnapshotDatabaseContext {
  projectConfig: ProjectConfig;
  dbConfig: DatabaseConfig;
  output?: string;
  sanitize?: boolean;
  logger?: DatabaseProvisionerLogger;
}

export interface SnapshotDatabaseResult {
  outputPath: string;
  sizeBytes: number;
}

export interface CleanSnapshotContext {
  file: string;
  output?: string;
  dryRun?: boolean;
  logger?: DatabaseProvisionerLogger;
}

export interface CleanSnapshotResult {
  outputPath?: string;
  originalLines: number;
  cleanedLines: number;
  removedLines: number;
  removedSample: string[];
}

export interface StatusDatabaseContext {
  projectConfig: ProjectConfig;
  pgContainer: string;
  databaseName: string;
  logger?: DatabaseProvisionerLogger;
}

export interface DatabaseProvisioner {
  readonly id: string;
  validateRefreshDatabase(ctx: Pick<RefreshDatabaseContext, 'seedFile'>): void;
  refreshDatabase(ctx: RefreshDatabaseContext): Promise<RefreshDatabaseResult>;
  seed(ctx: SeedDatabaseContext): Promise<void>;
  repairMigrations(ctx: RepairMigrationsContext): Promise<RepairMigrationsResult>;
  snapshot(ctx: SnapshotDatabaseContext): Promise<SnapshotDatabaseResult>;
  cleanSnapshot(ctx: CleanSnapshotContext): Promise<CleanSnapshotResult>;
  status(ctx: StatusDatabaseContext): Promise<void>;
}
