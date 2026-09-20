import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
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
import {
  appendSessionIdToHistory,
  isSessionResetMarker,
  readLatestIndexedSessionIdSync,
} from '../session-history.js';

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
 * Save Claude session ID for later resume. `reason` distinguishes an
 * ordinary rotation from a crash-recovery pickup for callers/logs that care;
 * both paths persist identically (PAN-3917: the durable cross-machine
 * agent-plane mirror this used to also write is gone with the record plane.
 */
export function saveSessionId(
  agentId: string,
  sessionId: string,
  source: 'rotation' | 'recovered' = 'rotation',
): void {
  appendSessionIdToHistory(agentId, sessionId, source);
}

/**
 * Get saved Claude session ID
 */
export function getSessionId(agentId: string): string | null {
  return readLatestIndexedSessionIdSync(agentId);
}

/**
 * PAN-1988 — for a codex agent, resolve its real resumable thread id from the rollout.
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

export interface SessionResolutionResult {
  sessionId: string | null;
  checked: string[];
}

export interface ClaudeSessionRecoveryDeps {
  getAgentState?: typeof getAgentStateSync;
  isSessionReset?: (agentId: string) => boolean;
  readEventSessionId: typeof readLatestAgentClaudeSessionIdEventSync;
  transcriptExists: (workspace: string, sessionId: string) => boolean;
  log: (message: string) => void;
}

function claudeProjectDir(workspace: string): string {
  return join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(workspace));
}

function defaultClaudeSessionRecoveryDeps(): ClaudeSessionRecoveryDeps {
  return {
    isSessionReset: isSessionResetMarker,
    readEventSessionId: readLatestAgentClaudeSessionIdEventSync,
    transcriptExists: (workspace, sessionId) => existsSync(join(claudeProjectDir(workspace), `${sessionId}.jsonl`)),
    log: (message) => console.warn(message),
  };
}

/**
 * Last-resort claude-code session lookup, tried once the session index and
 * runtime state have no answer: the `agent.model_set` event-store
 * history. PAN-3917: this used to check the durable git-tracked agent-plane
 * record first — that door (pan-dir/agents.ts) and its writer are gone with the
 * record plane, so the event-store check is the only surviving source.
 */
export function resolveClaudeSessionRecoverySync(
  agentId: string,
  agentState: ReturnType<typeof getAgentStateSync>,
  deps: ClaudeSessionRecoveryDeps = defaultClaudeSessionRecoveryDeps(),
): SessionResolutionResult {
  const checked: string[] = [];
  if (!agentState?.workspace || !agentState.issueId) {
    return { sessionId: null, checked: ['event store unavailable because agent metadata is missing'] };
  }

  try {
    checked.push('agent.model_set event history');
    const eventSessionId = deps.readEventSessionId(agentId);
    if (eventSessionId && deps.transcriptExists(agentState.workspace, eventSessionId)) {
      return { sessionId: eventSessionId, checked };
    }
  } catch (error) {
    deps.log(
      `[agents] Event-store session lookup failed for ${agentId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // PAN-3849: a transcript is never adopted by directory listing. The planner and the work
  // agent share a workspace path, so "exactly one file" proved nothing about ownership.
  return { sessionId: null, checked };
}

export function resolveLatestSessionIdSync(
  agentId: string,
  recoveryDeps?: ClaudeSessionRecoveryDeps,
): SessionResolutionResult {
  const isSessionReset = recoveryDeps?.isSessionReset ?? isSessionResetMarker;
  if (isSessionReset(agentId)) {
    return { sessionId: null, checked: ['session reset marker'] };
  }

  const checked: string[] = ['Codex rollout/thread id'];
  // 0. Codex thread id first: the freshest rollout is the resume truth.
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

  // 2. sessions.json (append-only; its last entry is the current session).
  checked.push('sessions.json');
  const indexed = getSessionId(agentId);
  if (indexed) return { sessionId: indexed, checked };

  // 3. runtime.json claudeSessionId
  checked.push('runtime.json');
  const runtimeState = getAgentRuntimeStateSync(agentId);
  if (runtimeState?.claudeSessionId) {
    return { sessionId: runtimeState.claudeSessionId, checked };
  }

  // 4. codex-thread-id (written after codex rollout appears; fallback so
  //    resumeAgent can locate the Codex session after startup capture).
  checked.push('codex-thread-id');
  const codexThreadIdPath = join(getAgentDir(agentId), 'codex-thread-id');
  try {
    if (existsSync(codexThreadIdPath)) {
      const threadId = readFileSync(codexThreadIdPath, 'utf-8').trim();
      if (threadId) return { sessionId: threadId, checked };
    }
  } catch { /* non-fatal */ }

  // 5. ohmypi (omp) — PAN-2098. The real id also lives inside
  //    the freshest session JSONL. Mirror the ohmypi runtime adapter's own resume
  //    resolution so the deacon recovery path can resume a crashed ohmypi agent
  //    instead of only respawning it fresh and losing context.
  if (sessionIdSource === 'transcript-jsonl') {
    checked.push('OhMyPi transcript session');
    const ohmypiSessionId = resolveLatestOhmypiSessionId(agentId);
    if (ohmypiSessionId) return { sessionId: ohmypiSessionId, checked };
  }

  // 6. kimi-code — the id is captured post-launch from its own wire.jsonl
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
  return { sessionId: recovered.sessionId, checked: [...checked, ...recovered.checked] };
}

export function getLatestSessionIdSync(agentId: string): string | null {
  return resolveLatestSessionIdSync(agentId).sessionId;
}

export const getLatestSessionId = (
  agentId: string,
  recoveryDeps?: ClaudeSessionRecoveryDeps,
): Effect.Effect<string | null> =>
  Effect.sync(() => resolveLatestSessionIdSync(agentId, recoveryDeps).sessionId);
