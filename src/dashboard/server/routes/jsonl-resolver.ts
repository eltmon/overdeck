/**
 * JSONL transcript resolver for the Command Deck (PAN-830).
 *
 * Maps an agent ID (e.g. `agent-pan-830`, `planning-pan-830`, or a canonical
 * specialist tmux session name) to the agent's JSONL transcript file on disk.
 *
 * Codex agents (PAN-1805) write rollout JSONLs under the per-agent
 * `codex-home/sessions/` tree — resolution dispatches on the harness recorded
 * in state.json (thread-id fast path, then latest-rollout fallback).
 *
 * For claude-code agents the JSONL filename is the *Claude session ID* (a UUID
 * written by Claude Code itself), NOT the agent/tmux name. Lookup order:
 *   1. session.id     — single UUID written by auto-suspend
 *   2. sessions.json  — array of UUIDs the agent has used; the heartbeat hook
 *                       APPENDS new IDs and dedupes, so once a session has been
 *                       seen its array index never moves. After a `pan resume`
 *                       brings an older session back as the live one, the array
 *                       order no longer reflects time-recency. We disambiguate
 *                       across all listed IDs by JSONL mtime.
 *   3. runtime state  — in-process mirror, populated by hooks
 *
 * Async-only (fs/promises) because this code path runs inside the dashboard
 * server's event loop.
 */
import { access, readFile, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { getAgentRuntimeState, getAgentStateSync } from '../../../lib/agents.js';
import { encodeClaudeProjectDir, getOverdeckHome } from '../../../lib/paths.js';
import { getAgentWorkspace } from '../../../lib/agent-enrichment.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import type { HarnessName } from '../../../lib/runtimes/types.js';

export interface ResolveJsonlPathOptions {
  /** Override the ~/.overdeck/agents directory (test hook). */
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

function behaviorForHarness(harness: string | null | undefined) {
  return getHarnessBehavior(harness as HarnessName | null | undefined);
}

/**
 * Pick the candidate UUID whose JSONL transcript has the most recent mtime.
 *
 * The heartbeat hook appends to sessions.json and dedupes — so once an ID is
 * recorded, its array index never moves even if a later resume makes it the
 * current session again. Choosing by JSONL mtime is the only reliable signal
 * for "which session is actually live right now."
 *
 * Returns null if no candidate has a corresponding JSONL on disk. Falls back
 * to scanning every project dir if the workspace path can't be resolved
 * (covers specialist sessions whose workspace lives elsewhere).
 */
async function pickFreshestSessionId(
  candidates: ReadonlyArray<string>,
  agentId: string,
  opts: ResolveJsonlPathOptions,
): Promise<string | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const projectsRoot = opts.claudeProjectsDirOverride ?? join(homedir(), '.claude', 'projects');

  // Fast path: derive the agent's workspace and look only in the matching
  // project dir. Avoids fanning out across every Claude project.
  let candidatePaths: Array<{ id: string; path: string }> = [];
  try {
    const workspace = await Effect.runPromise(getAgentWorkspace(agentId));
    if (workspace) {
      const projectDir = join(projectsRoot, encodeClaudeProjectDir(workspace));
      candidatePaths = candidates.map((id) => ({ id, path: join(projectDir, `${id}.jsonl`) }));
    }
  } catch { /* non-fatal — fall back to project-dir scan */ }

  // Slow path: scan all project dirs (specialist agents, multi-workspace cases).
  if (candidatePaths.length === 0) {
    try {
      const dirs = await readdir(projectsRoot);
      const SAFE_DIR = /^[a-zA-Z0-9_.-]+$/;
      for (const id of candidates) {
        for (const dir of dirs) {
          if (!SAFE_DIR.test(dir)) continue;
          candidatePaths.push({ id, path: join(projectsRoot, dir, `${id}.jsonl`) });
        }
      }
    } catch { /* fall through to no-mtime path */ }
  }

  // Stat each candidate path; pick the (id, mtime) with the newest mtime.
  let best: { id: string; mtimeMs: number } | null = null;
  for (const { id, path } of candidatePaths) {
    try {
      const s = await stat(path);
      if (!best || s.mtimeMs > best.mtimeMs) {
        best = { id, mtimeMs: s.mtimeMs };
      }
    } catch { /* missing file — skip */ }
  }

  // If no candidate has a JSONL on disk, fall back to the historical "last
  // appended" heuristic — the previous behavior. Better than returning null
  // for callers that only need a session ID, not necessarily a live JSONL.
  return best ? best.id : (candidates[candidates.length - 1] ?? null);
}

/** Async equivalent of getLatestSessionId from lib/agents.ts. */
export async function resolveClaudeSessionId(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsRoot, agentId);

  // 1. session.id — single UUID written by auto-suspend. Authoritative when
  //    present (only one session is alive when suspend writes this file).
  const sessionIdRaw = await readOptional(join(agentDir, 'session.id'));
  const sessionIdTrimmed = sessionIdRaw?.trim();
  if (sessionIdTrimmed) return sessionIdTrimmed;

  // 2. sessions.json — array of UUIDs the agent has ever used. We can't trust
  //    array order (see file-level docs), so disambiguate by JSONL mtime.
  const sessionsRaw = await readOptional(join(agentDir, 'sessions.json'));
  if (sessionsRaw) {
    try {
      const parsed: unknown = JSON.parse(sessionsRaw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
        const fresh = await pickFreshestSessionId(valid, agentId, opts);
        if (fresh) return fresh;
      }
    } catch { /* non-fatal */ }
  }

  // 3. runtime state claudeSessionId (in-process mirror)
  try {
    const lookup = opts.getRuntimeStateAsync ?? ((id: string) => Effect.runPromise(getAgentRuntimeState(id)));
    const runtimeState = await lookup(agentId);
    if (runtimeState?.claudeSessionId) return runtimeState.claudeSessionId;
  } catch { /* non-fatal */ }

  return null;
}

/**
 * Read the Claude session id PINNED into an agent/conversation launcher.sh.
 *
 * The launcher is what spawns the live tmux pane: it runs
 * `claude … --session-id <uuid>` (or `--resume <uuid>`), so the pinned id is the
 * EXACT session the Terminal tab attaches to — the only deterministic ground
 * truth for "which session is live right now." Resolving the transcript panel
 * from this id makes the Conversation tab match the Terminal tab by construction,
 * instead of guessing via JSONL mtime (racy: an older session's file gets touched
 * by a compaction summary write-back or a transient relaunch, its mtime jumps
 * ahead of the live session's, and the panel renders the wrong transcript).
 *
 * Checks the conversation launcher dir first, then the agent launcher dir.
 * Returns the uuid, or null when no launcher exists or it pins no session id.
 */
const LAUNCHER_UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const LAUNCHER_SESSION_ID_RE = new RegExp(`--session-id\\s+'?(${LAUNCHER_UUID})'?`);
const LAUNCHER_RESUME_RE = new RegExp(`--resume\\s+'?(${LAUNCHER_UUID})'?`);

export async function readLauncherPinnedSessionId(
  tmuxSession: string,
  opts: { overdeckHomeOverride?: string } = {},
): Promise<string | null> {
  const home = opts.overdeckHomeOverride ?? getOverdeckHome();
  const candidates = [
    join(home, 'conversations', tmuxSession, 'launcher.sh'),
    join(home, 'agents', tmuxSession, 'launcher.sh'),
  ];
  for (const path of candidates) {
    const text = await readOptional(path);
    if (!text) continue;
    const match = LAUNCHER_SESSION_ID_RE.exec(text) ?? LAUNCHER_RESUME_RE.exec(text);
    if (match) return match[1]!;
  }
  return null;
}

/**
 * Read the harness + workspace recorded for an agent, honoring the test
 * override dir. Used by resolveAgentHarness / agentHasClaudeTranscript so the
 * stale-harness self-correction runs identically in prod and under test.
 */
async function readRecordedState(
  agentId: string,
  opts: ResolveJsonlPathOptions,
): Promise<{ harness: string | null; workspace?: string }> {
  if (opts.agentsDirOverride) {
    try {
      const raw = await readFile(join(opts.agentsDirOverride, agentId, 'state.json'), 'utf8');
      const s = JSON.parse(raw) as { harness?: unknown; workspace?: unknown };
      return {
        harness: typeof s.harness === 'string' ? s.harness : null,
        workspace: typeof s.workspace === 'string' ? s.workspace : undefined,
      };
    } catch {
      return { harness: null };
    }
  }
  const st = getAgentStateSync(agentId);
  return { harness: st?.harness ?? null, workspace: st?.workspace };
}

/**
 * Resolve the harness for transcript routing. Reads state.json, then
 * self-corrects when the recorded value is stale.
 *
 * Trust an explicit non-default harness (codex / pi / ohmypi) — it was chosen
 * by resolveHarness at spawn time and is not the generic fallback. The
 * 'claude-code' default, however, goes stale in one observed case: a
 * wipe-and-respawn that changed the provider-default harness left state.json
 * carrying the pre-respawn 'claude-code' while the fresh launch was
 * codex/ohmypi. The resolver then took the claude-code branch, found no
 * claudeSessionId, and the dashboard showed "No conversation data available"
 * for a live agent whose real transcript sat untouched under codex-home.
 *
 * Self-correction (claude-code/null recorded only): if the agent has NO
 * claude-code transcript on disk but DOES have a codex rollout / pi session,
 * the on-disk runtime wins — those artifacts are written only by that runtime,
 * so this cannot surface a wrong transcript. When a claude-code transcript IS
 * present it always wins, so a past codex run's codex-home can't shadow a
 * current claude-code session.
 */
export async function resolveAgentHarness(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const recorded = (await readRecordedState(agentId, opts)).harness;
  if (recorded === 'codex' || recorded === 'pi' || recorded === 'ohmypi') {
    return recorded;
  }
  // 'claude-code' (or null) is the default that can go stale. Correct it from
  // on-disk artifacts only when no claude-code transcript exists for the agent.
  if (await agentHasClaudeTranscript(agentId, opts)) {
    return recorded ?? 'claude-code';
  }
  if (await resolveCodexRolloutPath(agentId, opts)) return 'codex';
  if (await resolvePiSessionPath(agentId, opts)) return 'ohmypi';
  return recorded;
}

/**
 * Whether the agent has a resolvable claude-code transcript on disk. Used by
 * resolveAgentHarness to decide if a claude-code recording is still live
 * (vs. a stale default that should be corrected to codex/ohmypi).
 */
async function agentHasClaudeTranscript(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<boolean> {
  const sessionId = await resolveClaudeSessionId(agentId, opts);
  if (!sessionId) return false;
  const workspace = (await readRecordedState(agentId, opts)).workspace;
  if (!workspace) return false;
  const projectsRoot = opts.claudeProjectsDirOverride ?? join(homedir(), '.claude', 'projects');
  return pathExists(join(projectsRoot, encodeClaudeProjectDir(workspace), `${sessionId}.jsonl`));
}

/**
 * Resolve the Codex rollout JSONL for a codex-harness agent (PAN-1805).
 *
 * Fast path: the persisted codex-thread-id maps directly to its rollout file.
 * Lazy fallback (same shape as the conversation panel's PAN-1690 fix): codex
 * writes the rollout only on the first turn, so a spawn-time thread-id capture
 * can miss it — the per-agent CODEX_HOME holds only this agent's rollouts, so
 * the newest one is its current thread.
 */
export async function resolveCodexRolloutPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsRoot, agentId);
  const codexHome = join(agentDir, 'codex-home');
  if (!(await pathExists(codexHome))) return null;

  const { findRolloutPath, findLatestRollout } = await import('../../../lib/runtimes/codex.js');

  const threadId = (await readOptional(join(agentDir, 'codex-thread-id')))?.trim();
  if (threadId) {
    const rollout = findRolloutPath(codexHome, threadId);
    if (rollout) return rollout;
  }
  return findLatestRollout(codexHome);
}

/**
 * Resolve the pi/kimi session JSONL (PAN-1908). Pi writes its session transcript
 * as `<iso-ts>_<session-id>.jsonl` either in the agent dir's `sessions/` subdir
 * (conversations) OR in the agent dir root (work agents) — so check both. The dir
 * also holds `cost-events.jsonl` / `activity.jsonl`, which are NOT transcripts.
 * Return the freshest transcript by mtime, or null if pi hasn't written one yet.
 */
export async function resolvePiSessionPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsRoot, agentId);
  const NON_TRANSCRIPT = new Set(['cost-events.jsonl', 'activity.jsonl', 'pending-events.jsonl']);
  let best: { path: string; mtime: number } | null = null;
  for (const dir of [join(agentDir, 'sessions'), agentDir]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl') || NON_TRANSCRIPT.has(name)) continue;
      const p = join(dir, name);
      try {
        const m = (await stat(p)).mtimeMs;
        if (!best || m > best.mtime) best = { path: p, mtime: m };
      } catch { /* unreadable entry — skip */ }
    }
  }
  return best?.path ?? null;
}

/**
 * Resolve the JSONL transcript for an agent.
 *
 * Codex agents resolve to their rollout JSONL (PAN-1805). For claude-code
 * agents, returns the absolute path if both the claudeSessionId is known AND
 * the corresponding JSONL file exists; otherwise null.
 */
export async function resolveJsonlPath(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  // Dispatch on the recorded harness so a stale session.id from an earlier
  // claude-code run of the same agent id can't shadow the codex transcript.
  const harness = await resolveAgentHarness(agentId, opts);
  const behavior = behaviorForHarness(harness);
  if (behavior.transcriptKind === 'codex-rollout-jsonl') {
    return resolveCodexRolloutPath(agentId, opts);
  }
  if (behavior.transcriptKind === 'ohmypi-jsonl') {
    return resolvePiSessionPath(agentId, opts);
  }

  const claudeSessionId = await resolveClaudeSessionId(agentId, opts);
  if (!claudeSessionId) return null;

  const projectsRoot = opts.claudeProjectsDirOverride ?? join(homedir(), '.claude', 'projects');
  const encodedDir = encodeClaudeProjectDir(workspacePath);
  const jsonlPath = join(projectsRoot, encodedDir, `${claudeSessionId}.jsonl`);
  if (await pathExists(jsonlPath)) return jsonlPath;
  return null;
}
