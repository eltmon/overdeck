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
    if (actual.mode !== expected.mode || actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`State migration no-loss mismatch: ${expected.source} -> ${expected.destination}`);
    }
  }
}
