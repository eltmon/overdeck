import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync } from 'fs';
import { join } from 'path';
import { runTests } from '../../lib/test-runner.js';
import { findProjectByTeam, extractTeamPrefix, listProjects } from '../../lib/projects.js';

export function registerTestCommands(program: Command): void {
  const test = program.command('test').description('Test running and management');

  test
    .command('run [target]')
    .description('Run tests for a project or workspace')
    .option('--project <name>', 'Project name from registry')
    .option('--tests <names>', 'Comma-separated test names to run')
    .option('--no-notify', 'Skip desktop notification')
    .action(runCommand);

  test
    .command('list [project]')
    .description('List configured tests for a project')
    .action(listTestsCommand);
}

interface RunOptions {
  project?: string;
  tests?: string;
  notify?: boolean;
}

async function runCommand(target: string | undefined, options: RunOptions): Promise<void> {
  const spinner = ora('Loading test configuration...').start();

  try {
    // Determine project
    let projectConfig;

    if (options.project) {
      // Find by project name
      const projects = listProjects();
      const found = projects.find(p => p.key === options.project || p.config.name === options.project);
      if (!found) {
        spinner.fail(`Project not found: ${options.project}`);
        process.exit(1);
      }
      projectConfig = found.config;
    } else if (target) {
      // Try to extract team prefix from target (e.g., "min-123")
      const prefix = extractTeamPrefix(target);
      if (prefix) {
        const found = findProjectByTeam(prefix);
        if (found) {
          projectConfig = found;
        }
      }
    }

    if (!projectConfig) {
      // Try to find project from cwd
      const cwd = process.cwd();
      const projects = listProjects();
      const found = projects.find(p => cwd.startsWith(p.config.path));
      if (found) {
        projectConfig = found.config;
      } else {
        spinner.fail('Could not determine project. Use --project flag or run from a project directory.');
        process.exit(1);
      }
    }

    // Check if tests are configured
    if (!projectConfig.tests || Object.keys(projectConfig.tests).length === 0) {
      spinner.fail(`No tests configured for ${projectConfig.name}`);
      console.log('');
      console.log(chalk.dim('Configure tests in projects.yaml:'));
      console.log(chalk.dim('  projects:'));
      console.log(chalk.dim('    myproject:'));
      console.log(chalk.dim('      tests:'));
      console.log(chalk.dim('        backend:'));
      console.log(chalk.dim('          type: maven'));
      console.log(chalk.dim('          path: api'));
      console.log(chalk.dim('          command: ./mvnw test'));
      process.exit(1);
    }

    // Determine feature name from target
    let featureName: string | undefined;
    if (target && target !== 'main') {
      // Extract feature name (min-123 -> min-123, feature-min-123 -> min-123)
      featureName = target.replace(/^feature-/, '').toLowerCase();
    }

    // Parse test names
    const testNames = options.tests
      ? options.tests.split(',').map(t => t.trim())
      : undefined;

    spinner.stop();

    // Run tests
    const result = await runTests({
      projectConfig,
      featureName,
      testNames,
      notify: options.notify !== false,
    });

    // Exit with appropriate code
    process.exit(result.overallStatus === 'passed' ? 0 : 1);

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}

async function listTestsCommand(projectArg: string | undefined): Promise<void> {
  const projects = listProjects();

  if (projects.length === 0) {
    console.log(chalk.yellow('No projects registered.'));
    console.log(chalk.dim('Register a project with: pan project add <path>'));
    return;
  }

  const projectsToShow = projectArg
    ? projects.filter(p => p.key === projectArg || p.config.name === projectArg)
    : projects;

  if (projectsToShow.length === 0) {
    console.log(chalk.yellow(`Project not found: ${projectArg}`));
    return;
  }

  for (const { key, config } of projectsToShow) {
    console.log(chalk.bold(`\n${config.name || key}`));

    if (!config.tests || Object.keys(config.tests).length === 0) {
      console.log(chalk.dim('  No tests configured'));
      continue;
    }

    for (const [testName, testConfig] of Object.entries(config.tests)) {
      console.log(`  ${chalk.cyan(testName)}`);
      console.log(`    Type:    ${testConfig.type}`);
      console.log(`    Path:    ${testConfig.path}`);
      console.log(`    Command: ${chalk.dim(testConfig.command)}`);
      if (testConfig.container) {
        console.log(`    Docker:  ${chalk.green('Yes')}`);
      }
    }
  }
  console.log('');
}
