import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { extractTeamPrefix, loadProjectsConfigSync, PROJECTS_CONFIG_FILE, getIssuePrefix } from '../../lib/projects.js';
import { backfillAgentsSync } from '../../lib/overdeck/agents.js';
import {
  DatabaseProvisionerError,
  getDatabaseProvisioner,
  getSnapshotCleanerProvisioner,
  type DatabaseProvisionerLogger,
} from '../../lib/db-provisioners/index.js';
import type { DatabaseConfig, ProjectConfig as FullProjectConfig } from '../../lib/workspace-config.js';

const execAsync = promisify(exec);

// Extended project config that includes the full workspace config
interface ExtendedProjectConfig extends FullProjectConfig {
  key: string;
}

/**
 * Load all projects with their full configuration (including workspace)
 */
function loadFullProjects(): ExtendedProjectConfig[] {
  const config = loadProjectsConfigSync();
  // The loaded config has full workspace config, just not typed properly
  const projects = config.projects as Record<string, FullProjectConfig>;
  return Object.entries(projects).map(([key, projectConfig]) => ({
    ...projectConfig,
    key,
  }));
}

/**
 * Find a project by team prefix with full config
 */
function findFullProjectByTeam(teamPrefix: string): ExtendedProjectConfig | null {
  const projects = loadFullProjects();
  return projects.find(
    (p) => getIssuePrefix(p)?.toUpperCase() === teamPrefix.toUpperCase()
  ) || null;
}

function requireDatabaseName(dbConfig: DatabaseConfig | undefined): string {
  if (!dbConfig) {
    throw new Error('No database configuration found in projects.yaml');
  }
  const name = dbConfig.name?.trim();
  if (!name) {
    throw new Error('Missing required database.name in projects.yaml database config');
  }
  return name;
}

function spinnerLogger(spinner: ReturnType<typeof ora>): DatabaseProvisionerLogger {
  return {
    setText(message) { spinner.text = message; },
    info(message) { spinner.info(message); },
    warn(message) { spinner.warn(message); },
    fail(message) { spinner.fail(message); },
    succeed(message) { spinner.succeed(message); },
    log(message) { console.log(chalk.dim(message)); },
  };
}

export function registerDbCommands(program: Command): void {
  const db = program.command('db').description('Database seeding and management');

  db.command('snapshot')
    .description('Create a database snapshot from an external source')
    .option('--project <key>', 'Project key')
    .option('--output <path>', 'Output file path')
    .option('--sanitize', 'Run sanitization script after snapshot')
    .action(snapshotCommand);

  db.command('seed <workspaceOrIssue>')
    .description('Seed a workspace database with the configured seed file')
    .option('--force', 'Force reseed even if already initialized')
    .option('--file <path>', 'Override seed file path')
    .action(seedCommand);

  db.command('status')
    .description('Check database status for a workspace')
    .argument('[workspaceOrIssue]', 'Workspace folder or issue ID')
    .action(statusCommand);

  db.command('clean <file>')
    .description('Clean kubectl/stderr garbage from a database dump file')
    .option('--output <path>', 'Output file (default: overwrite input)')
    .option('--dry-run', 'Show what would be cleaned without modifying')
    .action(cleanCommand);

  db.command('config')
    .description('Show database configuration for a project')
    .argument('[project]', 'Project key')
    .action(configCommand);

  db.command('rebuild-agents')
    .description('Rebuild the SQLite agents table from state.json rollback sources (PAN-1908)')
    .option('--dry-run', 'Show what would be backfilled without writing')
    .option('--verbose', 'Log each processed agent')
    .action(rebuildAgentsCommand);

  db.command('rebuild')
    .description('Reconstruct the dashboard cache from git + GitHub sources (PAN-1920)')
    .option('--verbose', 'Log each enumerated issue and agent')
    .action(rebuildCommand);

  db.command('backfill-records')
    .description('Backfill per-issue permanent records into the infra repo (PAN-1908)')
    .option('--issue-id <id>', 'Backfill only this issue')
    .option('--force', 'Overwrite records even if unchanged')
    .option('--verbose', 'Log each processed issue')
    .action(backfillRecordsCommand);

  db.command('restore-verdicts')
    .description('Rebuild review_status verdicts from per-issue records + live GitHub PR state (PAN-1922)')
    .option('--issue-id <id>', 'Restore only this issue')
    .option('--dry-run', 'Show what would be restored without writing')
    .option('--verbose', 'Log each processed issue')
    .action(restoreVerdictsCommand);
}

async function snapshotCommand(options: {
  project?: string;
  output?: string;
  sanitize?: boolean;
}): Promise<void> {
  const spinner = ora('Creating database snapshot...').start();

  try {
    // Find project
    let projectConfig: ExtendedProjectConfig | null | undefined;
    if (options.project) {
      const projects = loadFullProjects();
      projectConfig = projects.find(
        (p) => p.key === options.project || getIssuePrefix(p) === options.project?.toUpperCase()
      );
    } else {
      // Try to detect from current directory
      const cwd = process.cwd();
      const projects = loadFullProjects();
      projectConfig = projects.find((p) => cwd.startsWith(p.path));
    }

    if (!projectConfig) {
      spinner.fail('Could not determine project. Use --project <key>');
      return;
    }

    const dbConfig = projectConfig.workspace?.database;
    const provisioner = getDatabaseProvisioner(dbConfig);

    if (!dbConfig || !provisioner || (!dbConfig.snapshot_command && !dbConfig.external_db)) {
      spinner.fail(`No snapshot configuration for project ${projectConfig.key}`);
      console.log(chalk.dim('\nAdd database config to projects.yaml:'));
      console.log(chalk.dim(`
  ${projectConfig.key}:
    workspace:
      database:
        name: myapp
        snapshot_command: "command that writes a database dump to stdout"
        # or
        external_db:
          host: prod-db.example.com
          database: myapp
          user: readonly
          password_env: PROD_DB_PASSWORD
`));
      return;
    }

    try {
      const result = await provisioner.snapshot({
        projectConfig,
        dbConfig,
        output: options.output,
        sanitize: options.sanitize,
        logger: spinnerLogger(spinner),
      });

      spinner.succeed(`Snapshot saved to ${result.outputPath}`);

      const sizeMB = (result.sizeBytes / 1024 / 1024).toFixed(2);
      console.log(chalk.dim(`  Size: ${sizeMB} MB`));
    } catch (error: unknown) {
      spinner.fail(error instanceof Error ? error.message : String(error));
    }
  } catch (error: any) {
    spinner.fail(`Snapshot failed: ${error.message}`);
  }
}

async function seedCommand(
  workspaceOrIssue: string,
  options: { force?: boolean; file?: string }
): Promise<void> {
  const spinner = ora('Seeding database...').start();

  try {
    // Normalize issue ID to workspace folder name
    const normalizedId = workspaceOrIssue.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const folderName = normalizedId.startsWith('feature-') ? normalizedId : `feature-${normalizedId}`;

    // Find project
    const teamPrefix = extractTeamPrefix(workspaceOrIssue);
    const projectConfig = teamPrefix ? findFullProjectByTeam(teamPrefix) : null;

    if (!projectConfig?.workspace) {
      spinner.fail('Could not find project workspace configuration');
      return;
    }

    const workspacePath = join(projectConfig.path, projectConfig.workspace.workspaces_dir || 'workspaces', folderName);

    if (!existsSync(workspacePath)) {
      spinner.fail(`Workspace not found: ${workspacePath}`);
      return;
    }

    const dbConfig = projectConfig.workspace.database;
    const provisioner = getDatabaseProvisioner(dbConfig);
    if (!dbConfig || !provisioner) {
      spinner.fail('No database configuration found in projects.yaml');
      return;
    }
    const databaseName = requireDatabaseName(dbConfig);
    const seedFile = options.file || dbConfig?.seed_file;

    if (!seedFile || !existsSync(seedFile)) {
      spinner.fail(`Seed file not found: ${seedFile || '(not configured)'}`);
      console.log(chalk.dim('\nConfigure seed_file in projects.yaml or use --file'));
      return;
    }

    // Find the postgres container for this workspace
    const projectName = `${projectConfig.name?.toLowerCase().replace(/\s+/g, '-')}-${folderName}`;
    const containerName = dbConfig?.container_name?.replace('{{PROJECT}}', projectName) || `${projectName}-postgres-1`;

    await provisioner.seed({
      workspaceOrIssue,
      projectConfig,
      workspacePath,
      pgContainer: containerName,
      databaseName,
      seedFile,
      force: options.force,
      logger: spinnerLogger(spinner),
    });
  } catch (error: any) {
    spinner.fail(`Seed failed: ${error.message}`);
  }
}

async function statusCommand(workspaceOrIssue?: string): Promise<void> {
  const spinner = ora('Checking database status...').start();

  try {
    // If no workspace specified, try to detect from cwd
    let containerName: string | undefined;
    let projectConfig: ExtendedProjectConfig | null | undefined;

    if (workspaceOrIssue) {
      const normalizedId = workspaceOrIssue.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const folderName = normalizedId.startsWith('feature-') ? normalizedId : `feature-${normalizedId}`;
      const teamPrefix = extractTeamPrefix(workspaceOrIssue);
      projectConfig = teamPrefix ? findFullProjectByTeam(teamPrefix) : null;

      if (projectConfig?.workspace) {
        const projectName = `${projectConfig.name?.toLowerCase().replace(/\s+/g, '-')}-${folderName}`;
        containerName = `${projectName}-postgres-1`;
      }
    } else {
      // Try to find postgres container from cwd
      const cwd = process.cwd();
      const projects = loadFullProjects();
      projectConfig = projects.find((p) => cwd.startsWith(p.path));

      if (projectConfig) {
        // Look for any running postgres container for this project
        const { stdout } = await execAsync(
          `docker ps --filter "name=${projectConfig.name?.toLowerCase().replace(/\s+/g, '-')}" --filter "name=postgres" --format "{{.Names}}" | head -1`
        );
        containerName = stdout.trim();
      }
    }

    if (!containerName) {
      spinner.fail('Could not determine database container');
      console.log(chalk.dim('\nUsage: pan db status <issue-id>'));
      console.log(chalk.dim('       pan db status MIN-123'));
      return;
    }

    const dbConfig = projectConfig?.workspace?.database;
    const provisioner = getDatabaseProvisioner(dbConfig);
    if (!projectConfig || !dbConfig || !provisioner) {
      spinner.fail('No database configuration found in projects.yaml');
      return;
    }

    await provisioner.status({
      projectConfig,
      pgContainer: containerName,
      databaseName: requireDatabaseName(dbConfig),
      logger: spinnerLogger(spinner),
    });
  } catch (error: any) {
    spinner.fail(`Status check failed: ${error.message}`);
  }
}

async function cleanCommand(
  file: string,
  options: { output?: string; dryRun?: boolean }
): Promise<void> {
  const spinner = ora('Cleaning database dump file...').start();

  try {
    if (!existsSync(file)) {
      spinner.fail(`File not found: ${file}`);
      return;
    }

    const provisioner = getSnapshotCleanerProvisioner();
    const result = await provisioner.cleanSnapshot({
      file,
      output: options.output,
      dryRun: options.dryRun,
      logger: spinnerLogger(spinner),
    });

    if (options.dryRun) {
      spinner.info(`Would remove ${result.removedLines} lines`);
      if (result.removedLines > 0) {
        console.log(chalk.dim('\nLines to remove (sample):'));
        result.removedSample.forEach((line) => console.log(chalk.red(`  - ${line.slice(0, 80)}...`)));
      }
      return;
    }

    spinner.succeed(`Cleaned ${result.removedLines} lines`);
    console.log(chalk.dim(`  Output: ${result.outputPath}`));
    console.log(chalk.dim(`  Original: ${result.originalLines} lines`));
    console.log(chalk.dim(`  Cleaned: ${result.cleanedLines} lines`));
  } catch (error: any) {
    spinner.fail(`Clean failed: ${error.message}`);
  }
}

async function configCommand(project?: string): Promise<void> {
  const projects = loadFullProjects();

  let projectConfig: ExtendedProjectConfig | undefined;
  if (project) {
    projectConfig = projects.find(
      (p) => p.key === project || getIssuePrefix(p) === project.toUpperCase()
    );
  } else {
    const cwd = process.cwd();
    projectConfig = projects.find((p) => cwd.startsWith(p.path));
  }

  if (!projectConfig) {
    console.log(chalk.red('Project not found'));
    console.log(chalk.dim('\nAvailable projects:'));
    projects.forEach((p) => console.log(chalk.dim(`  ${p.key} (${getIssuePrefix(p) || 'no team'})`)));
    return;
  }

  console.log(chalk.bold(`Database Configuration: ${projectConfig.key}`));
  console.log('');

  const dbConfig = projectConfig.workspace?.database;

  if (!dbConfig) {
    console.log(chalk.yellow('No database configuration found'));
    console.log(chalk.dim('\nAdd to projects.yaml under workspace:'));
    console.log(chalk.dim(`
  database:
    name: myapp
    seed_file: /path/to/seed.sql
    snapshot_command: "command that writes a database dump to stdout"
    container_name: "{{PROJECT}}-postgres-1"
`));
    return;
  }

  console.log(`  Database: ${dbConfig.name || chalk.red('(missing database.name)')}`);
  if (dbConfig.seedVerifyQuery) {
    console.log(`  Seed verify query: ${dbConfig.seedVerifyQuery}`);
  }

  if (dbConfig.seed_file) {
    const exists = existsSync(dbConfig.seed_file);
    console.log(`  Seed file: ${dbConfig.seed_file}`);
    console.log(chalk.dim(`    Status: ${exists ? chalk.green('exists') : chalk.red('not found')}`));
    if (exists) {
      const stats = statSync(dbConfig.seed_file);
      console.log(chalk.dim(`    Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`));
    }
  }

  if (dbConfig.snapshot_command) {
    console.log(`  Snapshot: ${dbConfig.snapshot_command.slice(0, 60)}...`);
  }

  if (dbConfig.external_db) {
    console.log(`  External DB: ${dbConfig.external_db.host}:${dbConfig.external_db.port || 5432}/${dbConfig.external_db.database}`);
  }

  if (dbConfig.container_name) {
    console.log(`  Container: ${dbConfig.container_name}`);
  }

  if (dbConfig.migrations) {
    console.log(`  Migrations: ${dbConfig.migrations.type}`);
    if (dbConfig.migrations.path) {
      console.log(chalk.dim(`    Path: ${dbConfig.migrations.path}`));
    }
  }
}

async function rebuildAgentsCommand(options: {
  dryRun?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const spinner = ora('Rebuilding agents table from state.json sources...').start();

  try {
    const result = backfillAgentsSync({ verbose: options.verbose });

    if (options.dryRun) {
      spinner.info(
        `Dry run: would process ${result.processed} agents, mark ${result.markedStopped} stopped, skip ${result.skipped}`
      );
      return;
    }

    spinner.succeed(
      `Rebuilt agents table: ${result.processed} rows, ${result.markedStopped} marked stopped, ${result.skipped} skipped`
    );
  } catch (error: any) {
    spinner.fail(`Rebuild failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function rebuildCommand(options: { verbose?: boolean }): Promise<void> {
  const spinner = ora('Reconstructing cache from git + GitHub sources...').start();

  try {
    const { reconstructCacheAuto } = await import('../../lib/reconstruct/reconstruct-cache.js');
    const r = await reconstructCacheAuto({ verbose: options.verbose });
    const phases = Object.entries(r.phaseCounts)
      .map(([p, n]) => `${p}=${n}`)
      .join(' ');

    const { restoreReviewStatusFromRecords } = await import('../../lib/pan-dir/verdict-restore.js');
    const verdictResult = await restoreReviewStatusFromRecords({ verbose: options.verbose });

    spinner.succeed(
      `Reconstructed: ${r.issuesEnumerated} in-flight issue(s), ${r.agentsRebuilt} agent(s), ${verdictResult.restored} verdict(s) restored; phases ${phases}`,
    );
  } catch (error: any) {
    spinner.fail(`Reconstruct failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function backfillRecordsCommand(options: {
  issueId?: string;
  force?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const spinner = ora('Backfilling per-issue permanent records...').start();

  try {
    const { backfillIssueRecords } = await import('../../lib/pan-dir/records-backfill.js');
    const result = await backfillIssueRecords({
      issueId: options.issueId,
      force: options.force,
      verbose: options.verbose,
    });

    spinner.succeed(
      `Records backfill complete: ${result.processed} written, ${result.skipped} skipped, ${result.failed} failed`
    );

    if (result.failed > 0) {
      for (const detail of result.details) {
        if (detail.action === 'failed') {
          console.log(chalk.red(`  ${detail.issueId}: ${detail.reason}`));
        }
      }
      process.exitCode = 1;
    }
  } catch (error: any) {
    spinner.fail(`Records backfill failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function restoreVerdictsCommand(options: {
  issueId?: string;
  dryRun?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const spinner = ora('Restoring review_status verdicts from per-issue records...').start();

  try {
    const { restoreReviewStatusFromRecords } = await import('../../lib/pan-dir/verdict-restore.js');
    const result = await restoreReviewStatusFromRecords({
      issueId: options.issueId,
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    spinner.succeed(
      `Verdict restore complete: ${result.restored} restored, ${result.skipped} skipped, ${result.failed} failed`
    );

    if (result.failed > 0) {
      for (const detail of result.details) {
        if (detail.action === 'failed') {
          console.log(chalk.red(`  ${detail.issueId}: ${detail.reason}`));
        }
      }
      process.exitCode = 1;
    }
  } catch (error: any) {
    spinner.fail(`Verdict restore failed: ${error.message}`);
    process.exitCode = 1;
  }
}
