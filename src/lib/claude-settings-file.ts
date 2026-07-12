/**
 * Pure file primitives for safe ~/.claude/settings.json writes — the
 * dependency-light core of src/cli/commands/setup/safe-settings.ts, moved to
 * lib so the desktop boot provisioner (PAN-2595) can share them without
 * importing CLI modules. The PAN-1137 guarantees hold here:
 *
 *   1. Every write is preceded by a timestamped backup, bounded to the most
 *      recent five.
 *   2. Writes are atomic: tmpfile in the same directory + rename (sidesteps
 *      EXDEV when /tmp is on a different filesystem than $HOME).
 *
 * Guarantee 3 (parse failures abort, never reset to `{}`) is caller policy:
 * the CLI's readSettingsOrAbortSync exits the process; the boot provisioner
 * skips provisioning instead. Both refuse to write over an unparseable file.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

export const SETTINGS_BACKUP_PREFIX = 'settings.json.pan-backup-';
export const SETTINGS_BACKUP_KEEP = 5;

/**
 * Copy the file to `<path>.pan-backup-<iso>` adjacent to the original.
 * Returns the backup path, or null if the file did not exist.
 *
 * Backups go alongside the file (not in tmpdir) so users can find them
 * easily and so we don't pay EXDEV on the copy.
 */
export function backupSettingsSync(path: string): string | null {
  if (!existsSync(path)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${path}.pan-backup-${timestamp}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

/**
 * Keep the most recent `SETTINGS_BACKUP_KEEP` backups for the given
 * settings file, delete the rest. Backups are sorted lexically — the
 * ISO-8601 timestamp in the suffix makes that equivalent to chronological.
 *
 * Silent on per-file delete failure; the next prune cycle will retry.
 */
export function pruneBackupsSync(settingsPath: string, keep: number = SETTINGS_BACKUP_KEEP): void {
  const dir = dirname(settingsPath);
  const prefix = `${basename(settingsPath)}.pan-backup-`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const backups = entries.filter((e) => e.startsWith(prefix)).sort().reverse();
  for (const stale of backups.slice(keep)) {
    try {
      unlinkSync(join(dir, stale));
    } catch {
      // best-effort
    }
  }
}

export function findNewestBackupSync(settingsPath: string): string | undefined {
  const dir = dirname(settingsPath);
  const prefix = `${basename(settingsPath)}.pan-backup-`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  const backups = entries.filter((e) => e.startsWith(prefix)).sort().reverse();
  return backups.length > 0 ? join(dir, backups[0]!) : undefined;
}

/**
 * Atomic JSON write: serialize, write to a tmpfile in the same directory,
 * rename onto the target. Crash or out-of-disk between the open and the
 * rename leaves the original file intact.
 *
 * tmpfile lives in the same directory (not tmpdir) so the rename is a
 * single-filesystem op — POSIX guarantees that's atomic.
 */
export function atomicWriteJsonSync(path: string, value: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, path);
}
