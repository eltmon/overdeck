import { resolveMuseSessionPath } from '../../../lib/runtimes/muse-session.js';
/**
 * JSONL transcript resolver for the Command Deck (PAN-830).
 *
 * Maps an agent ID (e.g. `agent-pan-830`, `planning-pan-830`, or a canonical
 * specialist tmux session name) to the agent's JSONL transcript file on disk.
 *
 * Codex agents (PAN-1805) write rollout JSONLs under the per-agent
 * `codex-home/sessions/` tree — resolution dispatches on the harness recorded
 * in state.json (thread-id fast path, then latest-rollout fallback). Claude
 * sessions resolve from the append-only sessions.json index, newest first.
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
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import type { HarnessName } from '../../../lib/runtimes/types.js';
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';

export interface ResolveJsonlPathOptions {
  /** Override the ~/.overdeck/agents directory (test hook). */
  agentsDirOverride?: string;
  /** Override the ~/.claude/projects directory (test hook). */
  claudeProjectsDirOverride?: string;
  /** Override the ~/.kimi-code directory (test hook). */
  kimiHomeOverride?: string;
  /**
   * Explicit workspace path for resolveKimiWirePath. Conversation rows have
   * no AgentState (readRecordedState/getAgentStateSync return nothing), so
   * dashboard conversation callers must supply conv.cwd directly instead of
   * relying on the agent-state lookup (PAN-1837 review fix).
   */
  workspaceOverride?: string;
  /** Override the runtime-state lookup (test hook). */
  getRuntimeStateAsync?: (agentId: string) => Promise<{ claudeSessionId?: string } | null>;
  /** Override forensic logging (test hook). */
  logDiagnostic?: (agentId: string, message: string) => void;
}

// Command Deck polling can resolve the same session repeatedly. Keep forensic
// logging useful by writing only when the resolution outcome changes.
const transcriptResolutionSignatures = new Map<string, string>();

function logTranscriptResolution(
  agentId: string,
  signature: string,
  message: string,
  opts: ResolveJsonlPathOptions,
): void {
  const signatureKey = `${agentId}:${opts.agentsDirOverride ?? 'live'}`;
  if (transcriptResolutionSignatures.get(signatureKey) === signature) return;
  transcriptResolutionSignatures.set(signatureKey, signature);
  const logger = opts.logDiagnostic
    ?? (opts.agentsDirOverride ? undefined : logAgentLifecycleSync);
  logger?.(agentId, `transcript resolution: ${message}`);
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

function parseSessionIds(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((value): string[] => {
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    if (!value || typeof value !== 'object') return [];
    const sessionId = (value as { sessionId?: unknown }).sessionId;
    return typeof sessionId === 'string' && sessionId.trim() ? [sessionId.trim()] : [];
  });
}

async function readIndexedSessionIds(agentDir: string): Promise<{ ids: string[]; exists: boolean }> {
  const raw = await readOptional(join(agentDir, 'sessions.json'));
  if (raw === null) return { ids: [], exists: false };
  try {
    return { ids: parseSessionIds(raw), exists: true };
  } catch {
    return { ids: [], exists: true };
  }
}

/** Async equivalent of getLatestSessionId from lib/agents.ts. */
export async function resolveClaudeSessionId(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const agentDir = join(agentsRoot, agentId);

  const index = await readIndexedSessionIds(agentDir);
  const indexed = index.ids.at(-1);
  if (indexed) return indexed;
  if (!index.exists) {
    const legacy = (await readOptional(join(agentDir, 'session.id')))?.trim(); // legacy read-only fallback
    if (legacy) return legacy;
  }

  // Runtime state claudeSessionId (in-process mirror)
  try {
    const lookup = opts.getRuntimeStateAsync ?? ((id: string) => Effect.runPromise(getAgentRuntimeState(id)));
    const runtimeState = await lookup(agentId);
    if (runtimeState?.claudeSessionId) return runtimeState.claudeSessionId;
  } catch { /* non-fatal */ }

  // State fallback for pre-index runtime snapshots.
  if (!opts.agentsDirOverride) {
    const registrySessionId = getAgentStateSync(agentId)?.sessionId?.trim();
    if (registrySessionId) return registrySessionId;
  }

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
 * Trust an explicit non-default harness (codex / pi / ohmypi / acp) — it was chosen
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
  if (recorded === 'codex' || recorded === 'pi' || recorded === 'ohmypi' || recorded === 'acp' || recorded === 'kimi-code' || recorded === 'opencode' || recorded === 'muse') {
    return recorded;
  }
  // 'claude-code' (or null) is the default that can go stale. Correct it from
  // on-disk artifacts only when no claude-code transcript exists for the agent.
  if (await agentHasClaudeTranscript(agentId, opts)) {
    return recorded ?? 'claude-code';
  }
  if (await resolveAcpTranscriptPath(agentId, opts)) return 'acp';
  if (await resolveCodexRolloutPath(agentId, opts)) return 'codex';
  if (await resolvePiSessionPath(agentId, opts)) return 'ohmypi';
  if (await resolveKimiWirePath(agentId, opts)) return 'kimi-code';
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

/** Resolve the normalized transcript written by the persistent ACP host. */
export async function resolveAcpTranscriptPath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const transcriptPath = join(agentsRoot, agentId, 'acp-session.jsonl');
  return await pathExists(transcriptPath) ? transcriptPath : null;
}

/**
 * Resolve the native Kimi Code CLI wire.jsonl for a kimi-code-harness agent
 * (PAN-1837 wi8a). Fast path: the per-agent kimi-session-id (persisted by
 * wi5's spawnAgent) maps directly to
 * `<kimiHome>/sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl`.
 * Fallback (no captured id): the newest session directory by wire.jsonl mtime
 * under the workspace's workDirKey bucket — same shape as the codex/pi lazy
 * fallbacks above, since Kimi may not have finished writing its first turn
 * when the id was captured.
 */
export async function resolveKimiWirePath(
  agentId: string,
  opts: ResolveJsonlPathOptions = {},
): Promise<string | null> {
  const workspace = opts.workspaceOverride ?? (await readRecordedState(agentId, opts)).workspace;
  if (!workspace) return null;

  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const sessionId = (await readOptional(join(agentsRoot, agentId, 'kimi-session-id')))?.trim() || null;
  const kimiHome = opts.kimiHomeOverride ?? join(homedir(), '.kimi-code');

  // PAN-1837 review fix (P2): use the async twin here — this resolver runs on
  // the dashboard event loop and Command Deck polling re-resolves the same
  // session repeatedly, so a sync readdirSync/statSync walk would block the
  // loop on every poll as a session's history grows.
  const { findKimiWirePathAsync } = await import('../../../lib/runtimes/kimi-code.js');
  return findKimiWirePathAsync(kimiHome, workspace, sessionId);
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
  const NON_TRANSCRIPT = new Set([
    'acp-session.jsonl',
    'cost-events.jsonl',
    'activity.jsonl',
    'pending-events.jsonl',
  ]);
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
  // Dispatch on the recorded harness so an earlier Claude run cannot shadow Codex.
  const harness = await resolveAgentHarness(agentId, opts);
  const behavior = behaviorForHarness(harness);
  if (behavior.transcriptKind === 'codex-rollout-jsonl') {
    return resolveCodexRolloutPath(agentId, opts);
  }
  if (behavior.transcriptKind === 'ohmypi-jsonl') {
    return resolvePiSessionPath(agentId, opts);
  }
  if (behavior.transcriptKind === 'acp-jsonl') {
    return resolveAcpTranscriptPath(agentId, opts);
  }
  if (behavior.transcriptKind === 'muse-jsonl') return resolveMuseSessionPath(agentId, opts.agentsDirOverride);
  if (behavior.transcriptKind === 'kimi-wire-jsonl') {
    return resolveKimiWirePath(agentId, opts);
  }

  const agentsRoot = opts.agentsDirOverride ?? join(getOverdeckHome(), 'agents');
  const index = await readIndexedSessionIds(join(agentsRoot, agentId));
  const currentSessionId = await resolveClaudeSessionId(agentId, opts);
  const candidates = [...index.ids].reverse();
  if (currentSessionId && !candidates.includes(currentSessionId)) candidates.unshift(currentSessionId);
  const claudeSessionId = candidates[0] ?? null;
  if (!claudeSessionId) {
    logTranscriptResolution(
      agentId,
      `missing-session-id:${harness ?? 'unknown'}`,
      `failed harness=${harness ?? 'unknown'} reason=no-session-id `
        + 'checked=sessions.json,runtime-state',
      opts,
    );
    return null;
  }

  const recordedWorkspace = (await readRecordedState(agentId, opts)).workspace;
  const effectiveWorkspacePath = recordedWorkspace ?? workspacePath;
  const projectsRoot = opts.claudeProjectsDirOverride ?? join(homedir(), '.claude', 'projects');
  const encodedDir = encodeClaudeProjectDir(effectiveWorkspacePath);
  for (const sessionId of candidates) {
    const jsonlPath = join(projectsRoot, encodedDir, `${sessionId}.jsonl`);
    if (await pathExists(jsonlPath)) {
      logTranscriptResolution(
        agentId,
        `resolved:${jsonlPath}`,
        `resolved harness=${harness ?? 'claude-code'} sessionId=${sessionId} path=${jsonlPath}`,
        opts,
      );
      return jsonlPath;
    }
  }
  const jsonlPath = join(projectsRoot, encodedDir, `${claudeSessionId}.jsonl`);
  logTranscriptResolution(
    agentId,
    `missing-jsonl:${jsonlPath}`,
    `failed harness=${harness ?? 'claude-code'} reason=jsonl-missing sessionId=${claudeSessionId} `
      + `workspace=${effectiveWorkspacePath} expectedPath=${jsonlPath}`,
    opts,
  );
  return null;
}
