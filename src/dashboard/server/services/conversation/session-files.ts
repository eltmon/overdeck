import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeClaudeProjectDir } from '../../../../lib/paths.js';

/**
 * Encode a filesystem path to the Claude Code project directory name.
 * Delegates to the shared encodeClaudeProjectDir() which matches
 * Claude Code's actual encoding (all non-alphanumeric chars → hyphens).
 */
function encodeCwdToProjectDir(cwd: string): string {
  return encodeClaudeProjectDir(cwd);
}

/** Returns ~/.claude/projects/<encoded-cwd>/ */
function claudeProjectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeCwdToProjectDir(cwd));
}

/**
 * Snapshot existing JSONL files, then poll for a NEW file that wasn't there before.
 *
 * The old approach checked mtime >= spawnTime, which matched any active session
 * (including the user's own Claude Code conversation). This approach is exact:
 * only a file that didn't exist before the spawn can be the new session.
 *
 * Call snapshotSessionFiles() BEFORE spawning, then pass the result to
 * discoverSessionFile() AFTER spawning.
 */
export async function snapshotSessionFiles(cwd: string): Promise<Set<string>> {
  const projectDir = claudeProjectDir(cwd);
  try {
    const entries = await readdir(projectDir);
    return new Set(entries.filter(e => e.endsWith('.jsonl')));
  } catch {
    return new Set();
  }
}

/**
 * Wait for a new JSONL session file that wasn't in the pre-spawn snapshot.
 *
 * Polls every 500ms for up to 60 seconds. Returns the absolute path when found.
 * Resolves with null if no new file appears within the timeout.
 */
export async function discoverSessionFile(
  cwd: string,
  existingFiles: Set<string>,
  timeoutMs = 60_000,
): Promise<string | null> {
  const projectDir = claudeProjectDir(cwd);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const entries = await readdir(projectDir);
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        if (!existingFiles.has(entry)) {
          return join(projectDir, entry);
        }
      }
    } catch {
      // Project directory doesn't exist yet — Claude hasn't started
    }

    await new Promise<void>((r) => setTimeout(r, 500));
  }

  return null;
}
