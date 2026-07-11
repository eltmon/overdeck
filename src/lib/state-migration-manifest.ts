import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

export interface StateMigrationManifestEntry {
  source: string;
  destination: string;
  mode: number;
  size: number;
  sha256: string;
}

export function manifestEntry(source: string, destination: string): StateMigrationManifestEntry {
  const stat = lstatSync(source);
  const bytes = readFileSync(source);
  return {
    source,
    destination,
    mode: stat.mode & 0o777,
    size: stat.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function verifyStateMigrationManifest(entries: readonly StateMigrationManifestEntry[]): void {
  for (const expected of entries) {
    const actual = manifestEntry(expected.destination, expected.destination);
    // Compare modes the way git preserves them: only the executable bit is
    // tracked, so a checkout legitimately re-derives group/other bits from the
    // process umask (e.g. 0644 source vs 0664 worktree checkout). Content is
    // guaranteed by size + sha256.
    const executableMismatch = (actual.mode & 0o100) !== (expected.mode & 0o100);
    if (executableMismatch || actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`State migration no-loss mismatch: ${expected.source} -> ${expected.destination}`);
    }
  }
}
