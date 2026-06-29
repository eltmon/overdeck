import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';

import type { DatabaseConfig } from '../workspace-config.js';
import {
  DatabaseProvisionerError,
  type CleanSnapshotContext,
  type CleanSnapshotResult,
  type DatabaseProvisioner,
  type DatabaseProvisionerLogger,
  type RefreshDatabaseContext,
  type RefreshDatabaseResult,
  type RepairMigrationsContext,
  type RepairMigrationsResult,
  type SeedDatabaseContext,
  type SnapshotDatabaseContext,
  type SnapshotDatabaseResult,
  type StatusDatabaseContext,
} from './types.js';

const execAsync = promisify(exec);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function defaultLogger(prefix: string): DatabaseProvisionerLogger {
  return {
    setText(message) { console.log(`${prefix} ${message}`); },
    info(message) { console.log(`${prefix} ${message}`); },
    warn(message) { console.warn(`${prefix} ${message}`); },
    fail(message) { console.error(`${prefix} ${message}`); },
    succeed(message) { console.log(`${prefix} ${message}`); },
    log(message) { console.log(`${prefix} ${message}`); },
  };
}

function requireLogger(
  logger: DatabaseProvisionerLogger | undefined,
  prefix: string
): DatabaseProvisionerLogger {
  return logger ?? defaultLogger(prefix);
}

function getFlywayBaselineFile(seedFile: string): string {
  return join(dirname(seedFile), 'zzz-flyway-workspace-baseline.sql');
}

function getSnapshotCommand(dbConfig: DatabaseConfig): string | null {
  if (dbConfig.snapshot_command) {
    return dbConfig.snapshot_command;
  }

  if (dbConfig.external_db) {
    const ext = dbConfig.external_db;
    const password = ext.password_env ? process.env[ext.password_env] : '';
    if (ext.password_env && !password) {
      throw new DatabaseProvisionerError(`Environment variable ${ext.password_env} not set`);
    }
    return `PGPASSWORD="${password}" pg_dump -h ${ext.host} -p ${ext.port || 5432} -U ${ext.user || 'postgres'} ${ext.database}`;
  }

  return null;
}

function getSnapshotHelp(projectKey: string): string {
  return `
  ${projectKey}:
    workspace:
      database:
        name: myapp
        snapshot_command: "kubectl exec -n prod pod/postgres -- pg_dump -U app mydb"
        # or
        external_db:
          host: prod-db.example.com
          database: myapp
          user: readonly
          password_env: PROD_DB_PASSWORD
`;
}

function kubectlNoisePatterns(): RegExp[] {
  return [
    /^Defaulted container/,
    /^Unable to use a TTY/,
    /^All commands and output from this session/,
    /^If you don't see a command prompt/,
    /^warning: couldn't attach to pod/,
    /^pod ".*" deleted from .* namespace$/,
    /^\[stderr\]/,
    /^error: timed out waiting/,
  ];
}

async function cleanFile(filePath: string): Promise<void> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('--') && lines[i].includes('PostgreSQL database dump')) {
      startIndex = i;
      break;
    }
  }

  const patternsToRemove = kubectlNoisePatterns();
  const cleanedLines = lines
    .slice(startIndex)
    .filter((line) => !patternsToRemove.some((p) => p.test(line)));

  writeFileSync(filePath, cleanedLines.join('\n'));
}

export async function repairFlywayIfNeeded(
  issueId: string,
  pgContainer: string,
  dbName: string,
  projectConfig: RepairMigrationsContext['projectConfig'],
  workspacePath: string,
  log?: (msg: string) => void
): Promise<RepairMigrationsResult> {
  void issueId;
  const emit = log || ((msg: string) => console.log(`[flyway-repair] ${msg}`));

  try {
    await execAsync(`docker exec "${pgContainer}" pg_isready -U postgres`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    return { repaired: false, message: 'Postgres container not ready, skipping Flyway check' };
  }

  let rowCount = 0;
  try {
    const { stdout } = await execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d ${dbName} -t -A -c "SELECT count(*) FROM flyway_schema_history;"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    rowCount = parseInt(stdout.trim(), 10) || 0;
  } catch {
    rowCount = 0;
  }

  if (rowCount >= 10) {
    return { repaired: false, message: `Flyway schema_history has ${rowCount} entries, no repair needed` };
  }

  emit(`Flyway schema_history has only ${rowCount} entries — repairing`);

  const seedRelPath = projectConfig.workspace?.database?.seed_file;
  if (!seedRelPath) {
    return { repaired: false, message: 'No seed_file configured, cannot locate Flyway baseline' };
  }

  const seedFile = join(projectConfig.path, seedRelPath);
  const flywayFile = getFlywayBaselineFile(seedFile);
  if (!existsSync(flywayFile)) {
    return { repaired: false, message: `Flyway baseline not found: ${flywayFile}` };
  }

  emit(`Loading Flyway baseline from ${flywayFile}`);
  await execAsync(
    `docker exec -i "${pgContainer}" psql -U postgres -d ${dbName} < "${flywayFile}"`,
    { encoding: 'utf-8', timeout: 60000 }
  );

  const migrationsRelPath = projectConfig.workspace?.database?.migrations?.path;
  if (migrationsRelPath) {
    const migrationsDir = join(workspacePath, migrationsRelPath);
    if (existsSync(migrationsDir)) {
      emit(`Syncing Flyway checksums from workspace migrations`);
      const migrationFiles = (await readdir(migrationsDir)).filter(f => /^V\d+__.*\.sql$/.test(f));
      const updates: string[] = [];

      for (const file of migrationFiles) {
        const version = file.match(/^V(\d+)__/)?.[1];
        if (!version) continue;
        let content = await readFile(join(migrationsDir, file));
        if (content[0] === 0xEF && content[1] === 0xBB && content[2] === 0xBF) {
          content = content.slice(3);
        }
        const lines = content.toString('utf-8').split(/\r?\n/);
        const checksum = crc32(Buffer.from(lines.join(''), 'utf-8')) | 0;
        updates.push(
          `UPDATE flyway_schema_history SET checksum = ${checksum} WHERE version = '${version}' AND checksum IS NOT NULL;`
        );
      }

      if (updates.length > 0) {
        const tmpSql = `/tmp/flyway-checksum-sync-${Date.now()}.sql`;
        await writeFile(tmpSql, updates.join('\n'));
        try {
          const { stdout } = await execAsync(
            `docker exec -i "${pgContainer}" psql -U postgres -d ${dbName} < "${tmpSql}"`,
            { encoding: 'utf-8', timeout: 30000 }
          );
          const updatedCount = (stdout.match(/UPDATE \d+/g) || [])
            .reduce((sum, m) => sum + parseInt(m.replace('UPDATE ', ''), 10), 0);
          emit(`Synced ${migrationFiles.length} migration checksums (${updatedCount} rows updated)`);
        } finally {
          try { await unlink(tmpSql); } catch {}
        }
      }
    }
  }

  try {
    const { stdout } = await execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d ${dbName} -t -A -c "SELECT count(*) FROM flyway_schema_history;"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const newCount = parseInt(stdout.trim(), 10) || 0;
    emit(`Repair complete: flyway_schema_history now has ${newCount} entries (was ${rowCount})`);
    return { repaired: true, message: `Repaired Flyway schema_history: ${rowCount} → ${newCount} entries` };
  } catch (err: unknown) {
    return {
      repaired: false,
      message: `Repair may have failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const flywayPostgresProvisioner: DatabaseProvisioner = {
  id: 'flyway-postgres',

  validateRefreshDatabase(ctx): void {
    const flywayFile = getFlywayBaselineFile(ctx.seedFile);
    if (!existsSync(flywayFile)) {
      throw new DatabaseProvisionerError(`Flyway baseline not found: ${flywayFile}`, {
        status: 400,
      });
    }
  },

  async refreshDatabase(ctx: RefreshDatabaseContext): Promise<RefreshDatabaseResult> {
    const logger = requireLogger(ctx.logger, '[refresh-db]');

    logger.log(`Starting DB refresh for ${ctx.issueId}`);

    try {
      await execAsync(`docker stop "${ctx.apiContainer}"`, { encoding: 'utf-8', timeout: 30000 });
    } catch {
      logger.log('API container not running or already stopped');
    }

    await execAsync(
      `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${sqlString(ctx.databaseName)}' AND pid <> pg_backend_pid();"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    await execAsync(
      `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${sqlIdentifier(ctx.databaseName)};"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    await execAsync(
      `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d postgres -c "CREATE DATABASE ${sqlIdentifier(ctx.databaseName)} OWNER postgres;"`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    logger.log(`Loading seed file: ${ctx.seedFile}`);
    await execAsync(
      `docker exec -i ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} < ${shellQuote(ctx.seedFile)}`,
      { encoding: 'utf-8', timeout: 600000 }
    );

    const repairResult = await repairFlywayIfNeeded(
      ctx.issueId,
      ctx.pgContainer,
      ctx.databaseName,
      ctx.projectConfig,
      ctx.workspacePath,
      (msg) => logger.log(msg)
    );
    logger.log(`Flyway setup: ${repairResult.message}`);

    try {
      await execAsync(`docker start "${ctx.apiContainer}"`, { encoding: 'utf-8', timeout: 30000 });
    } catch {
      logger.log('Could not start API container (may need manual start)');
    }

    let seedVerifyResult: string | undefined;
    if (ctx.seedVerifyQuery) {
      try {
        const { stdout } = await execAsync(
          `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} -t -A -c ${shellQuote(ctx.seedVerifyQuery)}`,
          { encoding: 'utf-8', timeout: 10000 }
        );
        seedVerifyResult = stdout.trim();
      } catch {}
    }

    logger.log(`DB refresh complete for ${ctx.issueId}`);
    return { seedVerifyResult };
  },

  async seed(ctx: SeedDatabaseContext): Promise<void> {
    const logger = requireLogger(ctx.logger, '[db-seed]');

    logger.setText(`Finding database container ${ctx.pgContainer}...`);

    try {
      const { stdout } = await execAsync(`docker ps --filter "name=${ctx.pgContainer}" --format "{{.Names}}"`);
      if (!stdout.trim()) {
        logger.fail(`Database container not running: ${ctx.pgContainer}`);
        logger.log('\nStart the workspace containers first:');
        logger.log(`  pan workspace create ${ctx.workspaceOrIssue} --docker`);
        return;
      }
    } catch {
      logger.fail('Failed to check Docker containers');
      return;
    }

    if (!ctx.force) {
      try {
        const { stdout } = await execAsync(
          `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} -c "SELECT count(*) FROM flyway_schema_history" -t 2>/dev/null`
        );
        const count = parseInt(stdout.trim(), 10);
        if (count > 0) {
          logger.info(`Database already seeded (${count} migrations). Use --force to reseed.`);
          return;
        }
      } catch {
        // Table doesn't exist, proceed with seeding
      }
    }

    if (ctx.force) {
      logger.setText('Dropping existing database...');
      try {
        await execAsync(
          `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -c "DROP DATABASE IF EXISTS ${sqlIdentifier(ctx.databaseName)}; CREATE DATABASE ${sqlIdentifier(ctx.databaseName)};"`
        );
      } catch (error: unknown) {
        logger.warn(`Could not drop database: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    logger.setText('Copying seed file to container...');
    await execAsync(`docker cp ${shellQuote(ctx.seedFile)} ${shellQuote(`${ctx.pgContainer}:/tmp/seed.sql`)}`);

    logger.setText('Executing seed...');
    try {
      await execAsync(`docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} -f /tmp/seed.sql`, {
        timeout: 600000,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ERROR')) {
        logger.fail(`Seed failed: ${message}`);
        return;
      }
    }

    await execAsync(`docker exec ${shellQuote(ctx.pgContainer)} rm /tmp/seed.sql`);

    logger.succeed('Database seeded successfully');

    try {
      const { stdout } = await execAsync(
        `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} -c "SELECT version, description FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3" -t`
      );
      logger.log('\nRecent migrations:');
      stdout
        .trim()
        .split('\n')
        .forEach((line) => logger.log(`  ${line.trim()}`));
    } catch {
      // Ignore
    }
  },

  repairMigrations(ctx: RepairMigrationsContext): Promise<RepairMigrationsResult> {
    return repairFlywayIfNeeded(
      ctx.issueId,
      ctx.pgContainer,
      ctx.databaseName,
      ctx.projectConfig,
      ctx.workspacePath,
      ctx.log
    );
  },

  async snapshot(ctx: SnapshotDatabaseContext): Promise<SnapshotDatabaseResult> {
    const logger = requireLogger(ctx.logger, '[db-snapshot]');

    if (!ctx.dbConfig.snapshot_command && !ctx.dbConfig.external_db) {
      throw new DatabaseProvisionerError(
        `No snapshot configuration for project ${'key' in ctx.projectConfig ? String(ctx.projectConfig.key) : ctx.projectConfig.name}`
      );
    }

    const outputPath =
      ctx.output ||
      ctx.dbConfig.seed_file ||
      join(ctx.projectConfig.path, 'infra', 'seed', 'seed.sql');

    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    logger.setText('Running snapshot command...');

    const snapshotCmd = getSnapshotCommand(ctx.dbConfig);
    if (!snapshotCmd) {
      throw new DatabaseProvisionerError('No snapshot configuration found');
    }

    const fullCmd = `${snapshotCmd} > "${outputPath}" 2>&1`;

    try {
      await execAsync(fullCmd, { timeout: 300000 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (existsSync(outputPath)) {
        const content = readFileSync(outputPath, 'utf-8');
        if (content.includes('PostgreSQL database dump')) {
          logger.warn('Snapshot completed with warnings (stderr captured)');
          logger.log('  Run `pan db clean` to remove stderr noise from the file');
        } else {
          throw new DatabaseProvisionerError(`Snapshot failed: ${message}`);
        }
      } else {
        throw new DatabaseProvisionerError(`Snapshot failed: ${message}`);
      }
    }

    const content = readFileSync(outputPath, 'utf-8');
    if (content.includes('Defaulted container') || content.includes('Unable to use a TTY')) {
      logger.setText('Cleaning kubectl output from snapshot...');
      await cleanFile(outputPath);
    }

    if (ctx.sanitize && ctx.dbConfig.seed_command) {
      logger.setText('Running sanitization...');
      try {
        await execAsync(ctx.dbConfig.seed_command, { cwd: ctx.projectConfig.path });
      } catch (error: unknown) {
        logger.warn(`Sanitization warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const stats = statSync(outputPath);
    return { outputPath, sizeBytes: stats.size };
  },

  async cleanSnapshot(ctx: CleanSnapshotContext): Promise<CleanSnapshotResult> {
    if (!existsSync(ctx.file)) {
      throw new DatabaseProvisionerError(`File not found: ${ctx.file}`);
    }

    const content = readFileSync(ctx.file, 'utf-8');
    const lines = content.split('\n');
    const patternsToRemove = kubectlNoisePatterns();

    let startIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('--') && lines[i].includes('PostgreSQL')) {
        startIndex = i;
        break;
      }
    }
    void startIndex;

    const dumpStarts: number[] = [];
    const dumpEnds: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('PostgreSQL database dump') && lines[i].startsWith('--')) {
        if (!lines[i].includes('complete')) {
          dumpStarts.push(i);
        }
      }
      if (lines[i].includes('PostgreSQL database dump complete')) {
        dumpEnds.push(i);
      }
    }

    let cleanedLines: string[];
    if (dumpStarts.length > 1 && dumpEnds.length > 0) {
      const lastEnd = dumpEnds[dumpEnds.length - 1];
      let useStart = dumpStarts[0];
      for (const start of dumpStarts) {
        if (start < lastEnd) {
          useStart = start;
        } else {
          break;
        }
      }
      cleanedLines = lines.slice(useStart, lastEnd + 1);
      ctx.logger?.setText(`Found ${dumpStarts.length} dump headers, using last complete dump`);
    } else {
      cleanedLines = lines.filter((line) => !patternsToRemove.some((p) => p.test(line)));
    }

    cleanedLines = cleanedLines.filter((line) => !patternsToRemove.some((p) => p.test(line)));

    const cleanedContent = cleanedLines.join('\n');
    const removedLines = lines.length - cleanedLines.length;
    const removedSample = lines
      .filter((line) => patternsToRemove.some((p) => p.test(line)))
      .slice(0, 5);

    if (ctx.dryRun) {
      return {
        originalLines: lines.length,
        cleanedLines: cleanedLines.length,
        removedLines,
        removedSample,
      };
    }

    const outputPath = ctx.output || ctx.file;
    writeFileSync(outputPath, cleanedContent);

    return {
      outputPath,
      originalLines: lines.length,
      cleanedLines: cleanedLines.length,
      removedLines,
      removedSample,
    };
  },

  async status(ctx: StatusDatabaseContext): Promise<void> {
    const logger = requireLogger(ctx.logger, '[db-status]');

    logger.setText(`Checking container ${ctx.pgContainer}...`);

    const { stdout: containerStatus } = await execAsync(
      `docker ps --filter "name=${ctx.pgContainer}" --format "{{.Status}}"`
    );

    if (!containerStatus.trim()) {
      logger.fail(`Container not running: ${ctx.pgContainer}`);
      return;
    }

    logger.succeed(`Container: ${ctx.pgContainer}`);
    logger.log(`  Status: ${containerStatus.trim()}`);

    try {
      const { stdout: version } = await execAsync(
        `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} -c "SELECT version, description FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1" -t`
      );
      const [ver, desc] = version.trim().split('|').map((s) => s.trim());
      logger.log(`  Flyway: V${ver} - ${desc}`);
    } catch {
      logger.warn('  Flyway: Not initialized');
    }

    try {
      const { stdout: tableCount } = await execAsync(
        `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" -t`
      );
      logger.log(`  Tables: ${tableCount.trim()}`);
    } catch {
      // Ignore
    }

    try {
      const { stdout: dbSize } = await execAsync(
        `docker exec ${shellQuote(ctx.pgContainer)} psql -U postgres -d ${shellQuote(ctx.databaseName)} -c "SELECT pg_size_pretty(pg_database_size('${sqlString(ctx.databaseName)}'))" -t`
      );
      logger.log(`  Size: ${dbSize.trim()}`);
    } catch {
      // Ignore
    }
  },
};

export function getFlywayPostgresSnapshotHelp(projectKey: string): string {
  return getSnapshotHelp(projectKey);
}
