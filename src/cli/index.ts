#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { restoreCommand } from './commands/restore.js';
import { backupListCommand, backupCleanCommand } from './commands/backup.js';
import { skillsCommand } from './commands/skills.js';
import { registerWorkCommands, statusCommand } from './commands/work/index.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerTestCommands } from './commands/test.js';
import { registerInstallCommand } from './commands/install.js';
import { registerCloisterCommands } from './commands/cloister/index.js';
import { registerSetupCommands } from './commands/setup/index.js';
import { registerSpecialistsCommands } from './commands/specialists/index.js';
import { registerConvoyCommands } from './commands/convoy/index.js';
import { projectAddCommand, projectListCommand, projectRemoveCommand, projectInitCommand, projectShowCommand } from './commands/project.js';
import { doctorCommand } from './commands/doctor.js';
import { updateCommand } from './commands/update.js';
import { registerDbCommands } from './commands/db.js';
import { registerBeadsCommands } from './commands/beads.js';
import { migrateConfigCommand } from './commands/migrate-config.js';

const program = new Command();

program
  .name('pan')
  .description('Multi-agent orchestration for AI coding assistants')
  .version('0.1.3');

program
  .command('init')
  .description('Initialize Panopticon (~/.panopticon/)')
  .action(initCommand);

program
  .command('sync')
  .description('Sync skills/commands to AI tools')
  .option('--dry-run', 'Show what would be synced')
  .option('--force', 'Overwrite without prompts')
  .option('--backup-only', 'Only create backup')
  .action(syncCommand);

program
  .command('restore [timestamp]')
  .description('Restore from backup')
  .action(restoreCommand);

// Backup management
const backup = program.command('backup').description('Manage backups');

backup
  .command('list')
  .description('List all backups')
  .option('--json', 'Output as JSON')
  .action(backupListCommand);

backup
  .command('clean')
  .description('Remove old backups')
  .option('--keep <count>', 'Number of backups to keep', '10')
  .action(backupCleanCommand);

program
  .command('skills')
  .description('List and manage skills')
  .option('--json', 'Output as JSON')
  .action(skillsCommand);

// Register work commands (pan work issue, pan work status, etc.)
registerWorkCommands(program);

// Register workspace commands (pan workspace create, pan workspace list, etc.)
registerWorkspaceCommands(program);

// Register test commands (pan test run, pan test list)
registerTestCommands(program);

// Register cloister commands (pan cloister status, pan cloister start, etc.)
registerCloisterCommands(program);

// Register specialists commands (pan specialists list, wake, queue, reset)
registerSpecialistsCommands(program);

// Register convoy commands (pan convoy start, status, list, stop)
registerConvoyCommands(program);

// Register setup commands (pan setup hooks, etc.)
registerSetupCommands(program);

// Register install command
registerInstallCommand(program);

// Register db commands (pan db snapshot, pan db seed, etc.)
registerDbCommands(program);

// Register beads commands (pan beads compact, pan beads stats)
registerBeadsCommands(program);

// Config migration
program
  .command('migrate-config')
  .description('Migrate from settings.json to config.yaml')
  .option('--force', 'Force migration even if config.yaml exists')
  .option('--preview', 'Preview migration without applying changes')
  .option('--no-backup', 'Do not back up settings.json')
  .option('--delete-legacy', 'Delete settings.json after migration')
  .action(migrateConfigCommand);

// Shorthand: pan status = pan work status
program
  .command('status')
  .description('Show running agents (shorthand for work status)')
  .option('--json', 'Output as JSON')
  .action(statusCommand);

// Dashboard commands
program
  .command('up')
  .description('Start dashboard (and Traefik if enabled)')
  .option('--detach', 'Run in background')
  .option('--skip-traefik', 'Skip Traefik startup')
  .action(async (options) => {
    const { spawn, execSync } = await import('child_process');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const { readFileSync, existsSync } = await import('fs');
    const { parse } = await import('@iarna/toml');

    // Find dashboard - check bundled first, then source
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const bundledServer = join(__dirname, '..', 'dashboard', 'server.js');
    const srcDashboard = join(__dirname, '..', '..', 'src', 'dashboard');

    // Check if Traefik is enabled
    const configFile = join(process.env.HOME || '', '.panopticon', 'config.toml');
    let traefikEnabled = false;
    let traefikDomain = 'pan.localhost';

    if (existsSync(configFile)) {
      try {
        const configContent = readFileSync(configFile, 'utf-8');
        const config = parse(configContent) as any;
        traefikEnabled = config.traefik?.enabled === true;
        traefikDomain = config.traefik?.domain || 'pan.localhost';
      } catch (error) {
        console.log(chalk.yellow('Warning: Could not read config.toml'));
      }
    }

    console.log(chalk.bold('Starting Panopticon...\n'));

    // Start Traefik if enabled
    if (traefikEnabled && !options.skipTraefik) {
      const traefikDir = join(process.env.HOME || '', '.panopticon', 'traefik');
      if (existsSync(traefikDir)) {
        try {
          // Ensure network is marked as external (migration for older installs)
          const composeFile = join(traefikDir, 'docker-compose.yml');
          if (existsSync(composeFile)) {
            const content = readFileSync(composeFile, 'utf-8');
            if (!content.includes('external: true') && content.includes('panopticon:')) {
              const patched = content.replace(
                /networks:\s*\n\s*panopticon:\s*\n\s*name: panopticon\s*\n\s*driver: bridge/,
                'networks:\n  panopticon:\n    name: panopticon\n    external: true  # Network created by \'pan install\''
              );
              const { writeFileSync } = await import('fs');
              writeFileSync(composeFile, patched);
              console.log(chalk.dim('  (migrated network config)'));
            }
          }

          console.log(chalk.dim('Starting Traefik...'));
          execSync('docker-compose up -d', {
            cwd: traefikDir,
            stdio: 'pipe',
          });
          console.log(chalk.green('✓ Traefik started'));
          console.log(chalk.dim(`  Dashboard: https://traefik.${traefikDomain}:8080\n`));
        } catch (error) {
          console.log(chalk.yellow('⚠ Failed to start Traefik (continuing anyway)'));
          console.log(chalk.dim('  Run with --skip-traefik to suppress this message\n'));
        }
      }
    }

    // Determine which mode to use
    const isProduction = existsSync(bundledServer);
    const isDevelopment = existsSync(srcDashboard);

    if (!isProduction && !isDevelopment) {
      console.error(chalk.red('Error: Dashboard not found'));
      console.error(chalk.dim('This may be a corrupted installation. Try reinstalling panopticon-cli.'));
      process.exit(1);
    }

    // Check npm is available (only needed for development mode)
    if (isDevelopment && !isProduction) {
      try {
        execSync('npm --version', { stdio: 'pipe' });
      } catch {
        console.error(chalk.red('Error: npm not found in PATH'));
        console.error(chalk.dim('Make sure Node.js and npm are installed and in your PATH'));
        process.exit(1);
      }
    }

    // Start dashboard
    if (isProduction) {
      console.log(chalk.dim('Starting dashboard (bundled mode)...'));
    } else {
      console.log(chalk.dim('Starting dashboard (development mode)...'));
    }

    if (options.detach) {
      // Run in background
      const child = isProduction
        ? spawn('node', [bundledServer], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, DASHBOARD_PORT: '3010' },
          })
        : spawn('npm', ['run', 'dev'], {
            cwd: srcDashboard,
            detached: true,
            stdio: 'ignore',
            shell: true,
          });

      // Handle spawn errors before unref
      let hasError = false;
      child.on('error', (err) => {
        hasError = true;
        console.error(chalk.red('Failed to start dashboard in background:'), err.message);
        process.exit(1);
      });

      // Small delay to catch immediate spawn errors
      setTimeout(() => {
        if (!hasError) {
          child.unref();
        }
      }, 100);
      console.log(chalk.green('✓ Dashboard started in background'));
      if (traefikEnabled) {
        console.log(`  Frontend: ${chalk.cyan(`https://${traefikDomain}`)}`);
        console.log(`  API:      ${chalk.cyan(`https://${traefikDomain}/api`)}`);
      } else if (isProduction) {
        console.log(`  URL: ${chalk.cyan('http://localhost:3010')}`);
      } else {
        console.log(`  Frontend: ${chalk.cyan('http://localhost:3001')}`);
        console.log(`  API:      ${chalk.cyan('http://localhost:3002')}`);
      }
    } else {
      // Run in foreground
      if (traefikEnabled) {
        console.log(`  Frontend: ${chalk.cyan(`https://${traefikDomain}`)}`);
        console.log(`  API:      ${chalk.cyan(`https://${traefikDomain}/api`)}`);
      } else if (isProduction) {
        console.log(`  URL: ${chalk.cyan('http://localhost:3010')}`);
      } else {
        console.log(`  Frontend: ${chalk.cyan('http://localhost:3001')}`);
        console.log(`  API:      ${chalk.cyan('http://localhost:3002')}`);
      }
      console.log(chalk.dim('\nPress Ctrl+C to stop\n'));

      const child = isProduction
        ? spawn('node', [bundledServer], {
            stdio: 'inherit',
            env: { ...process.env, DASHBOARD_PORT: '3010' },
          })
        : spawn('npm', ['run', 'dev'], {
            cwd: srcDashboard,
            stdio: 'inherit',
            shell: true,
          });

      child.on('error', (err) => {
        console.error(chalk.red('Failed to start dashboard:'), err.message);
        process.exit(1);
      });
    }
  });

program
  .command('down')
  .description('Stop dashboard (and Traefik if enabled)')
  .option('--skip-traefik', 'Skip Traefik shutdown')
  .action(async (options) => {
    const { execSync } = await import('child_process');
    const { join } = await import('path');
    const { readFileSync, existsSync } = await import('fs');
    const { parse } = await import('@iarna/toml');

    console.log(chalk.bold('Stopping Panopticon...\n'));

    // Stop dashboard
    console.log(chalk.dim('Stopping dashboard...'));
    try {
      // Kill processes on dashboard ports (development: 3001/3002, bundled: 3010)
      execSync('lsof -ti:3001 | xargs kill -9 2>/dev/null || true', { stdio: 'pipe' });
      execSync('lsof -ti:3002 | xargs kill -9 2>/dev/null || true', { stdio: 'pipe' });
      execSync('lsof -ti:3010 | xargs kill -9 2>/dev/null || true', { stdio: 'pipe' });
      console.log(chalk.green('✓ Dashboard stopped'));
    } catch {
      console.log(chalk.dim('  No dashboard processes found'));
    }

    // Check if Traefik is enabled
    const configFile = join(process.env.HOME || '', '.panopticon', 'config.toml');
    let traefikEnabled = false;

    if (existsSync(configFile)) {
      try {
        const configContent = readFileSync(configFile, 'utf-8');
        const config = parse(configContent) as any;
        traefikEnabled = config.traefik?.enabled === true;
      } catch (error) {
        // Ignore config read errors
      }
    }

    // Stop Traefik if enabled
    if (traefikEnabled && !options.skipTraefik) {
      const traefikDir = join(process.env.HOME || '', '.panopticon', 'traefik');
      if (existsSync(traefikDir)) {
        console.log(chalk.dim('Stopping Traefik...'));
        try {
          execSync('docker-compose down', {
            cwd: traefikDir,
            stdio: 'pipe',
          });
          console.log(chalk.green('✓ Traefik stopped'));
        } catch (error) {
          console.log(chalk.yellow('⚠ Failed to stop Traefik'));
        }
      }
    }

    console.log('');
  });

// Project management commands
const project = program.command('project').description('Project registry for multi-project workspace support');

project
  .command('add <path>')
  .description('Register a project with Panopticon')
  .option('--name <name>', 'Project name')
  .option('--type <type>', 'Project type (standalone/monorepo)', 'standalone')
  .option('--linear-team <team>', 'Linear team prefix (e.g., MIN, PAN)')
  .action(projectAddCommand);

project
  .command('list')
  .description('List all registered projects')
  .option('--json', 'Output as JSON')
  .action(projectListCommand);

project
  .command('show <key>')
  .description('Show details for a specific project')
  .action(projectShowCommand);

project
  .command('remove <nameOrPath>')
  .description('Remove a project from the registry')
  .action(projectRemoveCommand);

project
  .command('init')
  .description('Initialize projects.yaml with example configuration')
  .action(projectInitCommand);

// Doctor command
program
  .command('doctor')
  .description('Check system health and dependencies')
  .action(doctorCommand);

// Update command
program
  .command('update')
  .description('Update Panopticon to latest version')
  .option('--check', 'Only check for updates, don\'t install')
  .option('--force', 'Force update even if on latest')
  .action(updateCommand);

// Parse and execute
program.parse();
