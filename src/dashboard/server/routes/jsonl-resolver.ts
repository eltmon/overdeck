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
 * Pi agents (PAN-1827) write session JSONLs under the per-agent `sessions/`
 * tree — resolution dispatches on the harness recorded in state.json and
 * returns the freshest `.jsonl` by mtime at any nesting depth.
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
import { access, readFile, stat, lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, normalize } from 'node:path';

import { Effect } from 'effect';
import { getAgentRuntimeState } from '../../../lib/agents.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';
import { getAgentWorkspace } from '../../../lib/agent-enrichment.js';

/** Valid agent / tmux session identifier. */
export const SAFE_AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function isSafeAgentId(agentId: string): boolean {
  return SAFE_AGENT_ID_PATTERN.test(agentId);
}

function safeAgentDir(agentsRoot: string, agentId: string): string | null {
  if (!isSafeAgentId(agentId)) return null;
  const resolved = normalize(join(agentsRoot, agentId));
  if (!resolved.startsWith(`${normalize(agentsRoot)}/`) && resolved !== normalize(agentsRoot)) return null;
  return resolved;
}

/**
 * Resolve `p` and verify it is contained within `root`. Returns the resolved
 * path if contained, otherwise null. Uses realpath to defeat symlinks.
 */
async function containedPath(p: string, root: string): Promise<string | null> {
  try {
    const resolved = await realpath(p);
    const normalizedRoot = normalize(root);
    if (!resolved.startsWith(`${normalizedRoot}/`) && resolved !== normalizedRoot) return null;
    return resolved;
  } catch {
    return null;
  }
}

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
  if (!isSafeAgentId(agentId)) return null;
  const agentsRoot = opts.agentsDirOverride ?? join(homedir(), '.panopticon', 'agents');
  const agentDir = safeAgentDir(agentsRoot, agentId);
  if (!agentDir) return null;

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

/** Read the harness recorded in the agent's state.json, or null when absent. */
export async function resolveAgentHarness(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  if (!isSafeAgentId(agentId)) return null;
  const agentsRoot = opts.agentsDirOverride ?? join(homedir(), '.panopticon', 'agents');
  const agentDir = safeAgentDir(agentsRoot, agentId);
  if (!agentDir) return null;
  const stateRaw = await readOptional(join(agentDir, 'state.json'));
  if (!stateRaw) return null;
  try {
    const state = JSON.parse(stateRaw) as { harness?: unknown };
    return typeof state.harness === 'string' ? state.harness : null;
  } catch {
    return null;
  }
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
  if (!isSafeAgentId(agentId)) return null;
  const agentsRoot = opts.agentsDirOverride ?? join(homedir(), '.panopticon', 'agents');
  const agentDir = safeAgentDir(agentsRoot, agentId);
  if (!agentDir) return null;
  const codexHome = join(agentDir, 'codex-home');
  if (!(await pathExists(codexHome))) return null;

  const { findRolloutPathAsync, findLatestRolloutAsync } = await import('../../../lib/runtimes/codex.js');

  const threadId = (await readOptional(join(agentDir, 'codex-thread-id')))?.trim();
  if (threadId) {
    const rollout = await findRolloutPathAsync(codexHome, threadId);
    if (rollout) return rollout;
  }
  return findLatestRolloutAsync(codexHome);
}

/** Cache for resolvePiSessionPath to avoid repeated recursive walks. */
const piSessionPathCache = new Map<string, { path: string; mtimeMs: number; cachedAt: number }>();
const PI_SESSION_CACHE_TTL_MS = 10_000;
const PI_SESSION_CACHE_MAX = 50;

function getCachedPiSessionPath(sessionsDir: string): { path: string; mtimeMs: number } | null {
  const entry = piSessionPathCache.get(sessionsDir);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > PI_SESSION_CACHE_TTL_MS) {
    piSessionPathCache.delete(sessionsDir);
    return null;
  }
  return entry;
}

function setCachedPiSessionPath(sessionsDir: string, result: { path: string; mtimeMs: number }): void {
  piSessionPathCache.set(sessionsDir, { ...result, cachedAt: Date.now() });
  while (piSessionPathCache.size > PI_SESSION_CACHE_MAX) {
    const firstKey = piSessionPathCache.keys().next().value;
    if (firstKey !== undefined) piSessionPathCache.delete(firstKey);
  }
}

/** Max files to stat per resolvePiSessionPath scan to keep latency bounded. */
const PI_SESSION_SCAN_MAX_FILES = 256;
/** Max directory depth under sessions/ to recurse. */
const PI_SESSION_SCAN_MAX_DEPTH = 8;

/**
 * Resolve the Pi session JSONL for a pi-harness agent (PAN-1827).
 *
 * Pi nests session files under `<agentDir>/sessions/` at arbitrary depth (e.g.
 * `<encoded-cwd>/<timestamp>_<id>.jsonl`). The per-agent sessions dir holds
 * only this agent's sessions, so the freshest `.jsonl` by mtime is the live
 * transcript.
 *
 * Security: the walk uses `lstat` to avoid following symlinks, resolves each
 * candidate with `realpath`, and verifies containment under `sessionsDir`.
 * It also caps the total number of files examined and the recursion depth so
 * long-lived agents with unbounded historical JSONLs do not cause latency
 * cliffs.
 */
export async function resolvePiSessionPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  if (!isSafeAgentId(agentId)) return null;
  const agentsRoot = opts.agentsDirOverride ?? join(homedir(), '.panopticon', 'agents');
  const agentDir = safeAgentDir(agentsRoot, agentId);
  if (!agentDir) return null;
  const sessionsDir = join(agentDir, 'sessions');
  const resolvedRoot = await containedPath(sessionsDir, agentDir);
  if (!resolvedRoot) return null;

  const cached = getCachedPiSessionPath(resolvedRoot);
  if (cached) {
    try {
      const s = await lstat(cached.path);
      if (s.isFile() && !s.isSymbolicLink() && s.mtimeMs === cached.mtimeMs) return cached.path;
    } catch { /* stale cache — fall through to re-scan */ }
  }

  let best: { path: string; mtimeMs: number } | null = null;
  let scanned = 0;

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > PI_SESSION_SCAN_MAX_DEPTH) return;
    if (scanned >= PI_SESSION_SCAN_MAX_FILES) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= PI_SESSION_SCAN_MAX_FILES) return;
      const full = join(dir, entry);
      let info;
      try {
        info = await lstat(full);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await scan(full, depth + 1);
        continue;
      }
      if (!info.isFile() || !entry.endsWith('.jsonl')) continue;
      scanned++;
      const contained = await containedPath(full, resolvedRoot);
      if (!contained) continue;
      if (!best || info.mtimeMs > best.mtimeMs) {
        best = { path: contained, mtimeMs: info.mtimeMs };
      }
    }
  }

  await scan(resolvedRoot, 0);
  if (best) setCachedPiSessionPath(resolvedRoot, best);
  return best?.path ?? null;
}

/**
 * Resolve the JSONL transcript for an agent.
 *
 * Codex agents resolve to their rollout JSONL (PAN-1805). Pi agents resolve to
 * their session JSONL (PAN-1827). For claude-code agents, returns the absolute
 * path if both the claudeSessionId is known AND the corresponding JSONL file
 * exists; otherwise null.
 */
export async function resolveJsonlPath(
  agentId: string,
  workspacePath: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  if (!isSafeAgentId(agentId)) return null;
  // Dispatch on the recorded harness so a stale session.id from an earlier
  // claude-code run of the same agent id can't shadow the codex or pi
  // transcript.
  const harness = await resolveAgentHarness(agentId, opts);
  if (harness === 'codex') {
    return resolveCodexRolloutPath(agentId, opts);
  }
  if (harness === 'pi') {
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
