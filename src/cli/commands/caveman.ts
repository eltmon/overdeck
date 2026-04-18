/**
 * Caveman CLI Commands
 *
 * pan caveman-compress <file>  — compress static reference docs using the
 * caveman-compress Python script. Manual use only, never automated.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Path where pan admin hooks install places caveman-compress Python scripts */
function getCavemanCompressDir(): string {
  return join(homedir(), '.panopticon', 'hooks', 'caveman-compress');
}

async function cavemanCompressCommand(file: string): Promise<void> {
  const resolvedFile = resolve(file);

  if (!existsSync(resolvedFile)) {
    console.error(chalk.red(`✗ File not found: ${resolvedFile}`));
    process.exit(1);
  }

  // Check python3
  try {
    await execAsync('python3 --version', { encoding: 'utf-8' });
  } catch {
    console.error(chalk.red('✗ python3 not found'));
    console.error(chalk.dim('  Install python3 to use caveman-compress.'));
    process.exit(1);
  }

  const compressDir = getCavemanCompressDir();
  if (!existsSync(compressDir)) {
    console.error(chalk.red(`✗ caveman-compress scripts not installed at ${compressDir}`));
    console.error(chalk.dim('\nTo install, run:'));
    console.error(chalk.dim('  pan admin hooks install'));
    console.error(chalk.dim('\nOr download manually from:'));
    console.error(chalk.dim('  https://github.com/JuliusBrussee/caveman/tree/main/caveman-compress'));
    console.error(chalk.dim(`  → place at ${compressDir}/`));
    process.exit(1);
  }

  console.log(chalk.bold(`Compressing: ${resolvedFile}\n`));
  console.log(chalk.dim('This may take a minute — caveman-compress calls the Claude API.\n'));

  try {
    const { stdout, stderr } = await execAsync(
      `python3 __main__.py "${resolvedFile}"`,
      {
        cwd: compressDir,
        encoding: 'utf-8',
        timeout: 300000, // 5 minute timeout
      }
    );

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    console.log(chalk.green('\n✓ Compression complete'));
  } catch (err: unknown) {
    console.error(chalk.red('\n✗ Compression failed:'));
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    process.exit(1);
  }
}

export function registerCavemanCommands(program: Command): void {
  program
    .command('caveman-compress')
    .description(
      'Compress a static reference doc using caveman-compress (manual use only, never automated). ' +
      'Calls the Claude API recursively to compress prose by ~65-75% while preserving technical accuracy.'
    )
    .argument('<file>', 'Path to the file to compress')
    .action(cavemanCompressCommand);
}
