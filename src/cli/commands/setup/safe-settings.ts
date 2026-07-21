/**
 * Safe read/write primitives for ~/.claude/settings.json.
 *
 * Lifted and adapted from src/lib/claude-settings-overlay.ts so the
 * `pan admin hooks install` path can no longer silently wipe user
 * customizations on parse failure (PAN-1137).
 *
 * Three guarantees:
 *   1. Parse failures ABORT — they never silently reset settings to `{}`.
 *   2. Every write is preceded by a timestamped backup, bounded to the
 *      most recent five.
 *   3. Writes are atomic: tmpfile in the same directory + rename. This
 *      sidesteps EXDEV (which a tmpdir-based rename would hit on systems
 *      where /tmp is tmpfs and $HOME is on a separate filesystem).
 */

import chalk from 'chalk';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, existsSync } from 'fs';
import { dirname, basename, join } from 'path';

// Pure write primitives moved to src/lib/claude-settings-file.ts (PAN-2595)
// so the desktop boot provisioner shares them; re-exported for existing callers.
import { findNewestBackupSync } from '../../../lib/claude-settings-file.js';
export {
  atomicWriteJsonSync,
  backupSettingsSync,
  pruneBackupsSync,
  SETTINGS_BACKUP_KEEP,
  SETTINGS_BACKUP_PREFIX,
} from '../../../lib/claude-settings-file.js';

/**
 * Read and parse a JSON settings file. On parse failure, log a clear
 * error pointing at the file and the newest backup, then exit non-zero.
 *
 * Returning `{}` from a catch block is the documented data-loss path
 * (PAN-1137): the caller then writes `{}` populated only with its own
 * keys back, erasing every other top-level field the user had.
 *
 * If the file does not exist, returns an empty object — that case is
 * legitimate (fresh install, no settings yet).
 */
export function readSettingsOrAbortSync(path: string): Record<string, any> {
  if (!existsSync(path)) return {};

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n✗ Could not read ${path}: ${message}`));
    process.exit(1);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const newestBackup = findNewestBackupSync(path);
    console.error(chalk.red(`\n✗ ${path} is not valid JSON: ${message}`));
    console.error(chalk.yellow('Refusing to overwrite — your file likely contains user customizations.'));
    if (newestBackup) {
      console.error(chalk.dim(`  Most recent backup: ${newestBackup}`));
      console.error(chalk.dim('  Restore with: cp <backup> <settings>'));
    } else {
      console.error(chalk.dim('  No backup found. Inspect or hand-edit the file before re-running.'));
    }
    process.exit(1);
  }
}





/**
 * Produce a human-readable diff of two JSON-serializable objects.
 *
 * Lists added, removed, and changed top-level keys with their nested
 * shapes pretty-printed. Used by `--dry-run` so the user can review
 * before a write.
 */
export function diffJson(before: Record<string, any>, after: Record<string, any>): string {
  const lines: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...allKeys].sort()) {
    const inBefore = key in before;
    const inAfter = key in after;
    if (!inBefore && inAfter) {
      lines.push(chalk.green(`+ ${key}: ${JSON.stringify(after[key], null, 2)}`));
    } else if (inBefore && !inAfter) {
      lines.push(chalk.red(`- ${key}: ${JSON.stringify(before[key], null, 2)}`));
    } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      lines.push(chalk.yellow(`~ ${key}:`));
      lines.push(chalk.red(`-   ${JSON.stringify(before[key], null, 2).replace(/\n/g, '\n-   ')}`));
      lines.push(chalk.green(`+   ${JSON.stringify(after[key], null, 2).replace(/\n/g, '\n+   ')}`));
    }
  }
  return lines.length > 0 ? lines.join('\n') : chalk.dim('(no changes)');
}
