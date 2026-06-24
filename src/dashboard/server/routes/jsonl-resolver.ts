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
import { readRollbackAgentHarnessFromDir } from '../../../lib/overdeck/agent-rollback-state.js';

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

/** Read the harness recorded in the agent's state.json, or null when absent. */
export async function resolveAgentHarness(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  if (opts.agentsDirOverride) {
    return readRollbackAgentHarnessFromDir(opts.agentsDirOverride, agentId);
  }
  return getAgentStateSync(agentId)?.harness ?? null;
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
  if (harness === 'codex') {
    return resolveCodexRolloutPath(agentId, opts);
  }
  if (harness === 'pi' || harness === 'ohmypi') {
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
