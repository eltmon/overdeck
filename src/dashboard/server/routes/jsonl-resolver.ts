/**
 * JSONL transcript resolver for the Command Deck (PAN-830).
 *
 * Maps an agent ID (e.g. `agent-pan-830`, `planning-pan-830`, or a canonical
 * specialist tmux session name) to the Claude Code JSONL transcript file on
 * disk. The JSONL filename is the *Claude session ID* (a UUID written by
 * Claude Code itself), NOT the agent/tmux name — this is the bug that
 * pan-nk6b fixes.
 *
 * Lookup order matches getLatestSessionId in lib/agents.ts:
 *   1. session.id     — single UUID written by auto-suspend
 *   2. sessions.json  — array of UUIDs, last entry is most recent (heartbeat hook)
 *   3. runtime state  — in-process mirror, populated by hooks
 *
 * Async-only (fs/promises) because this code path runs inside the dashboard
 * server's event loop.
 */
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getAgentRuntimeStateAsync } from '../../../lib/agents.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';

export interface ResolveJsonlPathOptions {
  /** Override the ~/.panopticon/agents directory (test hook). */
  agentsDirOverride?: string;
  /** Override the ~/.claude/projects directory (test hook). */
  claudeProjectsDirOverride?: string;
  /** Override the runtime-state lookup (test hook). */
  getRuntimeStateAsync?: (agentId: string) => Promise<{ claudeSessionId?: string } | null>;
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

async function readOptional(p: string): Promise<string | null> {
  return readFile(p, 'utf-8').catch(() => null);
}

/** Async equivalent of getLatestSessionId from lib/agents.ts. */
export async function resolveClaudeSessionId(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(homedir(), '.panopticon', 'agents');
  const agentDir = join(agentsRoot, agentId);

  // 1. session.id — single UUID written by auto-suspend
  const sessionIdRaw = await readOptional(join(agentDir, 'session.id'));
  const sessionIdTrimmed = sessionIdRaw?.trim();
  if (sessionIdTrimmed) return sessionIdTrimmed;

  // 2. sessions.json — array, last entry is most recent (heartbeat hook)
  const sessionsRaw = await readOptional(join(agentDir, 'sessions.json'));
  if (sessionsRaw) {
    try {
      const parsed: unknown = JSON.parse(sessionsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const last = parsed[parsed.length - 1];
        if (typeof last === 'string' && last.trim()) return last.trim();
      }
    } catch { /* non-fatal */ }
  }

  // 3. runtime state claudeSessionId (in-process mirror)
  try {
    const lookup = opts.getRuntimeStateAsync ?? getAgentRuntimeStateAsync;
    const runtimeState = await lookup(agentId);
    if (runtimeState?.claudeSessionId) return runtimeState.claudeSessionId;
  } catch { /* non-fatal */ }

  return null;
}

/**
 * Resolve the Claude Code JSONL transcript for an agent.
 *
 * Returns the absolute path if both the claudeSessionId is known AND the
 * corresponding JSONL file exists; otherwise null.
 */
export async function resolveJsonlPath(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const claudeSessionId = await resolveClaudeSessionId(agentId, opts);
  if (!claudeSessionId) return null;

  const projectsRoot = opts.claudeProjectsDirOverride ?? join(homedir(), '.claude', 'projects');
  const encodedDir = encodeClaudeProjectDir(workspacePath);
  const jsonlPath = join(projectsRoot, encodedDir, `${claudeSessionId}.jsonl`);
  if (await pathExists(jsonlPath)) return jsonlPath;
  return null;
}
