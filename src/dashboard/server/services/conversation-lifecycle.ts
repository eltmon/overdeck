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
import {
  createConversation,
  getConversationByClaudeSessionId,
  getConversationByName,
  listConversations,
  markConversationEnded,
  markConversationRunning,
  setClearedToConvId,
  type LegacyConversation as Conversation,
} from '../../../lib/overdeck/conversations.js';
import { closeCompanionTerminalForOwner } from '../../../lib/overdeck/companion-terminal/index.js';
import {
  getRuntimeCensus,
  refreshRuntimeCensus,
  runtimeCensusHasHarnessProcess,
  type RuntimeCensus,
} from '../../../lib/runtime-census.js';
import { isRespawnPending } from './pending-respawn.js';
import { isHarnessProcessAlive } from '../../../lib/tmux.js';
import { hostTerminalBackendName } from '../../../lib/terminal-backends/select.js';
import { listHerdrAgents } from '../../../lib/terminal-backends/herdr.js';
import { conversationHarnessAlive } from '../../../lib/overdeck/conversation-liveness.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js';
import { claudeProjectDir, sessionFilePath } from '../../../lib/runtimes/storage/claude-code.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import type { HarnessName } from '../../../lib/runtimes/types.js';
import { cleanupUnreferencedConversationAttachments, runInBatches } from './conversation-attachments.js';

const POLL_INTERVAL_MS = 10_000;
// New conversations that have not yet had time to start their tmux session should
// not be marked ended — the session is still spawning in the background.
const SPAWN_GRACE_PERIOD_MS = 30_000;
/** AGENT_DETECT_TIMEOUT_MS (60s, terminal-backends/herdr.ts) + SPAWN_GRACE_PERIOD_MS (PAN-3921). */
const HERDR_SPAWN_GRACE_PERIOD_MS = 90_000;

// Roles whose live `agent-*` tmux session must own a conversation row so the
// dashboard can map the session to its JSONL transcript. `work` is included
// (PAN-1972): a `pan start`-spawned work agent does NOT pass
// `registerConversation` (only the flywheel does), so without backfill it has
// no row and the work tab renders "No conversation data available for this
// session." Knowledge agents follow the same live-session path. review/test/ship
// get rows at spawn; this is the self-healing net.
const BACKFILL_ROLES = new Set(['work', 'review', 'test', 'ship', 'knowledge']);

// Tmux session prefixes that are NOT specialist agents and must be left alone
// by the backfill pass even if they happen to be missing a row.
const NON_AGENT_PREFIXES = ['conv-', 'inspect-', 'planning-'];

// PAN-2215: per-boot memo of JSONL transcripts definitively proven NOT to be
// /clear orphans. Bounded by the number of transcript files on disk (a few
// thousand paths), and correct forever: the /clear sentinel is written in a
// transcript's first lines at creation, so a definitive negative never flips.
const notOrphanJsonlPaths = new Set<string>();

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
async function captureCorpseDiagnostics(tmuxSession: string, census: RuntimeCensus): Promise<string> {
  const parts: string[] = [];
  const status = (census.panesBySession.get(tmuxSession) ?? [])
    .map((pane) => pane.paneDeadStatus)
    .find((value) => value !== null);
  if (status !== undefined) parts.push(`exitStatus=${status}`);
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
 * One tick's liveness verdicts (PAN-3921 FR-8). On tmux it is the runtime
 * census, plus Herdr's inventory when its socket answers: after a flip back to
 * tmux, a conversation launched on Herdr still runs there and must not be
 * ended while its harness lives (rollback safety). On Herdr it is Herdr's agent inventory, with the
 * tmux census consulted only for a conversation Herdr does not hold — one
 * launched before the host moved to Herdr still runs in its tmux session.
 */
interface ConversationLivenessView {
  readonly sampledAt: number;
  readonly census: RuntimeCensus;
  readonly graceMs: number;
  /** The session/pane is gone entirely. */
  sessionGone(tmuxSession: string): boolean;
  /** The session/pane is there but its harness has exited. */
  harnessGone(tmuxSession: string): Promise<boolean>;
  /** Fresh probe used before resurrecting an ended row. */
  harnessAlive(tmuxSession: string): Promise<boolean>;
}

interface HerdrConversationInventory {
  readonly alive: ReadonlySet<string>;
  readonly exited: ReadonlySet<string>;
}

/** Herdr's live and exited agents by name, or null when the socket did not answer. */
async function readHerdrConversationInventory(): Promise<HerdrConversationInventory | null> {
  try {
    const agents = await listHerdrAgents();
    return {
      alive: new Set(agents.filter((agent) => agent.state !== 'exited').map((agent) => agent.agentId)),
      exited: new Set(agents.filter((agent) => agent.state === 'exited').map((agent) => agent.agentId)),
    };
  } catch {
    return null;
  }
}

function tmuxView(census: RuntimeCensus, herdr: HerdrConversationInventory | null): ConversationLivenessView {
  const onHerdr = (name: string) => herdr?.alive.has(name) ?? false;
  return {
    sampledAt: census.sampledAt,
    census,
    graceMs: SPAWN_GRACE_PERIOD_MS,
    sessionGone: (name) => !census.sessionNames.has(name) && !onHerdr(name),
    harnessGone: async (name) => !onHerdr(name) && census.sessionNames.has(name)
      && !(await runtimeCensusHasHarnessProcess(census, name)),
    harnessAlive: async (name) => (await isHarnessProcessAlive(name)) || onHerdr(name),
  };
}

/** tmux's own answer when no server runs on the socket (as opposed to a probe that failed). */
const NO_TMUX_SERVER = /no server running|error connecting to/i;

/**
 * Whether the census can answer for legacy tmux sessions. No tmux server at
 * all is the normal state of a Herdr host and means "no legacy session"; any
 * other census failure (a `list-panes` timeout under load) means "unknown".
 */
function legacyCensusKnown(census: RuntimeCensus): boolean {
  return census.available || NO_TMUX_SERVER.test(census.error ?? '');
}

function herdrView(inventory: HerdrConversationInventory, census: RuntimeCensus, sampledAt: number): ConversationLivenessView {
  const legacySession = (name: string) => census.available && census.sessionNames.has(name);
  // A name Herdr does not list, while the census could not answer, is unknown:
  // never gone (review of #4104, F1 — a failed census once ended every legacy conversation).
  const unknown = (name: string) => !inventory.alive.has(name) && !inventory.exited.has(name) && !legacyCensusKnown(census);
  return {
    sampledAt,
    census,
    graceMs: HERDR_SPAWN_GRACE_PERIOD_MS,
    sessionGone: (name) => !unknown(name) && !inventory.alive.has(name) && !inventory.exited.has(name) && !legacySession(name),
    harnessGone: async (name) => {
      if (inventory.alive.has(name)) return false;
      if (inventory.exited.has(name)) return true;
      if (unknown(name)) return false;
      return legacySession(name) && !(await runtimeCensusHasHarnessProcess(census, name));
    },
    harnessAlive: (name) => conversationHarnessAlive(name),
  };
}

/** The tick's liveness view, or null when the backend could not be read (mark nothing). */
async function readLivenessView(fresh: boolean): Promise<ConversationLivenessView | null> {
  const census = fresh ? await refreshRuntimeCensus() : await getRuntimeCensus();
  if ((await hostTerminalBackendName()) !== 'herdr') {
    return census.available ? tmuxView(census, await readHerdrConversationInventory()) : null;
  }
  const sampledAt = Date.now();
  const inventory = await readHerdrConversationInventory();
  return inventory ? herdrView(inventory, census, sampledAt) : null;
}

/**
 * Whether an ended row whose session and harness looked alive in `census`
 * should be resurrected. The census is up to RUNTIME_CENSUS_TTL_MS old, and
 * the supervisor's exit event now ends a row within milliseconds, so the
 * snapshot can predate an exit just recorded (PAN-3962). Never resurrects:
 * - a /clear-ended parent — its session belongs to the post-/clear sibling;
 * - a row ended after the snapshot was taken;
 * - a row whose harness a fresh probe finds gone, or that another writer
 *   changed while the probe ran.
 */
async function shouldResurrect(conv: Conversation, view: ConversationLivenessView): Promise<boolean> {
  if (conv.clearedToConvId != null) return false;
  const fresh = getConversationByName(conv.name) ?? conv;
  if (fresh.status !== 'ended' || fresh.clearedToConvId != null) return false;
  const endedAtMs = fresh.endedAt ? Date.parse(fresh.endedAt) : Number.NaN;
  if (endedAtMs >= view.sampledAt) return false;
  if (!(await view.harnessAlive(conv.tmuxSession))) return false;
  const after = getConversationByName(conv.name) ?? fresh;
  return after.status === 'ended' && after.endedAt === fresh.endedAt;
}

/**
 * Poll all active conversations and mark as ended any whose tmux session is gone.
 * Uses a single `tmux list-sessions` call instead of N individual `sessionExists`
 * subprocesses to avoid the N+1 spawn problem.
 */
export async function pollConversations(): Promise<void> {
  try {
    // Deliberately fetch ALL non-archived rows, not just active ones: the
    // resurrect check below (PAN-1972) must see 'ended' rows whose tmux session
    // and harness are still alive so it can flip them back to active. Ended
    // rows whose session is genuinely gone are skipped in O(1) further down
    // (PAN-2215) — they must never be re-marked, re-cleaned, or re-scanned.
    const conversations = listConversations();
    if (conversations.length === 0) return;

    const view = await readLivenessView(false);
    // A backend that did not answer must never end every conversation at once.
    if (!view) return;
    let revalidationView: ConversationLivenessView | null | undefined;

    const endedConversations: typeof conversations = [];
    let sessionGoneCount = 0;
    let keepAliveCorpseCount = 0;
    const keepAliveCorpseDiagnostics: string[] = [];
    const now = Date.now();
    for (const conv of conversations) {
      const ageMs = now - new Date(conv.createdAt).getTime();
      // Grace protects a just-spawned conversation: its pane may still be the
      // launcher shell before the harness process takes the foreground.
      if (ageMs < view.graceMs) continue;
      let sessionGone = view.sessionGone(conv.tmuxSession);
      // Session exists but the harness process has exited — only the launcher
      // keep-alive loop (`while true; do sleep 60; done`) is left. tmux still
      // reports the session, so the gone-check misses it. Mark ended so the
      // dashboard stops showing a dead conversation as active and resume
      // respawns it. PAN-1638.
      let harnessGone = !sessionGone && await view.harnessGone(conv.tmuxSession);
      if (!sessionGone && !harnessGone) {
        // PAN-1972: the poller used to be one-directional — it only ever marked
        // conversations 'ended'. A transient blip (a dashboard restart that
        // recreated the tmux session, or a momentary harness-process gap during a
        // resume) would latch a still-live conversation to 'ended' forever, so the
        // UI showed a gray dot + "Resume Session" on a conversation in active use.
        // tmux is the liveness oracle: a conversation whose session AND harness are
        // both alive must read 'active'. Resurrect it. Idempotent when already active.
        if (conv.status === 'ended' && await shouldResurrect(conv, view)) {
          console.log(`[conversation-lifecycle] Session ${conv.tmuxSession} alive but row marked ended — resurrecting to active`);
          markConversationRunning(conv.name);
        }
        continue;
      }
      // PAN-2215: an ended row whose session is gone is already in its terminal
      // state — nothing to mark and nothing to clean up. Without this skip the
      // patrol re-marked and re-cleaned every dead conversation on every tick,
      // pegging the event loop and spamming the log.
      if (conv.status === 'ended') continue;
      // Re-validate at mark time, not poll-start time. A resume can land
      // between the snapshot above and here (kill → spawn → ready), making the
      // verdict stale: marking then flips a just-revived conversation to
      // "ended" while its harness is alive, and the next send fails (conv 2596
      // incident, 2026-06-09). Skip when a respawn is in flight, a fork/handoff
      // pipeline is still authoring or spawning, or the row shows a spawn/attach
      // signal within the grace window.
      if (isRespawnPending(conv.tmuxSession)) continue;
      const fresh = getConversationByName(conv.name) ?? conv;
      // PAN-3860: `pan handoff` creates the conversation row (status=active,
      // forkStatus='handoff') before authoring the handoff doc, which for a
      // >1M-char transcript takes well over SPAWN_GRACE_PERIOD_MS to finish —
      // the tmux session doesn't exist yet because the spawn step hasn't run.
      // forkStatus is the DB-persisted spawn-pending signal for the whole
      // author+spawn window (cleared to null on success; runForkPipeline's
      // catch already marks 'failed' rows ended, so exclude only 'failed' here
      // — a stranded-but-alive fork must remain eligible to be swept once its
      // session actually dies).
      if (fresh.forkStatus && fresh.forkStatus !== 'failed') continue;
      const lastAliveSignalMs = Math.max(
        new Date(fresh.createdAt).getTime() || 0,
        fresh.lastAttachedAt ? new Date(fresh.lastAttachedAt).getTime() || 0 : 0,
      );
      if (Date.now() - lastAliveSignalMs < view.graceMs) continue;

      if (revalidationView === undefined) revalidationView = await readLivenessView(true);
      if (!revalidationView) continue;
      sessionGone = revalidationView.sessionGone(conv.tmuxSession);
      harnessGone = !sessionGone && await revalidationView.harnessGone(conv.tmuxSession);
      if (!sessionGone && !harnessGone) continue;

      if (process.env.DEBUG?.includes('conversation-lifecycle')) {
        console.log(
          sessionGone
            ? `[conversation-lifecycle] Session ${conv.tmuxSession} gone — marking ended`
            : `[conversation-lifecycle] Session ${conv.tmuxSession} alive but harness exited (keep-alive corpse) — marking ended`,
        );
      }
      if (!sessionGone) {
        // PAN-2099: a keep-alive corpse means the harness process crashed/exited
        // while tmux kept the (now dead) pane. Capture the death evidence — pane
        // exit status + output.log tail — instead of the old reasonless line, so
        // an ENOSPC/uncaught-exception death is diagnosable from this log alone.
        const diag = await captureCorpseDiagnostics(conv.tmuxSession, revalidationView.census);
        if (diag) keepAliveCorpseDiagnostics.push(`${conv.tmuxSession}${diag}`);
      }
      // The supervisor's exit event may have ended the row (and run its
      // cleanup) while this tick awaited the census; do not end it twice.
      if (getConversationByName(conv.name)?.status === 'ended') continue;
      // PAN-3974: close the companion terminal before the row is marked ended.
      // Later ticks skip ended rows, so a close deferred past this point could be
      // lost for good. Best-effort: a failed close never blocks the mark.
      await closeCompanionTerminalForOwner(conv.tmuxSession).catch(() => undefined);
      markConversationEnded(conv.name);
      endedConversations.push(conv);
      if (sessionGone) sessionGoneCount++;
      else keepAliveCorpseCount++;
    }

    if (endedConversations.length > 0) {
      const diagnosticsSuffix = keepAliveCorpseDiagnostics.length
        ? `; keep-alive corpse diagnostics: ${keepAliveCorpseDiagnostics.join(' | ')}`
        : '';
      console.log(
        `[conversation-lifecycle] marked ${endedConversations.length} conversation(s) ended (${sessionGoneCount} session(s) gone, ${keepAliveCorpseCount} keep-alive corpses)${diagnosticsSuffix}`,
      );
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
    await backfillOrphanedSpecialistConversations(view.census.available ? Array.from(view.census.sessionNames) : []);

    // PAN-1458: detect Claude Code /clear orphans and link them to their parent.
    // Reuses the conversations list already fetched above — do not re-query.
    // Active rows only (PAN-2215): ended conversations must not widen the cwd
    // scan set, and parent attribution is defined over active convs.
    await detectOrphanedClaudeCodeSessions(conversations.filter((c) => c.status === 'active'));
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
    const projectDir = claudeProjectDir(cwd);
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
      const jsonlPath = join(projectDir, filename);

      // PAN-2215: a transcript already proven not to be a /clear orphan can
      // never become one (the sentinel lives in the first 5 lines, written at
      // session creation). Skip before the DB lookup and the file open so
      // historical transcripts cost one scan per boot, not one per 10s tick.
      if (notOrphanJsonlPaths.has(jsonlPath)) continue;

      // Already linked to a conversation (either as a primary session or via a previous
      // orphan-detect pass that adopted it).
      if (getConversationByClaudeSessionId(sessionId)) continue;

      const { clearTs: firstClearTs, definitive } = await readFirstClearTimestamp(jsonlPath);
      if (firstClearTs === null) {
        if (definitive) notOrphanJsonlPaths.add(jsonlPath);
        continue; // not a /clear orphan
      }

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
 *
 * `definitive` is true when a null verdict can never change: the full 5-line
 * window was scanned (proven by seeing a 6th line). A shorter file may still
 * be growing, so its null verdict is provisional and must not be cached.
 */
async function readFirstClearTimestamp(
  jsonlPath: string,
): Promise<{ clearTs: number | null; definitive: boolean }> {
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
      return { clearTs: ms, definitive: true };
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { clearTs: null, definitive: lineCount > 5 };
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
  const projectDir = claudeProjectDir(workspaceCwd);
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

/**
 * Start the poller. Returns false, and starts nothing, in a peer dashboard
 * (PAN-3931): every pass writes the shared conversations table — marking rows
 * ended, resurrecting them, backfilling specialist rows. A peer in a workspace
 * container cannot see the primary's sessions, so it would end live
 * conversations. The primary is the one writer.
 */
export function startConversationLifecycleService(): boolean {
  if (isPeerDashboardProcess()) return false;
  console.log('[overdeck] ConversationLifecycleService started (10s poll)');
  scheduleNext();
  return true;
}

export function stopConversationLifecycleService(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('[overdeck] ConversationLifecycleService stopped');
  }
}
