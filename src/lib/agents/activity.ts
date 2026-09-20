import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { getAgentDir, getAgentStateSync } from './agent-state-read.js';
import { getAgentRuntimeStateSync } from './runtime-state.js';
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
  const state = getAgentStateSync(agentId);
  appendSessionIdToHistory(agentId, sessionId, source, {
    harness: state?.harness,
    model: state?.model,
  });
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
  try {
    const threadIdPath = join(agentDir, 'codex-thread-id');
    if (existsSync(threadIdPath)) {
      const id = readFileSync(threadIdPath, 'utf-8').trim();
      if (id) return id;
    }
  } catch { /* non-fatal */ }
  const codexHome = join(agentDir, 'codex-home');
  if (!existsSync(codexHome)) return null;
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
  recoveryDeps?: Partial<ClaudeSessionRecoveryDeps>,
): SessionResolutionResult {
  const deps = { ...defaultClaudeSessionRecoveryDeps(), ...recoveryDeps };
  if ((deps.isSessionReset ?? isSessionResetMarker)(agentId)) {
    return { sessionId: null, checked: ['session reset marker'] };
  }

  const agentState = deps.getAgentState?.(agentId) ?? getAgentStateSync(agentId);
  const sessionIdSource = getHarnessBehavior(agentState?.harness).sessionIdSource;
  const checked: string[] = [];

  if (agentState?.harness === 'codex') {
    checked.push('Codex rollout/thread id');
    return { sessionId: resolveCodexThreadIdSync(agentId), checked };
  }

  if (sessionIdSource === 'acp-session-id') {
    checked.push('ACP session id');
    try {
      const acpSessionId = readFileSync(join(getAgentDir(agentId), 'acp-session-id'), 'utf-8').trim();
      if (acpSessionId) return { sessionId: acpSessionId, checked };
    } catch { /* non-fatal */ }
  }

  // OhMyPi's resumable id lives inside its freshest session JSONL.
  //    the freshest session JSONL. Mirror the ohmypi runtime adapter's own resume
  //    resolution so the deacon recovery path can resume a crashed ohmypi agent
  //    instead of only respawning it fresh and losing context.
  if (sessionIdSource === 'transcript-jsonl') {
    checked.push('OhMyPi transcript session');
    const ohmypiSessionId = resolveLatestOhmypiSessionId(agentId);
    if (ohmypiSessionId) return { sessionId: ohmypiSessionId, checked };
    checked.push(join(getAgentDir(agentId), 'sessions.json'));
    return { sessionId: getSessionId(agentId), checked };
  }

  // Kimi's id is captured post-launch from its own wire.jsonl
  //    session directory and persisted to `<agentDir>/kimi-session-id`
  //    (writeKimiSessionId, mirrors codex's thread-id file above).
  if (sessionIdSource === 'kimi-session-newest') {
    checked.push('Kimi session pointer');
    try {
      const kimiSessionId = readFileSync(join(getAgentDir(agentId), 'kimi-session-id'), 'utf-8').trim();
      if (kimiSessionId) return { sessionId: kimiSessionId, checked };
    } catch { /* non-fatal */ }
  }

  if (sessionIdSource !== 'launcher-session-id') {
    return { sessionId: null, checked };
  }

  const agentDir = getAgentDir(agentId);
  const indexPath = join(agentDir, 'sessions.json');
  checked.push(indexPath, join(agentDir, 'session.id'));
  const indexed = getSessionId(agentId);
  if (indexed) return { sessionId: indexed, checked };
  // An existing index is authoritative even when empty or malformed. Mutable
  // launcher/runtime/state pointers are compatibility fallbacks only when the
  // index has never been created.
  if (existsSync(indexPath)) return { sessionId: null, checked };

  const launcherPath = join(agentDir, 'launcher.sh');
  checked.push(launcherPath);
  try {
    const launcher = readFileSync(launcherPath, 'utf8');
    const pinned = /--(?:session-id|resume)\s+['"]?([0-9a-fA-F-]{36})/.exec(launcher)?.[1];
    if (pinned) return { sessionId: pinned, checked };
  } catch { /* compatibility fallback only */ }

  checked.push(join(agentDir, 'runtime.json'), join(agentDir, 'state.json'));
  const runtimeSessionId = getAgentRuntimeStateSync(agentId)?.claudeSessionId;
  if (runtimeSessionId) return { sessionId: runtimeSessionId, checked };
  if (agentState?.sessionId) return { sessionId: agentState.sessionId, checked };

  const recovered = resolveClaudeSessionRecoverySync(agentId, agentState, deps);
  return { sessionId: recovered.sessionId, checked: [...checked, ...recovered.checked] };
}

export function getLatestSessionIdSync(
  agentId: string,
  recoveryDeps?: Partial<ClaudeSessionRecoveryDeps>,
): string | null {
  return resolveLatestSessionIdSync(agentId, recoveryDeps).sessionId;
}

export const getLatestSessionId = (
  agentId: string,
  recoveryDeps?: Partial<ClaudeSessionRecoveryDeps>,
): Effect.Effect<string | null> =>
  Effect.sync(() => resolveLatestSessionIdSync(agentId, recoveryDeps).sessionId);
