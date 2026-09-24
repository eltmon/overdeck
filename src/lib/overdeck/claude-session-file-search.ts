/**
 * By-id search for Claude Code transcripts under ~/.claude/projects/.
 *
 * Claude keys session files by the cwd AT RUNTIME, so when a repo directory is
 * renamed (e.g. Projects/panopticon-cli → Projects/overdeck) a conversation's
 * recorded cwd goes stale and the deterministic sessionFilePath(cwd, id)
 * points at a dir that no longer exists, while the JSONL itself lives under
 * the new encoded dir. A by-id search recovers it. It also resolves palette
 * hits on indexed Claude sessions that have no conversation row (PAN-3982).
 */
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { claudeProjectsRoot } from '../runtimes/storage/claude-code.js';

const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_DIR_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const STAT_BATCH_SIZE = 50;

// PAN-2220: memoize by-id lookups. The sweeps below stat <sessionId>.jsonl in
// EVERY project dir (~2,200 on this machine), and the conversation-list
// enrichment resolves session files per row per request — for each stale-cwd
// conversation that meant a full sweep on every list build (~1.7s of
// event-loop-adjacent syscall storm). A found path is stable (re-verified
// with one existsSync); a miss is re-swept after a short TTL so a transcript
// that appears later is still discovered.
const sessionFileByIdCache = new Map<string, { path: string | null; ts: number }>();
const SESSION_FILE_MISS_TTL_MS = 60_000;

function cachedLookup(id: string): string | null | undefined {
  const cached = sessionFileByIdCache.get(id);
  if (!cached) return undefined;
  if (cached.path) {
    if (existsSync(cached.path)) return cached.path;
    sessionFileByIdCache.delete(id);
    return undefined;
  }
  if (Date.now() - cached.ts < SESSION_FILE_MISS_TTL_MS) return null;
  return undefined;
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (let i = 0; i < candidates.length; i += STAT_BATCH_SIZE) {
    const batch = candidates.slice(i, i + STAT_BATCH_SIZE);
    const checks = await Promise.all(
      batch.map(async (candidate) => {
        try {
          await stat(candidate);
          return candidate;
        } catch {
          return null;
        }
      }),
    );
    const found = checks.find((c): c is string => c !== null);
    if (found) return found;
  }
  return null;
}

/** Find a main-session JSONL `<project-dir>/<session-id>.jsonl` by session id. */
export async function findClaudeSessionFileById(sessionId: string): Promise<string | null> {
  if (!SAFE_SESSION_ID_PATTERN.test(sessionId)) return null;
  const cached = cachedLookup(sessionId);
  if (cached !== undefined) return cached;
  try {
    const claudeProjects = claudeProjectsRoot();
    const dirs = await readdir(claudeProjects);
    const candidates = dirs
      .filter((dir) => SAFE_DIR_PATTERN.test(dir))
      .map((dir) => join(claudeProjects, dir, `${sessionId}.jsonl`));
    const found = await firstExisting(candidates);
    if (found) {
      sessionFileByIdCache.set(sessionId, { path: found, ts: Date.now() });
      return found;
    }
  } catch {
    /* ~/.claude/projects unreadable */
  }
  sessionFileByIdCache.set(sessionId, { path: null, ts: Date.now() });
  return null;
}
