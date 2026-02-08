import { existsSync, mkdirSync, readdirSync, cpSync, rmSync, lstatSync } from 'fs';
import { join, basename } from 'path';
import { BACKUPS_DIR } from './paths.js';

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
