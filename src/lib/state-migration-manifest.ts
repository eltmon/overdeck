import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';

export interface StateMigrationManifestEntry {
  source: string;
  destination: string;
  mode: number;
  size: number;
  sha256: string;
}

async function sha256(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function manifestEntry(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<StateMigrationManifestEntry> {
  signal?.throwIfAborted();
  const [stat, digest] = await Promise.all([
    lstat(source),
    sha256(source, signal),
  ]);
  signal?.throwIfAborted();
  return {
    source,
    destination,
    mode: stat.mode & 0o777,
    size: stat.size,
    sha256: digest,
  };
}

export async function verifyStateMigrationManifest(
  entries: readonly StateMigrationManifestEntry[],
): Promise<void> {
  for (const expected of entries) {
    const actual = await manifestEntry(expected.destination, expected.destination);
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
