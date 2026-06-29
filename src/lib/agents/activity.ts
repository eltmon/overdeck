import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import {
  getAgentDir,
  getAgentStateSync,
  getAgentRuntimeStateSync,
  getAgentRuntimeState,
  normalizeAgentId,
} from '../agents.js';
import { encodeClaudeProjectDir } from '../paths.js';
import { findLatestRollout, extractThreadIdFromRollout } from '../runtimes/codex.js';
import { resolveLatestOhmypiSessionId } from '../runtimes/ohmypi.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { FsError } from '../errors.js';

/** Activity log entry (still written by heartbeat-hook as a forensic artifact). */
export interface ActivityEntry {
  ts: string;
  tool: string;
  action?: string;
  state?: 'active' | 'idle';
}

/**
 * Append to activity log with automatic pruning to 100 entries
 */
export function appendActivity(agentId: string, entry: ActivityEntry): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  const activityFile = join(dir, 'activity.jsonl');

  // Append entry
  appendFileSync(activityFile, JSON.stringify(entry) + '\n');

  // Prune to last 100 entries
  if (existsSync(activityFile)) {
    try {
      const lines = readFileSync(activityFile, 'utf8').trim().split('\n');
      if (lines.length > 100) {
        const trimmed = lines.slice(-100);
        writeFileSync(activityFile, trimmed.join('\n') + '\n');
      }
    } catch (error) {
      // Ignore pruning errors - activity log is non-critical
    }
  }
}

/**
 * Read activity log (last N entries)
 */
export function getActivity(agentId: string, limit = 100): ActivityEntry[] {
  const activityFile = join(getAgentDir(agentId), 'activity.jsonl');

  if (!existsSync(activityFile)) {
    return [];
  }

  try {
    const lines = readFileSync(activityFile, 'utf8').trim().split('\n');
    const entries = lines
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ActivityEntry)
      .slice(-limit);

    return entries;
  } catch {
    return [];
  }
}

/**
 * Save Claude session ID for later resume
 */
export function saveSessionId(agentId: string, sessionId: string): void {
  const dir = getAgentDir(agentId);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'session.id'), sessionId);
}

/**
 * Get saved Claude session ID
 */
export function getSessionId(agentId: string): string | null {
  const sessionFile = join(getAgentDir(agentId), 'session.id');

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    return readFileSync(sessionFile, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * PAN-1988 — for a codex agent, resolve its REAL resumable thread id. codex writes a placeholder
 * UUID into `session.id` at spawn; the resumable id is the codex thread, recorded in the rollout.
 * Prefer the explicitly-captured `codex-thread-id`, then fall back to the freshest rollout on disk
 * (always current — codex writes a new rollout per resume, so this self-heals across resume cycles
 * without depending on the capture poll landing). Returns null for non-codex agents.
 */
function resolveCodexThreadIdSync(agentId: string): string | null {
  const agentDir = getAgentDir(agentId);
  const codexHome = join(agentDir, 'codex-home');
  if (!existsSync(codexHome)) return null; // not a codex agent
  try {
    const threadIdPath = join(agentDir, 'codex-thread-id');
    if (existsSync(threadIdPath)) {
      const id = readFileSync(threadIdPath, 'utf-8').trim();
      if (id) return id;
    }
  } catch { /* non-fatal */ }
  try {
    const rollout = findLatestRollout(codexHome);
    if (rollout) {
      const id = extractThreadIdFromRollout(rollout);
      if (id) return id;
    }
  } catch { /* non-fatal */ }
  return null;
}

/**
 * Sync mirror of jsonl-resolver.ts's pickFreshestSessionId: from a list of
 * candidate session ids, return the one whose JSONL transcript has the most
 * recent mtime, skipping ids with no file on disk. Falls back to the last
 * appended id when none have a transcript (e.g. workspace moved). Returns null
 * only when there are no usable candidates.
 */
function pickFreshestExistingSessionIdSync(agentId: string, candidates: unknown[]): string | null {
  const valid = candidates.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (valid.length === 0) return null;
  const workspace = getAgentStateSync(agentId)?.workspace;
  if (workspace) {
    const projectDir = join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(workspace));
    let best: { id: string; mtimeMs: number } | null = null;
    for (const id of valid) {
      try {
        const s = statSync(join(projectDir, `${id}.jsonl`));
        if (!best || s.mtimeMs > best.mtimeMs) best = { id, mtimeMs: s.mtimeMs };
      } catch { /* no JSONL for this id — skip */ }
    }
    if (best) return best.id;
  }
  return valid[valid.length - 1] ?? null;
}

export function getLatestSessionIdSync(agentId: string): string | null {
  // 0. codex thread id FIRST — `session.id` below holds a placeholder UUID for codex agents, so
  //    returning it would make resumeAgent target a non-existent thread and codex would drift into
  //    a fresh rollout, losing conversation history (PAN-1988). The freshest rollout is the truth.
  const codexThreadId = resolveCodexThreadIdSync(agentId);
  if (codexThreadId) return codexThreadId;

  // 1. session.id (written by auto-suspend) — the real id for claude-code.
  const fromSessionFile = getSessionId(agentId);
  if (fromSessionFile) return fromSessionFile;

  // 2. sessions.json (append-only list of session ids the agent has used).
  //    The array can hold aborted/empty ids (e.g. a fresh session that never
  //    produced a transcript), so we can't trust "last entry" — pick the id
  //    whose JSONL is freshest on disk, matching resolveClaudeSessionId
  //    (jsonl-resolver.ts). Falls back to last-appended when none exist on disk.
  const sessionsFile = join(getAgentDir(agentId), 'sessions.json');
  try {
    if (existsSync(sessionsFile)) {
      const sessions = JSON.parse(readFileSync(sessionsFile, 'utf8'));
      if (Array.isArray(sessions) && sessions.length > 0) {
        const picked = pickFreshestExistingSessionIdSync(agentId, sessions);
        if (picked) return picked;
      }
    }
  } catch { /* non-fatal */ }

  // 3. runtime.json claudeSessionId
  const runtimeState = getAgentRuntimeStateSync(agentId);
  if (runtimeState?.claudeSessionId) {
    return runtimeState.claudeSessionId;
  }

  // 4. codex-thread-id (written after codex rollout appears; fallback so
  //    resumeAgent can locate the Codex session even if session.id has a
  //    stale random UUID from spawnRun's placeholder write).
  const codexThreadIdPath = join(getAgentDir(agentId), 'codex-thread-id');
  try {
    if (existsSync(codexThreadIdPath)) {
      const threadId = readFileSync(codexThreadIdPath, 'utf-8').trim();
      if (threadId) return threadId;
    }
  } catch { /* non-fatal */ }

  // 5. ohmypi (omp) — PAN-2098. omp never writes a `session.id` file, so none of
  //    the claude-code/codex sources above can find it; the real id lives inside
  //    the freshest session JSONL. Mirror the ohmypi runtime adapter's own resume
  //    resolution so the deacon recovery path can resume a crashed ohmypi agent
  //    instead of only respawning it fresh and losing context.
  const agentState = getAgentStateSync(agentId);
  if (agentState?.harness && getHarnessBehavior(agentState.harness).sessionIdSource === 'transcript-jsonl') {
    const ohmypiSessionId = resolveLatestOhmypiSessionId(agentId);
    if (ohmypiSessionId) return ohmypiSessionId;
  }

  return null;
}

export const getLatestSessionId = (agentId: string): Effect.Effect<string | null> => {
  const agentDir = getAgentDir(agentId);
  const sessionFile = join(agentDir, 'session.id');
  const sessionsFile = join(agentDir, 'sessions.json');

  return Effect.gen(function* () {
    const sessionId = yield* Effect.tryPromise({
      try: () => readFile(sessionFile, 'utf8'),
      catch: (cause) => new FsError({ operation: 'read', path: sessionFile, cause }),
    }).pipe(
      Effect.map((content) => content.trim()),
      Effect.orElseSucceed(() => ''),
    );
    if (sessionId) return sessionId;

    const latestSession = yield* Effect.tryPromise({
      try: async () => JSON.parse(await readFile(sessionsFile, 'utf8')) as unknown,
      catch: (cause) => new FsError({ operation: 'read', path: sessionsFile, cause }),
    }).pipe(
      Effect.map((sessions) => Array.isArray(sessions) && sessions.length > 0 ? String(sessions[sessions.length - 1]) : null),
      Effect.orElseSucceed(() => null),
    );
    if (latestSession) return latestSession;

    const runtimeState = yield* getAgentRuntimeState(agentId);
    return runtimeState?.claudeSessionId ?? null;
  });
};
