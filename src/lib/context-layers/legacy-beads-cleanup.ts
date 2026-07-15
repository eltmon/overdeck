import { existsSync, readFileSync, writeFileSync } from 'fs';
import { backupFileSync } from '../backup.js';
import { stripBeadsManagedRegion } from './render.js';

export interface LegacyBeadsCleanup {
  file: string;
  backupPath: string;
}

/** Remove only bd's explicitly marked generated policy block from a file. */
export function cleanLegacyBeadsTargetSync(
  targetFile: string,
  backupTimestamp: string,
): LegacyBeadsCleanup | null {
  if (!existsSync(targetFile)) return null;
  const existing = readFileSync(targetFile, 'utf-8');
  const cleaned = stripBeadsManagedRegion(existing);
  if (cleaned === existing) return null;

  const backupPath = backupFileSync(targetFile, backupTimestamp);
  if (!backupPath) throw new Error(`Could not back up ${targetFile} before removing legacy Beads references`);
  writeFileSync(targetFile, cleaned.length > 0 ? `${cleaned}\n` : '', 'utf-8');
  return { file: targetFile, backupPath };
}
