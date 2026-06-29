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

import { readFile, readdir, stat, open } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import {
  createConversation,
  getConversationByClaudeSessionId,
  getConversationByName,
  listActiveConversations,
  markConversationEnded,
  markConversationRunning,
  setClearedToConvId,
  type LegacyConversation as Conversation,
} from '../../../lib/overdeck/conversations.js';
import { listSessionNames, isHarnessProcessAlive, listPaneValues } from '../../../lib/tmux.js';
import { isRespawnPending } from './pending-respawn.js';
import { encodeClaudeProjectDir, sessionFilePath, getOverdeckHome } from '../../../lib/paths.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import type { HarnessName } from '../../../lib/runtimes/types.js';
import { cleanupUnreferencedConversationAttachments, runInBatches } from './conversation-attachments.js';

const POLL_INTERVAL_MS = 10_000;
// New conversations that have not yet had time to start their tmux session should
// not be marked ended — the session is still spawning in the background.
const SPAWN_GRACE_PERIOD_MS = 30_000;

// Roles whose live `agent-*` tmux session must own a conversation row so the
// dashboard can map the session to its JSONL transcript. `work` is included
// (PAN-1972): a `pan start`-spawned work agent does NOT pass
// `registerConversation` (only the flywheel does), so without backfill it has
// no row and the work tab renders "No conversation data available for this
// session." review/test/ship get rows at spawn; this is the self-healing net.
const BACKFILL_ROLES = new Set(['work', 'review', 'test', 'ship']);

// Tmux session prefixes that are NOT specialist agents and must be left alone
// by the backfill pass even if they happen to be missing a row.
const NON_AGENT_PREFIXES = ['conv-', 'inspect-', 'planning-'];

function behaviorForHarness(harness: string | null | undefined) {
  return getHarnessBehavior(harness as HarnessName | null | undefined);
}

/**
 * PAN-2099: read the last `maxBytes` of a file without loading the whole thing.
 * output.log can grow to many MB; this keeps the corpse-diagnostic path bounded
 * on the server poll loop.
 */
async function tailFile(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * PAN-2099: gather death evidence for a keep-alive corpse — the pane's exit
 * status (`#{pane_dead_status}`) and the tail of the agent's output.log. Returns
 * a "; "-prefixed suffix for the log line, or "" when nothing is available.
 * Every probe is independently guarded so a diagnostics failure never throws.
 */
async function captureCorpseDiagnostics(tmuxSession: string): Promise<string> {
  const parts: string[] = [];
  try {
    const values = await Effect.runPromise(listPaneValues(tmuxSession, '#{pane_dead_status}'));
    const status = values.find((v) => v.trim() !== '')?.trim();
    if (status) parts.push(`exitStatus=${status}`);
  } catch { /* tmux best-effort */ }
  try {
    const logPath = join(getOverdeckHome(), 'agents', tmuxSession, 'output.log');
    if (existsSync(logPath)) {
      const lines = (await tailFile(logPath, 1500)).trim().split('\n').slice(-8).join('\n');
      if (lines) parts.push(`output.log tail:\n${lines}`);
    }
  } catch { /* best-effort */ }
  return parts.length ? `; ${parts.join('; ')}` : '';
}

interface AgentStateFile {
  id?: string;
  issueId?: string;
  workspace?: string;
  role?: string;
  model?: string;
  harness?: 'claude-code' | 'pi' | 'codex';
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

    const aliveSessions = new Set(await Effect.runPromise(listSessionNames()));

    const endedConversations: typeof conversations = [];
    const now = Date.now();
    for (const conv of conversations) {
      const ageMs = now - new Date(conv.createdAt).getTime();
      // Grace protects a just-spawned conversation: its pane may still be the
      // launcher shell before the harness process takes the foreground.
      if (ageMs < SPAWN_GRACE_PERIOD_MS) continue;
      const sessionGone = !aliveSessions.has(conv.tmuxSession);
      // Session exists but the harness process has exited — only the launcher
      // keep-alive loop (`while true; do sleep 60; done`) is left. tmux still
      // reports the session, so the gone-check misses it. Mark ended so the
      // dashboard stops showing a dead conversation as active and resume
      // respawns it. PAN-1638.
      const harnessGone = !sessionGone && !(await isHarnessProcessAlive(conv.tmuxSession));
      if (!sessionGone && !harnessGone) {
        // PAN-1972: the poller used to be one-directional — it only ever marked
        // conversations 'ended'. A transient blip (a dashboard restart that
        // recreated the tmux session, or a momentary harness-process gap during a
        // resume) would latch a still-live conversation to 'ended' forever, so the
        // UI showed a gray dot + "Resume Session" on a conversation in active use.
        // tmux is the liveness oracle: a conversation whose session AND harness are
        // both alive must read 'active'. Resurrect it. Idempotent when already active.
        if (conv.status === 'ended') {
          console.log(`[conversation-lifecycle] Session ${conv.tmuxSession} alive but row marked ended — resurrecting to active`);
          markConversationRunning(conv.name);
        }
        continue;
      }
      // Re-validate at mark time, not poll-start time. A resume can land
      // between the snapshot above and here (kill → spawn → ready), making the
      // verdict stale: marking then flips a just-revived conversation to
      // "ended" while its harness is alive, and the next send fails (conv 2596
      // incident, 2026-06-09). Skip when a respawn is in flight or the row
      // shows a spawn/attach signal within the grace window.
      if (isRespawnPending(conv.tmuxSession)) continue;
      const fresh = getConversationByName(conv.name) ?? conv;
      const lastAliveSignalMs = Math.max(
        new Date(fresh.createdAt).getTime() || 0,
        fresh.lastAttachedAt ? new Date(fresh.lastAttachedAt).getTime() || 0 : 0,
      );
      if (Date.now() - lastAliveSignalMs < SPAWN_GRACE_PERIOD_MS) continue;
      if (sessionGone) {
        console.log(`[conversation-lifecycle] Session ${conv.tmuxSession} gone — marking ended`);
      } else {
        // PAN-2099: a keep-alive corpse means the harness process crashed/exited
        // while tmux kept the (now dead) pane. Capture the death evidence — pane
        // exit status + output.log tail — instead of the old reasonless line, so
        // an ENOSPC/uncaught-exception death is diagnosable from this log alone.
        const diag = await captureCorpseDiagnostics(conv.tmuxSession);
        console.log(`[conversation-lifecycle] Session ${conv.tmuxSession} alive but harness exited (keep-alive corpse) — marking ended${diag}`);
      }
      markConversationEnded(conv.name);
      endedConversations.push(conv);
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

    // PAN-1458: detect Claude Code /clear orphans and link them to their parent.
    // Reuses the conversations list already fetched above — do not re-query.
    await detectOrphanedClaudeCodeSessions(conversations);
  } catch (err: unknown) {
    // Don't crash the server on poll errors
    console.error('[conversation-lifecycle] Poll error:', err);
  }
}

/**
 * For each live tmux session that looks like a specialist agent and has no
 * `conversations` row, create one from `~/.overdeck/agents/<id>/state.json`.
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

    const statePath = join(homedir(), '.overdeck', 'agents', sessionName, 'state.json');
    if (!existsSync(statePath)) continue;

    let state: AgentStateFile;
    try {
      state = JSON.parse(await readFile(statePath, 'utf-8')) as AgentStateFile;
    } catch (err) {
      console.warn(`[conversation-lifecycle] Skipping ${sessionName}: state.json unreadable: ${(err as Error).message}`);
      continue;
    }

    if (!state.role || !BACKFILL_ROLES.has(state.role)) continue;
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
 * PAN-1458: Detect Claude Code `/clear` orphans and link them to their parent.
 *
 * When Claude Code receives `/clear`, the current JSONL stops being written and a
 * new JSONL is created with a fresh session-id under the same project dir. The
 * tmux session keeps running, so the parent `conversations` row is still active
 * and pointing at the pre-clear `claude_session_id`. The new JSONL has no
 * conversation row — it becomes an orphan that the dashboard cannot navigate to.
 *
 * Detection signal: any user-message in the first ~5 lines of a JSONL with
 * `content: '<command-name>/clear</command-name>...'`. That's the literal token
 * Claude Code writes when `/clear` kicks off a new session — unambiguous, no
 * mtime guesswork.
 *
 * For each orphan found, attribute it to the parent conversation whose
 * `claudeSessionId` JSONL has the most-recent mtime in the same `cwd` strictly
 * before the orphan's first-message timestamp. If no Overdeck conversation
 * owns that `cwd` (e.g., a standalone `claude` invocation outside Overdeck),
 * skip — we only adopt orphans that descend from one of our conversations.
 *
 * Insert a sibling `conversations` row inheriting parent's `cwd`, `tmuxSession`,
 * `issueId`, `model`, `harness`. Set an auto-derived title with
 * `titleSource = 'auto'` so the existing AI title generator overwrites once the
 * post-clear JSONL has enough content. Finally, write
 * `parent.cleared_to_conv_id = sibling.id`.
 */
async function detectOrphanedClaudeCodeSessions(activeConvs: Conversation[]): Promise<void> {
  // Group by cwd so we readdir each project dir at most once per tick.
  // Non-Claude conversations don't use ~/.claude/projects.
  // Legacy rows with a null harness predate the harness column and were all claude-code.
  const cwdGroups = new Map<string, Conversation[]>();
  for (const conv of activeConvs) {
    if (!conv.cwd) continue;
    if (!conv.claudeSessionId) continue;
    if (behaviorForHarness(conv.harness).transcriptKind !== 'claude-jsonl') continue;
    const list = cwdGroups.get(conv.cwd) ?? [];
    list.push(conv);
    cwdGroups.set(conv.cwd, list);
  }

  for (const [cwd, convs] of cwdGroups) {
    const projectDir = join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(cwd));
    let entries: string[];
    try {
      entries = await readdir(projectDir);
    } catch (err: any) {
      if (err?.code === 'ENOENT') continue;
      console.warn(`[conversation-lifecycle] readdir(${projectDir}) failed: ${(err as Error).message}`);
      continue;
    }

    for (const filename of entries) {
      if (!filename.endsWith('.jsonl')) continue;
      const sessionId = filename.slice(0, -'.jsonl'.length);

      // Already linked to a conversation (either as a primary session or via a previous
      // orphan-detect pass that adopted it).
      if (getConversationByClaudeSessionId(sessionId)) continue;

      const jsonlPath = join(projectDir, filename);
      const firstClearTs = await readFirstClearTimestamp(jsonlPath);
      if (firstClearTs === null) continue; // not a /clear orphan

      // Parent attribution: among active convs in this cwd, pick the one whose
      // own JSONL's mtime is the highest value strictly less than firstClearTs.
      // Walks a chain naturally — if A→B→C all share this cwd, a new orphan D
      // attaches to C (whichever has the freshest mtime under D's start).
      let parent: Conversation | null = null;
      let parentMtime = -Infinity;
      for (const candidate of convs) {
        if (!candidate.claudeSessionId) continue;
        if (candidate.claudeSessionId === sessionId) continue;
        const parentJsonl = join(projectDir, `${candidate.claudeSessionId}.jsonl`);
        let mtimeMs: number;
        try {
          mtimeMs = (await stat(parentJsonl)).mtimeMs;
        } catch {
          continue; // parent's JSONL gone — can't use it as anchor
        }
        if (mtimeMs < firstClearTs && mtimeMs > parentMtime) {
          parent = candidate;
          parentMtime = mtimeMs;
        }
      }

      if (!parent) {
        // No Overdeck conversation owns the cwd-window before this orphan started.
        // It's a standalone `claude` invocation — leave it alone.
        continue;
      }

      const baseTitle = parent.title ?? 'Conversation';
      const autoTitle = `[post-/clear] ${baseTitle}`;
      let sibling: Conversation;
      try {
        sibling = createConversation({
          name: `${parent.name}-post-clear-${sessionId.slice(0, 8)}`,
          tmuxSession: parent.tmuxSession,
          cwd: parent.cwd,
          issueId: parent.issueId ?? undefined,
          claudeSessionId: sessionId,
          title: autoTitle,
          titleSource: 'auto',
          titleSeed: autoTitle,
          model: parent.model ?? undefined,
          effort: parent.effort ?? undefined,
          harness: 'claude-code',
        });
      } catch (err) {
        console.warn(`[conversation-lifecycle] Failed to create post-/clear sibling for ${sessionId}: ${(err as Error).message}`);
        continue;
      }

      try {
        setClearedToConvId(parent.name, sibling.id);
      } catch (err) {
        console.warn(`[conversation-lifecycle] Failed to link conv/${parent.id} → conv/${sibling.id}: ${(err as Error).message}`);
      }

      // The /clear command IS the user closing this thread. Mark the parent ended
      // so the chat panel stops waiting for an assistant response on a JSONL that
      // will never receive one (the response went to the sibling's JSONL). The
      // sibling stays 'active' and is the live thread going forward.
      try {
        markConversationEnded(parent.name);
      } catch (err) {
        console.warn(`[conversation-lifecycle] Failed to mark parent ${parent.name} ended: ${(err as Error).message}`);
      }

      console.log(`[conversation-lifecycle] Adopted post-/clear orphan ${sessionId} → conv/${sibling.id} (parent: conv/${parent.id} "${parent.name}")`);
    }
  }
}

/**
 * Read the first ~5 lines of a JSONL and return the timestamp (ms since epoch) of
 * the first user-message whose content contains the literal `/clear` command
 * sentinel that Claude Code writes when the user clears the session. Returns
 * `null` if no such message is found in the early lines — i.e., this is not a
 * post-`/clear` orphan.
 *
 * Uses a streaming line reader bounded at 5 lines so a multi-megabyte snapshot
 * line at the head of the file doesn't load the whole transcript into memory.
 */
async function readFirstClearTimestamp(jsonlPath: string): Promise<number | null> {
  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineCount = 0;
  try {
    for await (const line of rl) {
      lineCount++;
      if (lineCount > 5) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (obj?.type !== 'user') continue;
      const content = obj?.message?.content;
      if (typeof content !== 'string') continue;
      if (!content.includes('<command-name>/clear</command-name>')) continue;
      const ts = obj?.timestamp;
      if (typeof ts !== 'string') continue;
      const ms = new Date(ts).getTime();
      if (Number.isNaN(ms)) continue;
      return ms;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return null;
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
  console.log('[overdeck] ConversationLifecycleService started (10s poll)');
  scheduleNext();
}

export function stopConversationLifecycleService(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('[overdeck] ConversationLifecycleService stopped');
  }
}
