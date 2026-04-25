/**
 * CLI Command: pan copy-config
 *
 * Copies configuration from the installed Panopticon (~/.panopticon/)
 * into the current workspace and optionally into global user settings.
 */

import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { getPanopticonHome } from '../../lib/paths.js';

interface CopyConfigOptions {
  toGlobal?: boolean;
  force?: boolean;
  backup?: boolean;
}

export async function copyConfigCommand(options: CopyConfigOptions = {}): Promise<void> {
  console.log('');
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('           COPY CONFIGURATION'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log('');

  const sourceDir = getPanopticonHome();
  const workspaceDir = process.cwd();
  const workspaceConfigDir = join(workspaceDir, '.panopticon');

  // Check if we're in a workspace
  const gitDir = join(workspaceDir, '.git');
  if (!existsSync(gitDir)) {
    console.log(chalk.red('✗ Not in a git repository/workspace'));
    console.log(chalk.dim('  Run this command from within a workspace directory'));
    console.log('');
    process.exit(1);
  }

  // Verify source config exists
  const sourceConfigYaml = join(sourceDir, 'config.yaml');
  const sourceProjectsYaml = join(sourceDir, 'projects.yaml');

  if (!existsSync(sourceConfigYaml)) {
    console.log(chalk.yellow('⚠ No config.yaml found in ~/.panopticon/'));
    console.log(chalk.dim('  Initialize Panopticon first with: pan init'));
    console.log('');
    process.exit(1);
  }

  // Create workspace config directory if it doesn't exist
  if (!existsSync(workspaceConfigDir)) {
    mkdirSync(workspaceConfigDir, { recursive: true });
  }

  const spinner = ora('Copying configuration files...').start();

  try {
    // Prepare backup if requested
    const backupDir = join(sourceDir, 'backups', `config-backup-${Date.now()}`);
    if (options.backup && (options.toGlobal || existsSync(join(workspaceConfigDir, 'config.yaml')))) {
      mkdirSync(backupDir, { recursive: true });
    }

    let copiedFiles: string[] = [];

    // Copy config.yaml to workspace .panopticon/
    const workspaceConfigFile = join(workspaceConfigDir, 'config.yaml');
    if (existsSync(sourceConfigYaml)) {
      const configContent = readFileSync(sourceConfigYaml, 'utf-8');

      // Backup existing workspace config if needed
      if (options.backup && existsSync(workspaceConfigFile)) {
        copyFileSync(workspaceConfigFile, join(backupDir, 'workspace-config.yaml.backup'));
      }

      writeFileSync(workspaceConfigFile, configContent);
      copiedFiles.push('.panopticon/config.yaml');

      // Backup source if making global
      if (options.toGlobal && options.backup) {
        copyFileSync(sourceConfigYaml, join(backupDir, 'config.yaml.backup'));
      }
    }

    // Copy projects.yaml if it exists
    const workspaceProjectsFile = join(workspaceConfigDir, 'projects.yaml');
    if (existsSync(sourceProjectsYaml)) {
      const projectsContent = readFileSync(sourceProjectsYaml, 'utf-8');

      // Backup existing workspace projects if needed
      if (options.backup && existsSync(workspaceProjectsFile)) {
        copyFileSync(workspaceProjectsFile, join(backupDir, 'workspace-projects.yaml.backup'));
      }

      writeFileSync(workspaceProjectsFile, projectsContent);
      copiedFiles.push('.panopticon/projects.yaml');

      if (options.toGlobal && options.backup) {
        copyFileSync(sourceProjectsYaml, join(backupDir, 'projects.yaml.backup'));
      }
    }

    // Also create .pan.yaml in workspace root for project-specific settings
    const workspacePanYaml = join(workspaceDir, '.pan.yaml');
    if (existsSync(sourceConfigYaml)) {
      const configContent = readFileSync(sourceConfigYaml, 'utf-8');

      // Backup existing .pan.yaml if needed
      if (options.backup && existsSync(workspacePanYaml)) {
        copyFileSync(workspacePanYaml, join(backupDir, '.pan.yaml.backup'));
      }

      writeFileSync(workspacePanYaml, configContent);
      copiedFiles.push('.pan.yaml (project-specific)');
    }

    // Promote workspace config to global if requested
    if (options.toGlobal) {
      // Copy workspace .panopticon/config.yaml to global ~/.panopticon/config.yaml
      if (existsSync(workspaceConfigFile)) {
        const workspaceConfig = readFileSync(workspaceConfigFile, 'utf-8');
        writeFileSync(sourceConfigYaml, workspaceConfig);
      }

      // Copy workspace .panopticon/projects.yaml to global ~/.panopticon/projects.yaml
      if (existsSync(workspaceProjectsFile)) {
        const workspaceProjects = readFileSync(workspaceProjectsFile, 'utf-8');
        writeFileSync(sourceProjectsYaml, workspaceProjects);
      }
    }

    spinner.succeed('Configuration copied successfully');
    console.log('');

    console.log(chalk.bold('Summary:'));
    console.log(`  ${chalk.dim('Source:')} ${chalk.cyan(sourceDir)}`);
    if (options.toGlobal) {
      console.log(`  ${chalk.dim('Mode:')} ${chalk.cyan('Copy to workspace + promote to global')}`);
    } else {
      console.log(`  ${chalk.dim('Mode:')} ${chalk.cyan('Copy to workspace only')}`);
    }
    console.log('');

    console.log(chalk.bold('Files copied:'));
    for (const file of copiedFiles) {
      console.log(`  ${chalk.green('✓')} ${file}`);
    }
    console.log('');

    if (options.backup && options.toGlobal && backupDir) {
      console.log(chalk.dim(`Backup created at: ${backupDir}`));
      console.log('');
    }

  } catch (error) {
    spinner.fail('Configuration copy failed');
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }

  console.log(chalk.bold('Next steps:'));
  if (options.toGlobal) {
    console.log('  1. Workspace configuration has been promoted to global settings');
  } else {
    console.log('  1. Configuration is now available in this workspace');
    console.log(`  2. Use ${chalk.cyan('--to-global')} to promote to user settings`);
  }
  console.log('');
}
