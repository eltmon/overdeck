import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { HarnessTranscriptKind } from '@overdeck/contracts';

import { resolveDiscoveredSessionFile } from '../conversations/discovered-session-file.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { claudeProjectsRoot, sessionFilePath } from '../runtimes/storage/claude-code.js';
import {
  readLauncherPinnedSessionId,
  resolveCodexRolloutPath,
  resolveKimiWirePath,
  resolvePiSessionPath,
} from '../agents/transcript-resolver.js';
import type { LegacyConversation as Conversation } from './conversations.js';

const SESSION_FILE_MISS_TTL_MS = 2000;
const sessionFileByIdCache = new Map<string, { path: string | null; ts: number }>();

async function findClaudeSessionFileById(sessionId: string): Promise<string | null> {
  const cached = sessionFileByIdCache.get(sessionId);
  if (cached) {
    if (cached.path) {
      if (existsSync(cached.path)) return cached.path;
      sessionFileByIdCache.delete(sessionId);
    } else if (Date.now() - cached.ts < SESSION_FILE_MISS_TTL_MS) {
      return null;
    }
  }
  try {
    const claudeProjects = claudeProjectsRoot();
    const dirs = await readdir(claudeProjects);
    const SAFE_DIR_PATTERN = /^[a-zA-Z0-9_.-]+$/;
    const candidates = dirs
      .filter((dir) => SAFE_DIR_PATTERN.test(dir))
      .map((dir) => join(claudeProjects, dir, `${sessionId}.jsonl`));
    const STAT_BATCH_SIZE = 50;
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
      const found = checks.find((candidate): candidate is string => candidate !== null);
      if (found) {
        sessionFileByIdCache.set(sessionId, { path: found, ts: Date.now() });
        return found;
      }
    }
  } catch {
    /* ~/.claude/projects unreadable */
  }
  sessionFileByIdCache.set(sessionId, { path: null, ts: Date.now() });
  return null;
}

/** Native transcript resolvers by transcript kind (PAN-4562); null = the Claude path below. */
const FORK_SOURCE_RESOLVER: Record<HarnessTranscriptKind, ((conv: Conversation) => Promise<string | null>) | null> = {
  'claude-jsonl': null,
  'acp-jsonl': null,
  'muse-jsonl': null,
  'prime-agent-jsonl': null,
  'ohmypi-jsonl': (conv) => resolvePiSessionPath(conv.tmuxSession),
  'codex-rollout-jsonl': (conv) => resolveCodexRolloutPath(conv.tmuxSession),
  // workspaceOverride because a conversation has no AgentState row to derive it from.
  'kimi-wire-jsonl': (conv) => resolveKimiWirePath(conv.tmuxSession, { workspaceOverride: conv.cwd }),
};

export async function resolveForkSourceSessionFile(conv: Conversation): Promise<string | null> {
  const resolveNative = FORK_SOURCE_RESOLVER[getHarnessBehavior(conv.harness).transcriptKind];
  if (resolveNative) {
    // A miss falls through to the Claude path (stale harness recovery).
    const nativePath = await resolveNative(conv);
    if (nativePath) return nativePath;
  }
  const pinned = await readLauncherPinnedSessionId(conv.tmuxSession);
  const sessionId = pinned ?? conv.claudeSessionId;
  if (sessionId) {
    const deterministic = sessionFilePath(conv.cwd, sessionId);
    if (existsSync(deterministic)) return deterministic;
    const found = await findClaudeSessionFileById(sessionId);
    if (found) return found;
    const discovered = await resolveDiscoveredSessionFile(conv.claudeSessionId);
    return discovered ?? deterministic;
  }
  const discovered = await resolveDiscoveredSessionFile(conv.claudeSessionId);
  if (discovered) return discovered;
  console.error(
    `[fork-pipeline] UNRESOLVED claude-code session for conversation '${conv.name}' ` +
      `(tmux=${conv.tmuxSession}, status=${conv.status}, cwd=${conv.cwd}): no --session-id ` +
      `pinned in launcher.sh and no recorded claudeSessionId. The fork source transcript cannot be trusted.`,
  );
  return null;
}

export function resolvePlainForkTargetSessionFile(conv: Conversation): string | null {
  if (!conv.claudeSessionId) return null;
  return sessionFilePath(conv.cwd, conv.claudeSessionId);
}
