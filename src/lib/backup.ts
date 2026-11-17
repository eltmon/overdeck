import { existsSync, mkdirSync, readdirSync, cpSync, rmSync, lstatSync } from 'fs';
import { join, basename } from 'path';
import { BACKUPS_DIR } from './paths.js';

export interface BackupInfo {
  timestamp: string;
  path: string;
  targets: string[];
}

/** Sync and context backups are named by createBackupTimestamp(); anything else is a named dir. */
const TIMESTAMP_DIR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3}Z)?$/;
/** A timestamp dir holding this child is a context backup (backupFile) and is never auto-pruned. */
const CONTEXT_BACKUP_CHILD = 'context';

export function createBackupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export const DEFAULT_BACKUP_KEEP = 10;

/** Resolve the configured keep number; a missing or invalid value falls back to 10. */
export function resolveBackupKeep(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : DEFAULT_BACKUP_KEEP;
}

/**
 * Create a timestamped backup of the supplied source directories. Throws on a
 * copy failure.
 */
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
    // contain symlinks back into ~/.overdeck/skills/ which causes cpSync
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

/**
 * Back up a single file into a timestamped `context/` backup dir, preserving
 * its original absolute path in the backup filename. Returns the backup file
 * path, or null when the source does not exist.
 *
 * Used to snapshot a hand-authored CLAUDE.md / AGENTS.md the first time
 * `pan sync` injects a Overdeck-managed region — a safety net for the one
 * write that touches pre-existing content. Pass a shared `timestamp` to group
 * several files from the same sync run under one backup dir.
 */
export function backupFile(file: string, timestamp = createBackupTimestamp()): string | null {
  if (!existsSync(file)) return null;
  const dir = join(BACKUPS_DIR, timestamp, 'context');
  mkdirSync(dir, { recursive: true });
  const encoded = file.replace(/^[/\\]+/, '').replace(/[/\\]/g, '__');
  const dest = join(dir, encoded);
  cpSync(file, dest);
  return dest;
}

/**
 * List sync/context backups under BACKUPS_DIR, newest first. Only directories whose
 * name matches the timestamp format `createBackupTimestamp()` produces are returned —
 * named dirs such as `dist-rollbacks/` or `pan-3783-native-context/` are never backups
 * and are skipped.
 */
export function listBackups(): BackupInfo[] {
  if (!existsSync(BACKUPS_DIR)) return [];

  const entries = readdirSync(BACKUPS_DIR, { withFileTypes: true });

  const backups: BackupInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !TIMESTAMP_DIR_RE.test(e.name)) continue;
    const backupPath = join(BACKUPS_DIR, e.name);
    let contents: string[];
    try {
      contents = readdirSync(backupPath);
    } catch (error) {
      // A concurrent prune removed it between the two reads.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    backups.push({ timestamp: e.name, path: backupPath, targets: contents });
  }
  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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

/**
 * Prune timestamp backups down to the newest `keepCount`, skipping named dirs (which
 * `listBackups` already excludes) and context backups (a `context/` child), which never
 * count toward `keepCount` and are never removed. Throws `RangeError` when `keepCount`
 * is not a non-negative integer, without deleting anything.
 */
export function cleanOldBackups(keepCount: number = 10): number {
  if (!Number.isInteger(keepCount) || keepCount < 0) {
    throw new RangeError(`keep count must be a non-negative integer, got ${keepCount}`);
  }
  const prunable = listBackups().filter((b) => !b.targets.includes(CONTEXT_BACKUP_CHILD));
  if (prunable.length <= keepCount) return 0;

  let removed = 0;
  for (const backup of prunable.slice(keepCount)) {
    rmSync(backup.path, { recursive: true, force: true });
    removed++;
  }
  return removed;
}
