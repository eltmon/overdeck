import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import {
  getAgentDir,
  getAgentStateSync,
  getAgentRuntimeStateSync,
} from '../agents.js';
import { encodeClaudeProjectDir } from '../paths.js';
import { findLatestRollout, extractThreadIdFromRollout } from '../runtimes/codex.js';
import { resolveLatestOhmypiSessionId } from '../runtimes/ohmypi.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { readLatestAgentClaudeSessionIdEventSync } from '../overdeck/event-reads.js';
import { appendAgentPlaneSession, readAgentPlaneRecordSync } from '../pan-dir/agents.js';
import { appendSessionIdToHistory, persistCurrentSessionId } from '../session-history.js';

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
export function saveSessionId(
  agentId: string,
  sessionId: string,
  reason: 'rotation' | 'recovered' = 'rotation',
): void {
  persistCurrentSessionId(agentId, sessionId);
  appendSessionIdToHistory(agentId, sessionId);
  const state = getAgentStateSync(agentId);
  if (!state) {
    console.warn(`[agents] Could not append durable session ${sessionId} for ${agentId}: agent state is missing`);
    return;
  }
  void appendAgentPlaneSession(state, {
    id: sessionId,
    startedAt: new Date().toISOString(),
    reason,
  }).catch((error) => {
    console.warn(
      `[agents] Could not append durable session ${sessionId} for ${agentId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  });
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

export interface SessionResolutionResult {
  sessionId: string | null;
  checked: string[];
  needsPointerRepair?: true;
}

export interface ClaudeSessionRecoveryDeps {
  getAgentState?: typeof getAgentStateSync;
  readAgentPlaneRecord: typeof readAgentPlaneRecordSync;
  readEventSessionId: typeof readLatestAgentClaudeSessionIdEventSync;
  transcriptExists: (workspace: string, sessionId: string) => boolean;
  listTranscriptSessionIds: (workspace: string) => string[];
  log: (message: string) => void;
}

function claudeProjectDir(workspace: string): string {
  return join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(workspace));
}

function defaultClaudeSessionRecoveryDeps(): ClaudeSessionRecoveryDeps {
  return {
    readAgentPlaneRecord: readAgentPlaneRecordSync,
    readEventSessionId: readLatestAgentClaudeSessionIdEventSync,
    transcriptExists: (workspace, sessionId) => existsSync(join(claudeProjectDir(workspace), `${sessionId}.jsonl`)),
    listTranscriptSessionIds: (workspace) => {
      const projectDir = claudeProjectDir(workspace);
      try {
        return readdirSync(projectDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
          .map((entry) => entry.name.slice(0, -'.jsonl'.length));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn(
            `[agents] Transcript-directory scan failed for ${projectDir}: `
            + `${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return [];
      }
    },
    log: (message) => console.warn(message),
  };
}

export function resolveClaudeSessionRecoverySync(
  agentId: string,
  agentState: ReturnType<typeof getAgentStateSync>,
  deps: ClaudeSessionRecoveryDeps = defaultClaudeSessionRecoveryDeps(),
): SessionResolutionResult {
  const checked: string[] = [];
  if (!agentState?.workspace || !agentState.issueId) {
    return { sessionId: null, checked: ['durable agents plane, event store, and transcript directory unavailable because agent metadata is missing'] };
  }

  try {
    checked.push('durable agents plane');
    const record = deps.readAgentPlaneRecord(agentState.issueId, agentId);
    const candidates = [...(record?.sessions ?? [])]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    const candidate = candidates.find((entry) => deps.transcriptExists(agentState.workspace, entry.id));
    if (candidate) return { sessionId: candidate.id, checked, needsPointerRepair: true };
  } catch (error) {
    deps.log(
      `[agents] Durable agent-plane session lookup failed for ${agentId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    checked.push('agent.model_set event history');
    const eventSessionId = deps.readEventSessionId(agentId);
    if (eventSessionId && deps.transcriptExists(agentState.workspace, eventSessionId)) {
      return { sessionId: eventSessionId, checked, needsPointerRepair: true };
    }
  } catch (error) {
    deps.log(
      `[agents] Event-store session lookup failed for ${agentId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  checked.push('exactly-one transcript-directory scan');
  const transcriptIds = deps.listTranscriptSessionIds(agentState.workspace);
  return transcriptIds.length === 1
    ? { sessionId: transcriptIds[0] ?? null, checked, needsPointerRepair: true }
    : { sessionId: null, checked };
}

export function resolveLatestSessionIdSync(
  agentId: string,
  recoveryDeps?: ClaudeSessionRecoveryDeps,
): SessionResolutionResult {
  const checked: string[] = ['Codex rollout/thread id'];
  // 0. codex thread id FIRST — `session.id` below holds a placeholder UUID for codex agents, so
  //    returning it would make resumeAgent target a non-existent thread and codex would drift into
  //    a fresh rollout, losing conversation history (PAN-1988). The freshest rollout is the truth.
  const codexThreadId = resolveCodexThreadIdSync(agentId);
  if (codexThreadId) return { sessionId: codexThreadId, checked };

  // 1. ACP session id — the host writes the provider's durable session/load id.
  const agentState = recoveryDeps?.getAgentState?.(agentId) ?? getAgentStateSync(agentId);
  const sessionIdSource = agentState?.harness
    ? getHarnessBehavior(agentState.harness).sessionIdSource
    : undefined;
  if (sessionIdSource === 'acp-session-id') {
    checked.push('ACP session id');
    try {
      const acpSessionId = readFileSync(join(getAgentDir(agentId), 'acp-session-id'), 'utf-8').trim();
      if (acpSessionId) return { sessionId: acpSessionId, checked };
    } catch { /* non-fatal */ }
  }

  // 2. session.id (pinned before fresh launch and updated by suspend/resume) —
  //    the real id for claude-code.
  checked.push('session.id');
  const fromSessionFile = getSessionId(agentId);
  if (fromSessionFile) return { sessionId: fromSessionFile, checked };

  // 2. sessions.json (append-only list of session ids the agent has used).
  //    The array can hold aborted/empty ids (e.g. a fresh session that never
  //    produced a transcript), so we can't trust "last entry" — pick the id
  //    whose JSONL is freshest on disk, matching resolveClaudeSessionId
  //    (jsonl-resolver.ts). Falls back to last-appended when none exist on disk.
  checked.push('sessions.json');
  const sessionsFile = join(getAgentDir(agentId), 'sessions.json');
  try {
    if (existsSync(sessionsFile)) {
      const sessions = JSON.parse(readFileSync(sessionsFile, 'utf8'));
      if (Array.isArray(sessions) && sessions.length > 0) {
        const picked = pickFreshestExistingSessionIdSync(agentId, sessions);
        if (picked) return { sessionId: picked, checked };
      }
    }
  } catch { /* non-fatal */ }

  // 3. runtime.json claudeSessionId
  checked.push('runtime.json');
  const runtimeState = getAgentRuntimeStateSync(agentId);
  if (runtimeState?.claudeSessionId) {
    return { sessionId: runtimeState.claudeSessionId, checked };
  }

  // 4. codex-thread-id (written after codex rollout appears; fallback so
  //    resumeAgent can locate the Codex session even if session.id has a
  //    stale random UUID from spawnRun's placeholder write).
  checked.push('codex-thread-id');
  const codexThreadIdPath = join(getAgentDir(agentId), 'codex-thread-id');
  try {
    if (existsSync(codexThreadIdPath)) {
      const threadId = readFileSync(codexThreadIdPath, 'utf-8').trim();
      if (threadId) return { sessionId: threadId, checked };
    }
  } catch { /* non-fatal */ }

  // 5. ohmypi (omp) — PAN-2098. omp never writes a `session.id` file, so none of
  //    the claude-code/codex sources above can find it; the real id lives inside
  //    the freshest session JSONL. Mirror the ohmypi runtime adapter's own resume
  //    resolution so the deacon recovery path can resume a crashed ohmypi agent
  //    instead of only respawning it fresh and losing context.
  if (sessionIdSource === 'transcript-jsonl') {
    checked.push('OhMyPi transcript session');
    const ohmypiSessionId = resolveLatestOhmypiSessionId(agentId);
    if (ohmypiSessionId) return { sessionId: ohmypiSessionId, checked };
  }

  // 6. kimi-code — the native Kimi Code CLI has no launcher-writable session.id
  //    equivalent; the id is captured post-launch from its own wire.jsonl
  //    session directory and persisted to `<agentDir>/kimi-session-id`
  //    (writeKimiSessionId, mirrors codex's thread-id file above).
  if (sessionIdSource === 'kimi-session-newest') {
    checked.push('Kimi session pointer');
    try {
      const kimiSessionId = readFileSync(join(getAgentDir(agentId), 'kimi-session-id'), 'utf-8').trim();
      if (kimiSessionId) return { sessionId: kimiSessionId, checked };
    } catch { /* non-fatal */ }
  }

  if (agentState?.harness && sessionIdSource !== 'launcher-session-id') {
    return { sessionId: null, checked };
  }
  const recovered = resolveClaudeSessionRecoverySync(agentId, agentState, recoveryDeps);
  return {
    sessionId: recovered.sessionId,
    checked: [...checked, ...recovered.checked],
    ...(recovered.needsPointerRepair ? { needsPointerRepair: true as const } : {}),
  };
}

export function getLatestSessionIdSync(agentId: string): string | null {
  return resolveLatestSessionIdSync(agentId).sessionId;
}

export const getLatestSessionId = (
  agentId: string,
  recoveryDeps?: ClaudeSessionRecoveryDeps,
): Effect.Effect<string | null> =>
  Effect.sync(() => resolveLatestSessionIdSync(agentId, recoveryDeps).sessionId);
