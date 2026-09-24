/**
 * Claude Code transcript storage (PAN-3958 CH-7, D11): the only place that knows
 * where Claude Code keeps session transcripts,
 * `~/.claude/projects/<encoded cwd>/<session-id>.jsonl`.
 *
 * Leaf module: imports only `node:*`, so any layer can import it without
 * creating a cycle. `npm run lint:harness-storage` keeps these paths from being
 * rebuilt anywhere else.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Root of Claude Code's per-project transcript directories: `<home>/.claude/projects`.
 * `home` defaults to `os.homedir()`; callers that resolve the home themselves
 * (e.g. `process.env.HOME || homedir()`) pass it so their behavior is unchanged.
 */
export function claudeProjectsRoot(home: string = homedir()): string {
  return join(home, '.claude', 'projects');
}

/**
 * Encode a filesystem path to match Claude Code's project directory naming.
 *
 * Claude Code replaces ALL non-alphanumeric characters (except hyphens) with
 * hyphens when encoding the CWD into the project directory name under
 * ~/.claude/projects/. For example:
 *
 *   /Users/edward.becker/Projects → -Users-edward-becker-Projects
 *   /home/eltmon/Projects         → -home-eltmon-Projects
 *   /tmp/test_under.dot+plus@at   → -tmp-test-under-dot-plus-at
 *
 * This is critical for session file lookup — a mismatch means JSONL files
 * are never found and conversation messages appear permanently empty.
 */
export function encodeClaudeProjectDir(cwdPath: string): string {
  return cwdPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Directory containing Claude Code transcripts for one workspace. */
export function claudeProjectDir(
  cwd: string,
  projectsRoot = join(homedir(), '.claude', 'projects'),
): string {
  return join(projectsRoot, encodeClaudeProjectDir(cwd));
}

/**
 * Compute the deterministic JSONL session file path from cwd + session UUID.
 *
 * Claude Code stores session files at:
 *   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 */
export function sessionFilePath(cwd: string, sessionId: string): string {
  return join(claudeProjectDir(cwd), `${sessionId}.jsonl`);
}

/**
 * Single existence check every Claude resume probe must use. Mirrors the
 * JSONL resolver's `jsonl-missing` detection so stale session IDs are never
 * treated as resumable (PAN-3194).
 */
export function claudeSessionTranscriptExists(cwd: string, sessionId: string): boolean {
  return existsSync(sessionFilePath(cwd, sessionId));
}

/** Extract the session UUID from a full JSONL file path. */
export function sessionIdFromFile(sessionFile: string | null | undefined): string | undefined {
  if (!sessionFile) return undefined;
  return sessionFile.split('/').pop()?.replace('.jsonl', '') ?? undefined;
}
