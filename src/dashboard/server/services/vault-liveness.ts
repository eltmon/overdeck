/**
 * Overdeck-mode `isLive(nativePath)` for the Session Vault (PAN-4307 D-3).
 *
 * The issue named only `src/lib/agents/liveness.ts`, but that module answers
 * for agents, not conversations: `src/lib/overdeck/conversation-liveness.ts`
 * is "the one liveness door for conversations" and handles Herdr and tmux.
 * This probe checks both, by path shape, and is injected into `evict.ts`'s
 * `isLive` option so the engine itself stays standalone.
 *
 * A path under `AGENTS_DIR` is an agent's own directory (its first path
 * segment is the agent id, e.g. a Codex rollout under
 * `<agentsDir>/<agentId>/codex-home/sessions/...`); a Claude transcript is a
 * `.jsonl` file whose basename is the session's UUID. Anything else, or a
 * lookup that finds no matching row, reads as not live. A probe that throws
 * counts as live (never delete on uncertainty).
 */
import { relative, sep } from 'node:path';
import { isAlive } from '../../../lib/agents/liveness.js';
import { getConversationByClaudeSessionId } from '../../../lib/overdeck/conversations.js';
import { conversationHarnessAlive } from '../../../lib/overdeck/conversation-liveness.js';
import { AGENTS_DIR } from '../../../lib/paths.js';

const CLAUDE_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VaultLivenessDeps {
  /** Default: `getConversationByClaudeSessionId`. */
  conversationForSessionId?: (sessionId: string) => { tmuxSession: string } | null;
  /** Default: `conversationHarnessAlive`. */
  conversationHarnessAlive?: (tmuxSession: string) => Promise<boolean>;
  /** Default: `(await isAlive(agentId)).alive`. */
  agentAlive?: (agentId: string) => Promise<boolean>;
  /** Default: `AGENTS_DIR`. */
  agentsDir?: string;
}

/** The first path segment of `nativePath` under `agentsDir`, or null when it is not under it. */
function agentIdUnder(nativePath: string, agentsDir: string): string | null {
  const rel = relative(agentsDir, nativePath);
  if (rel === '' || rel.startsWith('..') || rel.startsWith(sep)) return null;
  return rel.split(sep)[0] ?? null;
}

/** The UUID session id of a Claude transcript path (`<uuid>.jsonl`), or null. */
function claudeSessionIdFrom(nativePath: string): string | null {
  const basename = nativePath.slice(nativePath.lastIndexOf(sep) + 1);
  if (!basename.endsWith('.jsonl')) return null;
  const id = basename.slice(0, -'.jsonl'.length);
  return CLAUDE_SESSION_ID_PATTERN.test(id) ? id : null;
}

/** Build an Overdeck-mode liveness probe for `evict.ts`'s `isLive` option. */
export function createVaultIsLive(deps: VaultLivenessDeps = {}): (nativePath: string) => Promise<boolean> {
  const conversationForSessionId = deps.conversationForSessionId ?? getConversationByClaudeSessionId;
  const harnessAlive = deps.conversationHarnessAlive ?? conversationHarnessAlive;
  const agentAlive = deps.agentAlive ?? (async (agentId: string) => (await isAlive(agentId)).alive);
  const agentsDir = deps.agentsDir ?? AGENTS_DIR;

  return async function vaultIsLive(nativePath: string): Promise<boolean> {
    try {
      const agentId = agentIdUnder(nativePath, agentsDir);
      if (agentId) return await agentAlive(agentId);
      const sessionId = claudeSessionIdFrom(nativePath);
      if (sessionId) {
        const row = conversationForSessionId(sessionId);
        if (row) return await harnessAlive(row.tmuxSession);
      }
      return false;
    } catch {
      return true;
    }
  };
}
