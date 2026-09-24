/**
 * Path → index-key helpers for conversation-search transcripts. Zero imports
 * beyond node:path so the embeddings DB module can use them without a cycle.
 */
import { basename } from 'node:path';

const CLAUDE_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<file>.jsonl` → `<file>`; the index's session_id for any transcript. */
export function sessionIdFromPath(filePath: string): string {
  return basename(filePath).replace(/\.jsonl$/, '');
}

/** The `~/.claude/projects/<dir>` segment, or 'unknown'. */
export function projectIdFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]+/);
  const projectsIndex = parts.lastIndexOf('projects');
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) return parts[projectsIndex + 1]!;
  return 'unknown';
}

/**
 * The parent session UUID for a Claude subagent transcript
 * `<projects>/<enc>/<parent-uuid>/subagents/agent-<id>.jsonl`, else null (PAN-3982).
 */
export function parentSessionIdFromPath(filePath: string): string | null {
  const parts = filePath.split(/[\\/]+/);
  const file = parts[parts.length - 1] ?? '';
  const dir = parts[parts.length - 2];
  const parent = parts[parts.length - 3];
  if (dir !== 'subagents' || !/^agent-.+\.jsonl$/.test(file) || !parent || !CLAUDE_SESSION_UUID.test(parent)) return null;
  return parent;
}
