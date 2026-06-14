import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import { sessionFilePath } from '../paths.js';
import { copySessionFromCompactBoundary, sanitizeEntryForPlainFork } from './summary-fork.js';

export interface ForkSessionOptions {
  /** Path to the source JSONL to copy from. */
  sourceSessionFile: string;
  /** Working directory for the destination session (determines JSONL storage path). */
  destCwd: string;
  /**
   * Pre-allocated destination session ID. If omitted, a new randomUUID is generated.
   * Pass this when the caller has already reserved a session ID (e.g. conversation panel).
   */
  destSessionId?: string;
  /**
   * true  — copy the entire source JSONL (needed for review convoys that must share
   *         the full context cache with the parent discovery session, hazard H3).
   * false — copy only from the last compact_boundary entry (default; matches the
   *         existing conversation-panel plain-fork behaviour).
   */
  fullHistory?: boolean;
}

export interface ForkSessionResult {
  /** The destination session ID (newly generated UUID, or the provided destSessionId). */
  sessionId: string;
  /** Absolute path to the newly written destination JSONL file. */
  sessionFile: string;
}

async function copyFullSessionPromise(sourcePath: string, destPath: string): Promise<void> {
  const content = await readFile(sourcePath, 'utf-8');
  const sanitizedLines = content.split('\n').map((line) => {
    if (!line.trim()) return line;
    try {
      const entry = JSON.parse(line);
      return JSON.stringify(sanitizeEntryForPlainFork(entry));
    } catch {
      return line;
    }
  });
  await writeFile(destPath, sanitizedLines.join('\n'), 'utf-8');
}

/**
 * Fork a Claude Code session by copying its JSONL to a new session file.
 *
 * The source JSONL is NEVER modified. The new session is designed to be
 * resumed with `--resume <sessionId>` so the parent's prompt-cache is
 * inherited.
 *
 * This function handles reservation + copy only; spawning the new session
 * remains the caller's responsibility (see ensureForkSessionReady).
 */
export async function forkSession(opts: ForkSessionOptions): Promise<ForkSessionResult> {
  const { sourceSessionFile, destCwd, fullHistory = false } = opts;

  const sessionId = opts.destSessionId ?? randomUUID();
  const sessionFile = sessionFilePath(destCwd, sessionId);
  await mkdir(dirname(sessionFile), { recursive: true });

  if (fullHistory) {
    await copyFullSessionPromise(sourceSessionFile, sessionFile);
  } else {
    await Effect.runPromise(copySessionFromCompactBoundary(sourceSessionFile, sessionFile));
  }

  return { sessionId, sessionFile };
}
