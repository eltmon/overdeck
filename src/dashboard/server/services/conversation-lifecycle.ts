/**
 * Conversation Lifecycle Polling Service (PAN-416)
 *
 * Runs every 10 seconds to check whether active tmux sessions still exist.
 * Marks conversations as 'ended' in SQLite when their tmux session is gone.
 * This drives the status dot update in the ConversationList UI.
 *
 * Also runs a backfill pass each tick: any specialist tmux session
 * (work/review/test/ship/plan agent) that lacks a `conversations` row gets
 * one created from its `state.json`. Without this, agents spawned before
 * the substrate fix (or during a partial-state crash/restart) render in the
 * UI as "Starting…" forever because `sessionAlive` has nothing to flow
 * through. The backfill makes the row population self-healing instead of
 * spawn-only.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  createConversation,
  getConversationByName,
  listActiveConversations,
  markConversationEnded,
} from '../../../lib/database/conversations-db.js';
import { listSessionNamesAsync } from '../../../lib/tmux.js';
import { encodeClaudeProjectDir, sessionFilePath } from '../../../lib/paths.js';
import { cleanupUnreferencedConversationAttachments, runInBatches } from './conversation-attachments.js';

const POLL_INTERVAL_MS = 10_000;
// New conversations that have not yet had time to start their tmux session should
// not be marked ended — the session is still spawning in the background.
const SPAWN_GRACE_PERIOD_MS = 30_000;

// Specialist roles that always get a conversation row at spawn (post-fix).
// Used to decide whether a missing-row tmux session is a backfill candidate.
const SPECIALIST_ROLES = new Set(['review', 'test', 'ship']);

// Tmux session prefixes that are NOT specialist agents and must be left alone
// by the backfill pass even if they happen to be missing a row.
const NON_AGENT_PREFIXES = ['conv-', 'inspect-', 'planning-'];

interface AgentStateFile {
  id?: string;
  issueId?: string;
  workspace?: string;
  role?: string;
  model?: string;
  harness?: 'claude-code' | 'pi';
  startedAt?: string;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Poll all active conversations and mark as ended any whose tmux session is gone.
 * Uses a single `tmux list-sessions` call instead of N individual `sessionExists`
 * subprocesses to avoid the N+1 spawn problem.
 */
export async function pollConversations(): Promise<void> {
  try {
    const conversations = listActiveConversations();
    if (conversations.length === 0) return;

    const aliveSessions = new Set(await listSessionNamesAsync());

    const endedConversations: typeof conversations = [];
    const now = Date.now();
    for (const conv of conversations) {
      if (!aliveSessions.has(conv.tmuxSession)) {
        const ageMs = now - new Date(conv.createdAt).getTime();
        if (ageMs < SPAWN_GRACE_PERIOD_MS) continue;
        console.log(`[conversation-lifecycle] Session ${conv.tmuxSession} gone — marking ended`);
        markConversationEnded(conv.name);
        endedConversations.push(conv);
      }
    }
    // Batch attachment cleanup to avoid an unbounded fan-out when many
    // conversations end simultaneously (e.g., after server restart).
    await runInBatches(endedConversations, 5, async (conv) => {
      const sessionFile = conv.claudeSessionId ? sessionFilePath(conv.cwd, conv.claudeSessionId) : null;
      await cleanupUnreferencedConversationAttachments({ name: conv.name, sessionFile }).catch((err: unknown) => {
        console.error(`[conversation-lifecycle] Cleanup failed for ${conv.name}:`, err);
      });
    });

    // Self-healing backfill: create rows for live specialist agents that are
    // missing them. Runs every poll so it converges over time even if any
    // single attempt fails partially.
    await backfillOrphanedSpecialistConversations(Array.from(aliveSessions));
  } catch (err: unknown) {
    // Don't crash the server on poll errors
    console.error('[conversation-lifecycle] Poll error:', err);
  }
}

/**
 * For each live tmux session that looks like a specialist agent and has no
 * `conversations` row, create one from `~/.panopticon/agents/<id>/state.json`.
 * Best-effort JSONL lookup via `~/.claude/projects/<encoded-cwd>/*.jsonl`. If
 * the JSONL can't be located, the row is still written without
 * `claudeSessionId` — UI liveness (sessionAlive via tmux poll) still works;
 * only message-history rendering is degraded.
 */
async function backfillOrphanedSpecialistConversations(aliveSessions: string[]): Promise<void> {
  for (const sessionName of aliveSessions) {
    if (!sessionName.startsWith('agent-')) continue;
    if (NON_AGENT_PREFIXES.some(p => sessionName.startsWith(p))) continue;
    if (getConversationByName(sessionName)) continue;

    const statePath = join(homedir(), '.panopticon', 'agents', sessionName, 'state.json');
    if (!existsSync(statePath)) continue;

    let state: AgentStateFile;
    try {
      state = JSON.parse(await readFile(statePath, 'utf-8')) as AgentStateFile;
    } catch (err) {
      console.warn(`[conversation-lifecycle] Skipping ${sessionName}: state.json unreadable: ${(err as Error).message}`);
      continue;
    }

    if (!state.role || !SPECIALIST_ROLES.has(state.role)) continue;
    if (!state.workspace) continue;

    let claudeSessionId: string | undefined;
    try {
      claudeSessionId = await findClaudeSessionUuid(state.workspace, state.startedAt);
    } catch (err) {
      console.warn(`[conversation-lifecycle] JSONL lookup failed for ${sessionName}: ${(err as Error).message}`);
    }

    try {
      createConversation({
        name: sessionName,
        tmuxSession: sessionName,
        cwd: state.workspace,
        issueId: state.issueId,
        claudeSessionId,
        model: state.model,
        harness: state.harness,
      });
      console.log(`[conversation-lifecycle] Backfilled row for ${sessionName} (role=${state.role}, claudeSessionId=${claudeSessionId ?? 'none'})`);
    } catch (err) {
      console.warn(`[conversation-lifecycle] createConversation failed for ${sessionName}: ${(err as Error).message}`);
    }
  }
}

/**
 * Find the Claude Code JSONL session UUID for a workspace by scanning
 * `~/.claude/projects/<encoded-cwd>/*.jsonl` and picking the file whose mtime
 * is closest to the agent's `startedAt`. Returns undefined when the project
 * directory does not exist or contains no candidates.
 *
 * Matching by start time rather than just "most recent" avoids stealing the
 * UUID from a different session that happens to live in the same workspace
 * (e.g., a planning session and a review session both rooted at the same
 * worktree).
 */
async function findClaudeSessionUuid(workspaceCwd: string, startedAt?: string): Promise<string | undefined> {
  const projectDir = join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(workspaceCwd));
  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined;
    throw err;
  }

  const candidates = entries.filter(name => name.endsWith('.jsonl'));
  if (candidates.length === 0) return undefined;

  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;

  // Compute |mtime - startedAt| for each candidate; pick the smallest gap.
  // When startedAt is missing/invalid, fall back to picking the most recent
  // mtime — it's the best signal we have for "this agent's JSONL".
  let best: { uuid: string; score: number } | null = null;
  for (const filename of candidates) {
    try {
      const st = await stat(join(projectDir, filename));
      const score = Number.isFinite(startedMs)
        ? Math.abs(st.mtimeMs - startedMs)
        : -st.mtimeMs; // smaller is better → negate so newest wins
      if (best === null || score < best.score) {
        best = { uuid: filename.replace(/\.jsonl$/, ''), score };
      }
    } catch {
      // Skip unreadable entries — continue scanning.
    }
  }

  return best?.uuid;
}

function scheduleNext(): void {
  pollTimer = setTimeout(async () => {
    await pollConversations();
    scheduleNext();
  }, POLL_INTERVAL_MS);
}

export function startConversationLifecycleService(): void {
  console.log('[panopticon] ConversationLifecycleService started (10s poll)');
  scheduleNext();
}

export function stopConversationLifecycleService(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('[panopticon] ConversationLifecycleService stopped');
  }
}
