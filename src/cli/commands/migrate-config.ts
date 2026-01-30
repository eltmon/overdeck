/**
 * CLI Command: pan migrate-config
 *
 * Migrates from legacy settings.json to new config.yaml format
 * Now uses smart (capability-based) model selection - no presets
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import {
  needsMigration,
  hasLegacySettings,
  migrateConfig,
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

  // Preview mode - dry run
  if (options.preview) {
    const spinner = ora('Generating migration preview...').start();
    const preview = migrateConfig({ dryRun: true });

    if (!preview.success) {
      spinner.fail('Preview failed');
      console.error(chalk.red(`Error: ${preview.error || preview.message}`));
      return;
    }

    spinner.succeed('Migration preview generated');
    console.log('');

    console.log(chalk.bold('Migration Summary:'));
    console.log(`  Selection: ${chalk.cyan('Smart (capability-based)')}`);
    console.log(`  Overrides: ${chalk.cyan(preview.overridesCount)} work types`);
    console.log(`  Providers: ${chalk.cyan(preview.providersEnabled.join(', '))}`);
    console.log('');

    console.log(chalk.dim('Note: Legacy presets have been replaced with smart selection.'));
    console.log(chalk.dim('The system now automatically picks the best model for each task.'));
    console.log('');

    return;
  }

  // Confirm migration
  if (!options.force) {
    // Do a dry run to show what will happen
    const preview = migrateConfig({ dryRun: true });

    if (preview.success) {
      console.log(chalk.bold('Migration will:'));
      console.log(`  • Create config.yaml with ${chalk.cyan('smart (capability-based)')} selection`);
      console.log(`  • Apply ${chalk.cyan(preview.overridesCount)} work type overrides`);
      console.log(`  • Enable providers: ${chalk.cyan(preview.providersEnabled.join(', '))}`);
      if (options.backup !== false) {
        console.log('  • Back up settings.json to settings.json.backup');
      }
      if (options.deleteLegacy) {
        console.log('  • Rename settings.json to settings.json.migrated');
      }
      console.log('');
      console.log(chalk.yellow('Note: Legacy presets (Premium/Balanced/Budget) have been removed.'));
      console.log(chalk.yellow('The new system automatically selects the best model for each task.'));
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
  console.log(`  ${chalk.dim('Selection:')} ${chalk.cyan('Smart (capability-based)')}`);
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
  console.log('  2. Enable additional providers for more model options');
  console.log('  3. Add work type overrides if you prefer specific models for tasks');
  console.log('  4. Documentation: ' + chalk.cyan('docs/CONFIGURATION.md'));
  console.log('');
}
