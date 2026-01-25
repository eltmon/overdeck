import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { extractTeamPrefix, loadProjectsConfig, PROJECTS_CONFIG_FILE } from '../../lib/projects.js';
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
  const config = loadProjectsConfig();
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
    (p) => p.linear_team?.toUpperCase() === teamPrefix.toUpperCase()
  ) || null;
}

export function registerDbCommands(program: Command): void {
  const db = program.command('db').description('Database seeding and management');

  db.command('snapshot')
    .description('Create a database snapshot from an external source')
    .option('--project <key>', 'Project key (e.g., myn)')
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
    .description('Clean kubectl/stderr garbage from a pg_dump file')
    .option('--output <path>', 'Output file (default: overwrite input)')
    .option('--dry-run', 'Show what would be cleaned without modifying')
    .action(cleanCommand);

  db.command('config')
    .description('Show database configuration for a project')
    .argument('[project]', 'Project key')
    .action(configCommand);
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
        (p) => p.key === options.project || p.linear_team === options.project?.toUpperCase()
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

    if (!dbConfig?.snapshot_command && !dbConfig?.external_db) {
      spinner.fail(`No snapshot configuration for project ${projectConfig.key}`);
      console.log(chalk.dim('\nAdd database config to projects.yaml:'));
      console.log(chalk.dim(`
  ${projectConfig.key}:
    workspace:
      database:
        snapshot_command: "kubectl exec -n prod pod/postgres -- pg_dump -U app mydb"
        # or
        external_db:
          host: prod-db.example.com
          database: myapp
          user: readonly
          password_env: PROD_DB_PASSWORD
`));
      return;
    }

    // Determine output path
    const outputPath =
      options.output ||
      dbConfig.seed_file ||
      join(projectConfig.path, 'infra', 'seed', 'seed.sql');

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    spinner.text = 'Running snapshot command...';

    let snapshotCmd: string;

    if (dbConfig.snapshot_command) {
      snapshotCmd = dbConfig.snapshot_command;
    } else if (dbConfig.external_db) {
      const ext = dbConfig.external_db;
      const password = ext.password_env ? process.env[ext.password_env] : '';
      if (ext.password_env && !password) {
        spinner.fail(`Environment variable ${ext.password_env} not set`);
        return;
      }
      snapshotCmd = `PGPASSWORD="${password}" pg_dump -h ${ext.host} -p ${ext.port || 5432} -U ${ext.user || 'postgres'} ${ext.database}`;
    } else {
      spinner.fail('No snapshot configuration found');
      return;
    }

    // Run snapshot and redirect to file
    const fullCmd = `${snapshotCmd} > "${outputPath}" 2>&1`;

    try {
      await execAsync(fullCmd, { timeout: 300000 }); // 5 minute timeout
    } catch (error: any) {
      // Check if output file was created despite error (common with kubectl stderr noise)
      if (existsSync(outputPath)) {
        const content = readFileSync(outputPath, 'utf-8');
        if (content.includes('PostgreSQL database dump')) {
          spinner.warn('Snapshot completed with warnings (stderr captured)');
          console.log(chalk.dim('  Run `pan db clean` to remove stderr noise from the file'));
        } else {
          spinner.fail(`Snapshot failed: ${error.message}`);
          return;
        }
      } else {
        spinner.fail(`Snapshot failed: ${error.message}`);
        return;
      }
    }

    // Clean the file if it has kubectl noise
    const content = readFileSync(outputPath, 'utf-8');
    if (content.includes('Defaulted container') || content.includes('Unable to use a TTY')) {
      spinner.text = 'Cleaning kubectl output from snapshot...';
      await cleanFile(outputPath);
    }

    // Sanitize if requested
    if (options.sanitize && dbConfig.seed_command) {
      spinner.text = 'Running sanitization...';
      try {
        await execAsync(dbConfig.seed_command, { cwd: projectConfig.path });
      } catch (error: any) {
        spinner.warn(`Sanitization warning: ${error.message}`);
      }
    }

    spinner.succeed(`Snapshot saved to ${outputPath}`);

    // Show file size
    const stats = statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(chalk.dim(`  Size: ${sizeMB} MB`));
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
    const seedFile = options.file || dbConfig?.seed_file;

    if (!seedFile || !existsSync(seedFile)) {
      spinner.fail(`Seed file not found: ${seedFile || '(not configured)'}`);
      console.log(chalk.dim('\nConfigure seed_file in projects.yaml or use --file'));
      return;
    }

    // Find the postgres container for this workspace
    const projectName = `${projectConfig.name?.toLowerCase().replace(/\s+/g, '-')}-${folderName}`;
    const containerName = dbConfig?.container_name?.replace('{{PROJECT}}', projectName) || `${projectName}-postgres-1`;

    spinner.text = `Finding database container ${containerName}...`;

    // Check if container exists and is running
    try {
      const { stdout } = await execAsync(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`);
      if (!stdout.trim()) {
        spinner.fail(`Database container not running: ${containerName}`);
        console.log(chalk.dim('\nStart the workspace containers first:'));
        console.log(chalk.dim(`  pan workspace create ${workspaceOrIssue} --docker`));
        return;
      }
    } catch {
      spinner.fail('Failed to check Docker containers');
      return;
    }

    // Check if database is already seeded (has flyway_schema_history with entries)
    if (!options.force) {
      try {
        const { stdout } = await execAsync(
          `docker exec ${containerName} psql -U postgres -d myn -c "SELECT count(*) FROM flyway_schema_history" -t 2>/dev/null`
        );
        const count = parseInt(stdout.trim(), 10);
        if (count > 0) {
          spinner.info(`Database already seeded (${count} migrations). Use --force to reseed.`);
          return;
        }
      } catch {
        // Table doesn't exist, proceed with seeding
      }
    }

    // Drop and recreate database for clean seed
    if (options.force) {
      spinner.text = 'Dropping existing database...';
      try {
        await execAsync(
          `docker exec ${containerName} psql -U postgres -c "DROP DATABASE IF EXISTS myn; CREATE DATABASE myn;"`
        );
      } catch (error: any) {
        spinner.warn(`Could not drop database: ${error.message}`);
      }
    }

    // Copy seed file to container and execute
    spinner.text = 'Copying seed file to container...';
    await execAsync(`docker cp "${seedFile}" ${containerName}:/tmp/seed.sql`);

    spinner.text = 'Executing seed...';
    try {
      await execAsync(`docker exec ${containerName} psql -U postgres -d myn -f /tmp/seed.sql`, {
        timeout: 600000, // 10 minute timeout for large seeds
      });
    } catch (error: any) {
      // psql may return non-zero even on success with warnings
      if (error.message.includes('ERROR')) {
        spinner.fail(`Seed failed: ${error.message}`);
        return;
      }
    }

    // Clean up
    await execAsync(`docker exec ${containerName} rm /tmp/seed.sql`);

    spinner.succeed('Database seeded successfully');

    // Show migration status
    try {
      const { stdout } = await execAsync(
        `docker exec ${containerName} psql -U postgres -d myn -c "SELECT version, description FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3" -t`
      );
      console.log(chalk.dim('\nRecent migrations:'));
      stdout
        .trim()
        .split('\n')
        .forEach((line) => console.log(chalk.dim(`  ${line.trim()}`)));
    } catch {
      // Ignore
    }
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

    spinner.text = `Checking container ${containerName}...`;

    // Check if container is running
    const { stdout: containerStatus } = await execAsync(
      `docker ps --filter "name=${containerName}" --format "{{.Status}}"`
    );

    if (!containerStatus.trim()) {
      spinner.fail(`Container not running: ${containerName}`);
      return;
    }

    spinner.succeed(`Container: ${containerName}`);
    console.log(chalk.dim(`  Status: ${containerStatus.trim()}`));

    // Check flyway version
    try {
      const { stdout: version } = await execAsync(
        `docker exec ${containerName} psql -U postgres -d myn -c "SELECT version, description FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1" -t`
      );
      const [ver, desc] = version.trim().split('|').map((s) => s.trim());
      console.log(chalk.green(`  Flyway: V${ver} - ${desc}`));
    } catch {
      console.log(chalk.yellow('  Flyway: Not initialized'));
    }

    // Check table count
    try {
      const { stdout: tableCount } = await execAsync(
        `docker exec ${containerName} psql -U postgres -d myn -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" -t`
      );
      console.log(chalk.dim(`  Tables: ${tableCount.trim()}`));
    } catch {
      // Ignore
    }

    // Check database size
    try {
      const { stdout: dbSize } = await execAsync(
        `docker exec ${containerName} psql -U postgres -d myn -c "SELECT pg_size_pretty(pg_database_size('myn'))" -t`
      );
      console.log(chalk.dim(`  Size: ${dbSize.trim()}`));
    } catch {
      // Ignore
    }
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

    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    // Find patterns to remove
    const patternsToRemove = [
      /^Defaulted container/,
      /^Unable to use a TTY/,
      /^All commands and output from this session/,
      /^If you don't see a command prompt/,
      /^warning: couldn't attach to pod/,
      /^pod ".*" deleted from .* namespace$/,
      /^\[stderr\]/,
      /^error: timed out waiting/,
    ];

    // Find the actual dump start (first line that starts with --)
    let startIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('--') && lines[i].includes('PostgreSQL')) {
        startIndex = i;
        break;
      }
    }

    // If there are duplicates (multiple dumps), find the last complete one
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

    // Use the last complete dump
    let cleanedLines: string[];
    if (dumpStarts.length > 1 && dumpEnds.length > 0) {
      const lastEnd = dumpEnds[dumpEnds.length - 1];
      // Find the dump start that comes before the last end
      let useStart = dumpStarts[0];
      for (const start of dumpStarts) {
        if (start < lastEnd) {
          useStart = start;
        } else {
          break;
        }
      }
      cleanedLines = lines.slice(useStart, lastEnd + 1);
      spinner.text = `Found ${dumpStarts.length} dump headers, using last complete dump`;
    } else {
      // Just clean the noise from the file
      cleanedLines = lines.filter((line) => !patternsToRemove.some((p) => p.test(line)));
    }

    // Remove any remaining kubectl noise between valid SQL
    cleanedLines = cleanedLines.filter((line) => !patternsToRemove.some((p) => p.test(line)));

    const cleanedContent = cleanedLines.join('\n');
    const removedLines = lines.length - cleanedLines.length;

    if (options.dryRun) {
      spinner.info(`Would remove ${removedLines} lines`);
      if (removedLines > 0) {
        console.log(chalk.dim('\nLines to remove (sample):'));
        const removed = lines.filter((line) => patternsToRemove.some((p) => p.test(line))).slice(0, 5);
        removed.forEach((line) => console.log(chalk.red(`  - ${line.slice(0, 80)}...`)));
      }
      return;
    }

    const outputPath = options.output || file;
    writeFileSync(outputPath, cleanedContent);

    spinner.succeed(`Cleaned ${removedLines} lines`);
    console.log(chalk.dim(`  Output: ${outputPath}`));
    console.log(chalk.dim(`  Original: ${lines.length} lines`));
    console.log(chalk.dim(`  Cleaned: ${cleanedLines.length} lines`));
  } catch (error: any) {
    spinner.fail(`Clean failed: ${error.message}`);
  }
}

async function cleanFile(filePath: string): Promise<void> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Find the actual dump start
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('--') && lines[i].includes('PostgreSQL database dump')) {
      startIndex = i;
      break;
    }
  }

  // Find patterns to remove
  const patternsToRemove = [
    /^Defaulted container/,
    /^Unable to use a TTY/,
    /^All commands and output from this session/,
    /^If you don't see a command prompt/,
    /^warning: couldn't attach to pod/,
    /^pod ".*" deleted from .* namespace$/,
    /^\[stderr\]/,
    /^error: timed out waiting/,
  ];

  const cleanedLines = lines.slice(startIndex).filter((line) => !patternsToRemove.some((p) => p.test(line)));

  writeFileSync(filePath, cleanedLines.join('\n'));
}

async function configCommand(project?: string): Promise<void> {
  const projects = loadFullProjects();

  let projectConfig: ExtendedProjectConfig | undefined;
  if (project) {
    projectConfig = projects.find(
      (p) => p.key === project || p.linear_team === project.toUpperCase()
    );
  } else {
    const cwd = process.cwd();
    projectConfig = projects.find((p) => cwd.startsWith(p.path));
  }

  if (!projectConfig) {
    console.log(chalk.red('Project not found'));
    console.log(chalk.dim('\nAvailable projects:'));
    projects.forEach((p) => console.log(chalk.dim(`  ${p.key} (${p.linear_team || 'no team'})`)));
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
    seed_file: /path/to/seed.sql
    snapshot_command: "kubectl exec -n prod pod/postgres -- pg_dump -U app db"
    container_name: "{{PROJECT}}-postgres-1"
`));
    return;
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
