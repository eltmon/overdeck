/**
 * CLI Command: pan migrate-config
 *
 * Migrates from legacy settings.json to new config.yaml format
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import {
  needsMigration,
  hasLegacySettings,
  migrateConfig,
  previewMigration,
  type MigrationOptions,
} from '../../lib/config-migration.js';

interface MigrateConfigOptions {
  force?: boolean;
  preview?: boolean;
  backup?: boolean;
  deleteLegacy?: boolean;
}

export async function migrateConfigCommand(options: MigrateConfigOptions = {}): Promise<void> {
  console.log('');
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('           CONFIGURATION MIGRATION'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log('');

  // Check if legacy settings exist
  if (!hasLegacySettings()) {
    console.log(chalk.yellow('✓ No legacy settings.json found'));
    console.log(chalk.dim('  You are already using the new config.yaml format.'));
    console.log('');
    return;
  }

  // Check if migration is needed
  if (!needsMigration() && !options.force) {
    console.log(chalk.green('✓ Already migrated to config.yaml'));
    console.log(chalk.dim('  Use --force to regenerate config.yaml from settings.json'));
    console.log('');
    return;
  }

  // Preview mode
  if (options.preview) {
    const spinner = ora('Generating migration preview...').start();
    const preview = previewMigration();

    if (!preview) {
      spinner.fail('No settings.json found to preview');
      return;
    }

    spinner.succeed('Migration preview generated');
    console.log('');

    console.log(chalk.bold('Migration Summary:'));
    console.log(`  Preset: ${chalk.cyan(preview.result.preset)}`);
    console.log(`  Overrides: ${chalk.cyan(preview.result.overridesCount)} work types`);
    console.log(`  Providers: ${chalk.cyan(preview.result.providersEnabled.join(', '))}`);
    console.log('');

    console.log(chalk.bold('New config.yaml content:'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log(preview.yaml);
    console.log(chalk.dim('─'.repeat(60)));
    console.log('');

    return;
  }

  // Confirm migration
  if (!options.force) {
    const preview = previewMigration();
    if (preview) {
      console.log(chalk.bold('Migration will:'));
      console.log(`  • Create config.yaml with ${chalk.cyan(preview.result.preset)} preset`);
      console.log(`  • Apply ${chalk.cyan(preview.result.overridesCount)} work type overrides`);
      console.log(`  • Enable providers: ${chalk.cyan(preview.result.providersEnabled.join(', '))}`);
      if (options.backup !== false) {
        console.log('  • Back up settings.json to settings.json.backup');
      }
      if (options.deleteLegacy) {
        console.log('  • Rename settings.json to settings.json.migrated');
      }
      console.log('');
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Proceed with migration?',
        default: true,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Migration cancelled'));
      return;
    }
  }

  // Perform migration
  const spinner = ora('Migrating configuration...').start();

  const migrationOptions: MigrationOptions = {
    backup: options.backup !== false, // Default to true
    deleteLegacy: options.deleteLegacy || false,
  };

  const result = migrateConfig(migrationOptions);

  if (!result.success) {
    spinner.fail('Migration failed');
    console.error(chalk.red(`Error: ${result.error || result.message}`));
    process.exit(1);
  }

  spinner.succeed('Migration complete!');
  console.log('');

  // Show results
  console.log(chalk.bold.green('✓ Configuration migrated successfully'));
  console.log('');
  console.log(chalk.bold('Details:'));
  console.log(`  ${chalk.dim('Preset:')} ${chalk.cyan(result.preset)}`);
  console.log(`  ${chalk.dim('Work type overrides:')} ${chalk.cyan(result.overridesCount)}`);
  console.log(`  ${chalk.dim('Enabled providers:')} ${chalk.cyan(result.providersEnabled.join(', '))}`);
  console.log('');

  if (migrationOptions.backup) {
    console.log(chalk.dim('  Legacy settings.json backed up to settings.json.backup'));
  }
  if (migrationOptions.deleteLegacy) {
    console.log(chalk.dim('  Legacy settings.json renamed to settings.json.migrated'));
  }
  console.log('');

  console.log(chalk.bold('Next steps:'));
  console.log('  1. Review your new config: ' + chalk.cyan('~/.panopticon/config.yaml'));
  console.log('  2. Documentation: ' + chalk.cyan('docs/CONFIGURATION.md'));
  console.log('  3. Start using Panopticon with the new config');
  console.log('');
}
