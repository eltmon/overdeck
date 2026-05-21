import { existsSync, mkdirSync, readdirSync, cpSync, rmSync, lstatSync } from 'fs';
import { join, basename } from 'path';
import { Effect } from 'effect';
import { BACKUPS_DIR } from './paths.js';
import { FsError, FsNotFoundError } from './errors.js';

export interface BackupInfo {
  timestamp: string;
  path: string;
  targets: string[];
}

export function createBackupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function createBackup(sourceDirs: string[]): BackupInfo {
  const timestamp = createBackupTimestamp();
  const backupPath = join(BACKUPS_DIR, timestamp);

  mkdirSync(backupPath, { recursive: true });

  const targets: string[] = [];

  for (const sourceDir of sourceDirs) {
    if (!existsSync(sourceDir)) continue;

    const targetName = basename(sourceDir);
    const targetPath = join(backupPath, targetName);

    // Use filter to skip symlinks — sync targets (e.g. ~/.claude/skills/)
    // contain symlinks back into ~/.panopticon/skills/ which causes cpSync
    // to fail with "cannot copy to a subdirectory of self".
    cpSync(sourceDir, targetPath, {
      recursive: true,
      filter: (src) => !lstatSync(src).isSymbolicLink(),
    });
    targets.push(targetName);
  }

  return {
    timestamp,
    path: backupPath,
    targets,
  };
}

export function listBackups(): BackupInfo[] {
  if (!existsSync(BACKUPS_DIR)) return [];

  const entries = readdirSync(BACKUPS_DIR, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const backupPath = join(BACKUPS_DIR, e.name);
      const contents = readdirSync(backupPath);

      return {
        timestamp: e.name,
        path: backupPath,
        targets: contents,
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function restoreBackup(timestamp: string, targetDirs: Record<string, string>): void {
  const backupPath = join(BACKUPS_DIR, timestamp);

  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${timestamp}`);
  }

  const contents = readdirSync(backupPath, { withFileTypes: true });

  for (const entry of contents) {
    if (!entry.isDirectory()) continue;

    const sourcePath = join(backupPath, entry.name);
    const targetPath = targetDirs[entry.name];

    if (!targetPath) continue;

    // Remove existing and restore from backup
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true });
    }

    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

export function cleanOldBackups(keepCount: number = 10): number {
  const backups = listBackups();

  if (backups.length <= keepCount) return 0;

  const toRemove = backups.slice(keepCount);
  let removed = 0;

  for (const backup of toRemove) {
    rmSync(backup.path, { recursive: true });
    removed++;
  }

  return removed;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Create a timestamped backup of the supplied source directories.
 * Effect-native. Fails with FsError on copy failure.
 */
export const createBackupEffect = (
  sourceDirs: readonly string[],
): Effect.Effect<BackupInfo, FsError> =>
  Effect.try({
    try: () => createBackup([...sourceDirs]),
    catch: (cause) =>
      new FsError({ path: BACKUPS_DIR, operation: 'createBackup', cause }),
  });

/**
 * Enumerate existing backups, sorted newest-first.
 * Effect-native. Fails with FsError if the backups directory cannot be read.
 */
export const listBackupsEffect = (): Effect.Effect<readonly BackupInfo[], FsError> =>
  Effect.try({
    try: () => listBackups(),
    catch: (cause) =>
      new FsError({ path: BACKUPS_DIR, operation: 'listBackups', cause }),
  });

/**
 * Restore a named backup, replacing each target directory. Fails with
 * FsNotFoundError if the backup does not exist, FsError otherwise.
 */
export const restoreBackupEffect = (
  timestamp: string,
  targetDirs: Record<string, string>,
): Effect.Effect<void, FsError | FsNotFoundError> =>
  Effect.gen(function* () {
    const backupPath = join(BACKUPS_DIR, timestamp);
    if (!existsSync(backupPath)) {
      return yield* Effect.fail(new FsNotFoundError({ path: backupPath }));
    }
    return yield* Effect.try({
      try: () => restoreBackup(timestamp, targetDirs),
      catch: (cause) =>
        new FsError({ path: backupPath, operation: 'restoreBackup', cause }),
    });
  });

/**
 * Trim the backups directory to the most recent `keepCount` entries.
 * Returns the number of backups removed. Fails with FsError on removal error.
 */
export const cleanOldBackupsEffect = (
  keepCount: number = 10,
): Effect.Effect<number, FsError> =>
  Effect.try({
    try: () => cleanOldBackups(keepCount),
    catch: (cause) =>
      new FsError({ path: BACKUPS_DIR, operation: 'cleanOldBackups', cause }),
  });
