import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, unlinkSync, statSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { AGENTS_DIR } from './paths.js';
import { createSession, createSessionAsync, killSession, killSessionAsync, sendKeysAsync, sessionExists, sessionExistsAsync, getAgentSessions, getAgentSessionsAsync, capturePane, capturePaneAsync, listPaneValues, listPaneValuesAsync, waitForClaudePrompt } from './tmux.js';
import { initHook, checkHook, generateFixedPointPrompt } from './hooks.js';
import { startWork, completeWork, getAgentCV } from './cv.js';
import type { ComplexityLevel } from './cloister/complexity.js';
import { loadCloisterConfig } from './cloister/config.js';
import { BLANKED_PROVIDER_ENV } from './child-env.js';
import type { ModelId } from './settings.js';
import { getModelId, WorkTypeId } from './work-type-router.js';
import { getProviderForModel, getProviderEnv, setupCredentialFileAuth, clearCredentialFileAuth } from './providers.js';
import { validateProviderHealth } from './provider-health.js';
import { loadConfig as loadYamlConfig } from './config-yaml.js';
import type { NormalizedCavemanConfig } from './config-yaml.js';
import type { AuthMode } from './subscription-types.js';
import { readCavemanVariant } from './caveman/workspace.js';
import { loadConfig } from './config.js';
import { getOpenAIAuthStatus, getOpenAIAuthStatusSync } from './openai-auth.js';
import { getCliproxyClientEnv } from './cliproxy.js';
import { createTrackerFromConfig, createTracker } from './tracker/factory.js';
import type { IssueState } from './tracker/interface.js';
import { findProjectByPath, getIssuePrefix, resolveProjectFromIssue } from './projects.js';
import { appendContinueSessionEntryForIssue } from './vbrief/lifecycle-io.js';
import { generateLauncherScript } from './launcher-generator.js';
import { logAgentLifecycle } from './persistent-logger.js';
import { emitActivityEntry, emitActivityTts } from './activity-logger.js';

const execAsync = promisify(exec);

/**
 * BFS-walk a process subtree rooted at `rootPid` looking for a claude-family
 * runtime (comm == 'claude' or 'claudish'). Returns true if any process in the
 * tree matches, false if the tree exists but no match, false on any error.
 *
 * Used by sendAgentMessage zombie detection. pane_pid is the tmux pane's root
 * process, which is bash for work-agent launchers (`bash launcher.sh`) but
 * claude directly for specialists (`exec claude ...`).
 */
async function hasAgentRuntimeInSubtree(rootPid: string): Promise<boolean> {
  const queue: string[] = [rootPid];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid) || !/^\d+$/.test(pid)) continue;
    seen.add(pid);

    try {
      const { stdout: comm } = await execAsync(`ps -p ${pid} -o comm=`);
      const name = comm.trim();
      if (name === 'claude' || name === 'claudish') return true;
    } catch {
      continue;
    }

    try {
      const { stdout: kids } = await execAsync(`pgrep -P ${pid}`);
      for (const kid of kids.trim().split('\n').filter(Boolean)) {
        queue.push(kid);
      }
    } catch {
      // pgrep exits non-zero when there are no children — not an error.
    }
  }
  return false;
}

export async function getProviderAuthMode(model: string): Promise<AuthMode | undefined> {
  const provider = getProviderForModel(model);
  if (provider.name === 'openai') {
    const { config } = loadYamlConfig();
    const authStatus = await getOpenAIAuthStatus();
    return authStatus.loggedIn
      ? 'subscription'
      : (config.providerAuth?.openai ?? 'api-key');
  }

  if (provider.name === 'google') {
    const { config } = loadYamlConfig();
    return config.providerAuth?.google;
  }

  return undefined;
}

/** Map abstract/future model names to CLIProxy-supported names.
 *  The CLIProxy registry has gpt-5.4 but not gpt-5.4-pro. */
const CLI_PROXY_MODEL_ALIASES: Record<string, string> = {
  'gpt-5.5-pro': 'gpt-5.5',
  'gpt-5.4-pro': 'gpt-5.4',
};

export async function getLaunchModelForModel(model: string): Promise<string> {
  return getClaudishPrefix(model, await getProviderAuthMode(model));
}

export async function getAgentRuntimeBaseCommand(model: string): Promise<string> {
  const provider = getProviderForModel(model);
  const permissionFlags = '--dangerously-skip-permissions --permission-mode bypassPermissions';
  if (provider.compatibility === 'direct') {
    return `claude ${permissionFlags} --model ${model}`;
  }

  // OpenAI subscription → local CLIProxyAPI sidecar exposes an
  // Anthropic-compatible /v1/messages endpoint, so Claude Code can drive
  // gpt-* models directly via ANTHROPIC_BASE_URL (no claudish wrapper).
  // The provider env vars are injected separately by getProviderEnvForModel.
  if (provider.name === 'openai' && (await getProviderAuthMode(model)) === 'subscription') {
    // CLIProxy supports gpt-5.x but not the -pro variant; map aliases to real names.
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[model] ?? model;
    return `claude ${permissionFlags} --model ${resolvedModel}`;
  }

  const routedModel = await getLaunchModelForModel(model);
  return `claudish -i --model ${routedModel} ${permissionFlags}`;
}

/** Known agent ID prefixes — IDs with these prefixes are already normalized */
const AGENT_PREFIXES = ['agent-', 'planning-'];

/** Normalize agent ID: preserve known prefixes, add 'agent-' for bare issue IDs */
export function normalizeAgentId(agentId: string): string {
  if (AGENT_PREFIXES.some(p => agentId.startsWith(p))) {
    return agentId;
  }
  return `agent-${agentId.toLowerCase()}`;
}

/**
 * Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for a model.
 * Reads the current API key from settings so resumed/recovered agents
 * always use the latest key.
 */
export async function getProviderEnvForModel(model: string): Promise<Record<string, string>> {
  const provider = getProviderForModel(model);
  if (provider.name === 'anthropic') return {};

  const { config } = loadYamlConfig();

  // OpenRouter API key is stored in config.yaml under providers.openrouter.api_key
  if (provider.name === 'openrouter') {
    const apiKey = config.apiKeys.openrouter;
    if (apiKey) {
      return getProviderEnv(provider, apiKey);
    }
    throw new Error(`OpenRouter API key not configured. Add your key in Settings → OpenRouter before using model "${model}".`);
  }

  const apiKey = config.apiKeys[provider.name as keyof typeof config.apiKeys];

  if (provider.name === 'openai') {
    const authStatus = await getOpenAIAuthStatus();
    if (authStatus.loggedIn) {
      // Route through the local CLIProxyAPI sidecar using the user's
      // ChatGPT subscription OAuth tokens. Claude Code sees a normal
      // Anthropic-compatible endpoint and never needs an API key.
      return getCliproxyClientEnv();
    }
  }

  if (apiKey) {
    await validateProviderHealth(model, apiKey);
    return getProviderEnv(provider, apiKey);
  }

  if (provider.name === 'openai' && (await getOpenAIAuthStatus()).loggedIn) {
    return getCliproxyClientEnv();
  }

  throw new Error(`No API key configured for ${provider.displayName}. Configure it in Settings before using model "${model}".`);
}

/**
 * Get bash export lines for provider env vars (for use in launcher scripts).
 * Returns empty string for Anthropic models.
 */
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
] as const;

export async function getProviderExportsForModel(model: string): Promise<string> {
  const envVars = await getProviderEnvForModel(model);
  const unsetLines = PROVIDER_ENV_KEYS.map(key => `unset ${key}`);
  const exportLines = Object.entries(envVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`);
  return [...unsetLines, ...exportLines].join('\n') + '\n';
}

/**
 * Build a sanitized env for programmatically spawning `claude`/`claudish`.
 *
 * The dashboard parent process may inherit provider env vars (e.g.
 * ANTHROPIC_BASE_URL pointing at the CLIProxy sidecar) that would mis-route
 * a child process targeting an Anthropic model. Launcher *scripts* strip
 * these via `unset` lines; programmatic spawns must do the same.
 *
 * Returns a copy of `baseEnv` (default: process.env) with all PROVIDER_ENV_KEYS
 * deleted, then overlaid with the correct provider env for `model`.
 */
export async function buildSpawnEnvForModel(
  model: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v === undefined) continue;
    if ((PROVIDER_ENV_KEYS as readonly string[]).includes(k)) continue;
    sanitized[k] = v;
  }
  const providerEnv = await getProviderEnvForModel(model);
  return { ...sanitized, ...providerEnv };
}

/**
 * Get tmux -e flags for provider env vars (for use in tmux new-session).
 * Returns empty string for Anthropic models.
 */
export async function getProviderTmuxFlags(model: string): Promise<string> {
  const envVars = await getProviderEnvForModel(model);
  let flags = '';
  for (const [key, value] of Object.entries(envVars)) {
    flags += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
  }
  return flags;
}

/**
 * claudish prefix mapping: auth mode → provider prefix for OpenAI models.
 *
 * claudish routes models using the provider@model syntax:
 *   oai@model  → OpenAI Direct API (API key auth)
 *   cx@model  → ChatGPT OAuth subscription (PLUS/PRO tiers)
 *   go@model  → Google OAuth CodeAssist
 *
 * cx@ is the ChatGPT subscription prefix (confirmed in claudish v6.12+).
 * Note: cx@ is for ChatGPT OAuth, distinct from oai@ which uses OpenAI API keys.
 */
const CLAUDISH_OPENAI_PREFIX: Record<string, string> = {
  'api-key': 'oai',
  subscription: 'cx',
};

/**
 * Get the claudish prefix for a model based on auth mode.
 *
 * Anthropic models: no prefix (use direct claude CLI).
 * OpenAI models: prefix depends on auth mode (oai@ or cx@).
 * Google models (CodeAssist OAuth): go@ prefix.
 *
 * @param model   Model ID (e.g. 'gpt-5.4', 'claude-sonnet-4-6')
 * @param authMode Auth mode: 'api-key' or 'subscription' (undefined = api-key default)
 * @returns Prefixed model string for claudish, or bare model if not applicable
 */
export function getClaudishPrefix(model: string, authMode?: string): string {
  // Anthropic models — use direct claude CLI, no prefix needed
  if (model.startsWith('claude-')) {
    return model;
  }

  // OpenAI models — prefix depends on auth mode
  if (model.startsWith('gpt-') || model.startsWith('o') && !model.startsWith('ollama')) {
    const prefix = CLAUDISH_OPENAI_PREFIX[authMode ?? 'api-key'] ?? 'oai';
    return `${prefix}@${model}`;
  }

  // Google CodeAssist OAuth — go@ prefix
  if (model.startsWith('gemini-') && authMode === 'subscription') {
    return `go@${model}`;
  }

  // Other providers — return bare model (fallback to default routing)
  return model;
}

// ============================================================================
// Ready Signal Management (PAN-87)
// ============================================================================

/**
 * Get path to agent's ready signal file (written by SessionStart hook)
 */
function getReadySignalPath(agentId: string): string {
  return join(getAgentDir(agentId), 'ready.json');
}

/**
 * Clear ready signal before spawning (clean slate)
 */
function clearReadySignal(agentId: string): void {
  const readyPath = getReadySignalPath(agentId);
  if (existsSync(readyPath)) {
    try {
      unlinkSync(readyPath);
    } catch {
      // Ignore errors - non-critical
    }
  }
}

/**
 * Wait for agent to be ready (async - non-blocking).
 * Primary: ready.json written by SessionStart hook.
 * Fallback: tmux pane shows Claude's interactive prompt indicator.
 * Returns true if ready signal received, false if timeout.
 */
async function waitForReadySignal(agentId: string, timeoutSeconds = 30): Promise<boolean> {
  const readyPath = getReadySignalPath(agentId);

  for (let i = 0; i < timeoutSeconds; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Non-blocking sleep

    if (existsSync(readyPath)) {
      try {
        const content = readFileSync(readyPath, 'utf-8');
        const signal = JSON.parse(content);
        if (signal.ready === true) {
          return true;
        }
      } catch {
        // File exists but invalid - keep waiting
      }
    }

    // Fallback: check tmux pane for Claude's interactive prompt indicator.
    // ready.json is currently not written by any hook (PAN-759), so this is the
    // primary detection path for resumed/fresh-started agents.
    try {
      const pane = await capturePaneAsync(agentId, 200);
      if (pane.includes('bypass permissions on') || pane.includes('⏵⏵')) {
        return true;
      }
    } catch { /* non-fatal — session may not exist yet */ }
  }

  return false;
}

export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  runtime: string;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  stoppedAt?: string;
  /** True when markAgentStopped was called (user-initiated stop). Cleared on
   *  resume. Read by deacon's autoResumeStoppedWorkAgents to distinguish a
   *  deliberate stop from a crash/orphan. */
  stoppedByUser?: boolean;
  branch?: string; // Git branch name for this agent

  // Model routing & handoffs (Phase 4)
  complexity?: ComplexityLevel;
  handoffCount?: number;
  costSoFar?: number;
  sessionId?: string; // For resuming sessions after handoff

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning';
  workType?: WorkTypeId; // Current work type ID

  preSpawnStashRef?: string;
  preSpawnStashMessage?: string;
  preSpawnBaselineHead?: string;
}

export function getAgentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

function parseAgentState(content: string, normalizedId: string): AgentState | null {
  try {
    const state = JSON.parse(content) as AgentState;
    if (!state.id) state.id = normalizedId;
    return state;
  } catch {
    return null;
  }
}

export function getAgentState(agentId: string): AgentState | null {
  const normalizedId = normalizeAgentId(agentId);
  const stateFile = join(getAgentDir(normalizedId), 'state.json');
  if (!existsSync(stateFile)) return null;

  const content = readFileSync(stateFile, 'utf8');
  return parseAgentState(content, normalizedId);
}

export async function getAgentStateAsync(agentId: string): Promise<AgentState | null> {
  const normalizedId = normalizeAgentId(agentId);
  const stateFile = join(getAgentDir(normalizedId), 'state.json');
  if (!existsSync(stateFile)) return null;

  const content = await readFile(stateFile, 'utf-8');
  return parseAgentState(content, normalizedId);
}

export function saveAgentState(state: AgentState): void {
  const dir = getAgentDir(state.id);
  mkdirSync(dir, { recursive: true });

  // Detect status transition for audit trail
  const oldState = getAgentState(state.id);
  const oldStatus = oldState?.status;

  if (state.status === 'running' || state.status === 'starting') {
    delete state.stoppedAt;
  } else if (state.status === 'stopped' && !state.stoppedAt) {
    state.stoppedAt = new Date().toISOString();
  }

  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify(state, null, 2)
  );

  if (oldStatus && oldStatus !== state.status) {
    logAgentLifecycle(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentState)`);
  }
}

function markAgentRunning(state: AgentState): void {
  const oldStatus = state.status;
  state.status = 'running';
  state.lastActivity = new Date().toISOString();
  delete state.stoppedAt;
  // Clear user-stop intent so a later crash/orphan can be auto-resumed. Without
  // this the flag is sticky across the stop→resume→crash sequence and autoResume
  // would permanently skip the agent on any subsequent orphan recovery.
  delete state.stoppedByUser;
  logAgentLifecycle(state.id, `status changed: ${oldStatus} → running (markAgentRunning)`);
}

function markAgentStopped(state: AgentState): void {
  const oldStatus = state.status;
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  state.stoppedByUser = true;
  logAgentLifecycle(state.id, `status changed: ${oldStatus} → stopped (markAgentStopped, user-initiated)`);
}

export function markAgentStoppedState(state: AgentState): AgentState {
  if (!state.id) {
    state.id = normalizeAgentId(state.issueId);
  }
  markAgentStopped(state);
  return state;
}

/** Test-only internals. Do not import outside of test files. */
export const __testInternals = { markAgentRunning, markAgentStopped };

// ============================================================================
// Agent Runtime State (PAN-800: event-sourced, no more runtime.json)
// ============================================================================
//
// Persistence: append-only `events` SQLite table → AgentStateService's
// SubscriptionRef → projection_cache rows keyed 'agent-runtime:<id>'.
//
// Writes: emitAgentEvent POSTs to /api/agents/:id/heartbeat. Reads: in-process
// lib uses getRuntimeSnapshotSync; CLI/out-of-process uses
// getAgentRuntimeSnapshot (HTTP).
//
// The functions below are adapters over AgentRuntimeSnapshot. Each caller
// ideally uses the typed snapshot directly — the adapters exist because
// ~30 call sites across the cloister consumed the old shape and migrating
// every field access in one PR would have been mechanical noise.

import type { AgentRuntimeSnapshot } from '@panctl/contracts';
import {
  getAgentRuntimeSnapshot as fetchAgentRuntimeSnapshot,
  emitAgentEvent,
} from './agent-runtime.js';
import { getRuntimeSnapshotSync, isAgentStateServiceInProcess } from './agent-runtime-mirror.js';

export type AgentResolution = 'working' | 'done' | 'needs_input' | 'stuck' | 'completed' | 'unclear' | 'abandoned';

/** Callers consume this shape; data comes from AgentRuntimeSnapshot. */
export interface AgentRuntimeState {
  // 'suspended' retained for backward-compat with callers that still compare
  // against it defensively. The new event path never emits suspended — PAN-800
  // drops the auto-suspend feature; PAN-188 reintroduces it.
  state: 'active' | 'idle' | 'suspended' | 'stopped' | 'uninitialized' | 'waiting-on-human';
  lastActivity: string;
  currentTool?: string;
  claudeSessionId?: string;
  /**
   * For specialists: the issue currently being processed. Tracked per-agent in
   * the AgentStateService snapshot (see agent.current_issue_set event).
   */
  currentIssue?: string;
  resolution?: AgentResolution;
  resolutionCount?: number;
  resolutionUpdatedAt?: string;
  waitingReason?: string;
  waitingStartedAt?: string;
  waitingNotification?: string;
}

function snapshotToRuntimeState(snap: AgentRuntimeSnapshot | null): AgentRuntimeState | null {
  if (!snap) return null;
  // Map Activity → legacy state. The legacy 'active' value collapses working
  // and thinking — neither consumer ever distinguished them.
  let state: AgentRuntimeState['state'];
  switch (snap.activity) {
    case 'working': state = 'active'; break;
    case 'thinking': state = 'active'; break;
    case 'idle': state = 'idle'; break;
    case 'stopped': state = 'stopped'; break;
    case 'waiting': state = 'waiting-on-human'; break;
    default: state = 'uninitialized';
  }
  return {
    state,
    lastActivity: snap.lastActivity,
    currentTool: snap.currentTool,
    claudeSessionId: snap.claudeSessionId,
    currentIssue: snap.currentIssue,
    resolution: snap.resolution as AgentResolution | undefined,
    resolutionCount: snap.resolutionCount,
    resolutionUpdatedAt: snap.resolutionUpdatedAt,
    waitingReason: snap.waiting?.reason,
    waitingStartedAt: snap.waiting?.startedAt,
    waitingNotification: snap.waiting?.message,
  };
}

export function getAgentRuntimeState(agentId: string): AgentRuntimeState | null {
  // Sync path: read from the in-process mirror (empty in fresh CLI processes,
  // populated inside the dashboard server). CLI commands should prefer
  // getAgentRuntimeStateAsync so they fall through to HTTP.
  return snapshotToRuntimeState(getRuntimeSnapshotSync(agentId));
}

export async function getAgentRuntimeStateAsync(agentId: string): Promise<AgentRuntimeState | null> {
  // In-process (inside the dashboard): the sync mirror is authoritative. Do
  // NOT fall back to HTTP — that would fetch our own server, which may still
  // be inside Layer construction and cause a startup deadlock.
  if (isAgentStateServiceInProcess()) {
    return getAgentRuntimeState(agentId);
  }
  // Cross-process (CLI, external lib callers): sync mirror is empty, hit HTTP.
  const snap = await fetchAgentRuntimeSnapshot(agentId);
  return snapshotToRuntimeState(snap);
}

/**
 * Emit events derived from a legacy-shape patch. Callers gradually migrate to
 * direct emitAgentEvent calls; this adapter keeps existing code working.
 */
export async function saveAgentRuntimeState(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
  if (patch.currentIssue !== undefined) {
    await emitAgentEvent(agentId, {
      kind: 'current_issue_set',
      currentIssue: patch.currentIssue || undefined,
    });
  }

  if (patch.resolution !== undefined && patch.resolutionCount !== undefined) {
    await emitAgentEvent(agentId, {
      kind: 'resolution_set',
      resolution: patch.resolution,
      resolutionCount: patch.resolutionCount,
    });
  }

  if (patch.state !== undefined) {
    if (patch.state === 'waiting-on-human') {
      await emitAgentEvent(agentId, {
        kind: 'waiting_start',
        reason: (patch.waitingReason as 'tool_permission' | 'user_question' | 'disambiguation' | 'other') || 'other',
        message: patch.waitingNotification,
      });
    } else if (patch.state === 'active') {
      await emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool });
    } else if (patch.state === 'idle') {
      await emitAgentEvent(agentId, { kind: 'activity', activity: 'idle' });
    } else if (patch.state === 'stopped') {
      await emitAgentEvent(agentId, { kind: 'activity', activity: 'stopped' });
    }
  } else if (patch.currentTool !== undefined) {
    await emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool });
  }

  if (patch.claudeSessionId) {
    // model_set requires a model — use existing snapshot's model if present.
    const snap = getAgentRuntimeState(agentId);
    if (snap || patch.claudeSessionId) {
      await emitAgentEvent(agentId, {
        kind: 'model_set',
        model: 'unknown',
        claudeSessionId: patch.claudeSessionId,
      });
    }
  }
}

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
 * Get the latest Claude session ID from any available source.
 * Checks session.id first (written by suspend), then sessions.json (written by heartbeat hook),
 * then runtime.json claudeSessionId field.
 */
export function getLatestSessionId(agentId: string): string | null {
  // 1. session.id (written by auto-suspend)
  const fromSessionFile = getSessionId(agentId);
  if (fromSessionFile) return fromSessionFile;

  // 2. sessions.json (written by heartbeat hook — last entry is most recent)
  const sessionsFile = join(getAgentDir(agentId), 'sessions.json');
  try {
    if (existsSync(sessionsFile)) {
      const sessions = JSON.parse(readFileSync(sessionsFile, 'utf8'));
      if (Array.isArray(sessions) && sessions.length > 0) {
        return sessions[sessions.length - 1];
      }
    }
  } catch { /* non-fatal */ }

  // 3. runtime.json claudeSessionId
  const runtimeState = getAgentRuntimeState(agentId);
  if (runtimeState?.claudeSessionId) {
    return runtimeState.claudeSessionId;
  }

  return null;
}

export interface SpawnOptions {
  issueId: string;
  workspace: string;
  runtime?: string;
  model?: string;
  prompt?: string;
  difficulty?: ComplexityLevel;
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning';
  workType?: WorkTypeId; // Explicit work type ID (overrides phase-based detection)

  // Swarm slot support (PAN-970): when set, session name becomes agent-<issueId>-<slotId>
  // and the one-agent-per-issue uniqueness check is scoped to the slot.
  slotId?: number;
  swarmItemId?: string; // vBRIEF item ID this slot is working on
}

/**
 * Build shell export lines to inject into a work agent's launcher.sh.
 *
 * Sets CAVEMAN_DEFAULT_MODE and PANOPTICON_CAVEMAN_VARIANT so the caveman
 * SessionStart hook activates at the right intensity level and cost events
 * carry the A/B test variant.
 *
 * @param workspacePath  Absolute workspace path (to read stored variant)
 * @param config         Normalized caveman config from YamlConfig
 * @param isPlanning     True for planning agents — caveman always disabled there
 * @returns              Shell export lines to prepend to the launcher script
 */
export async function buildCavemanExports(
  workspacePath: string,
  config: NormalizedCavemanConfig,
  isPlanning: boolean
): Promise<string> {
  // Planning agents: never compress — output is user-facing
  if (isPlanning || !config.enabled) return '';

  const variant = await readCavemanVariant(workspacePath);

  // If this workspace's A/B variant is 'disabled', set variant for tracking but no mode
  if (variant === 'off') return '';
  if (variant === 'disabled') {
    return `export PANOPTICON_CAVEMAN_VARIANT="${variant}"\n`;
  }

  // Work agents use the 'work' intensity mode
  const mode = config.modes.work;
  if (mode === 'off' || mode === 'disabled') return '';

  return `export CAVEMAN_DEFAULT_MODE="${mode}"\nexport PANOPTICON_CAVEMAN_VARIANT="${variant}"\n`;
}

/**
 * Determine which model to use for an agent based on configuration
 *
 * New Priority (PAN-118):
 * 1. Explicitly provided model (options.model)
 * 2. Explicit work type ID (options.workType)
 * 3. Work type from phase (options.phase → issue-agent:{phase})
 * 4. Specialist work type (options.agentType → specialist-{type})
 * 5. Complexity-based routing (LEGACY - deprecated)
 * 6. Default fallback (claude-sonnet-4-6)
 */
export function determineModel(options: SpawnOptions): string {
  console.log(`[DEBUG] determineModel called with:`, { model: options.model, workType: options.workType, phase: options.phase, agentType: options.agentType, difficulty: options.difficulty });

  // Explicit model always wins
  if (options.model) {
    console.log(`[DEBUG] Using explicit model: ${options.model}`);
    return options.model;
  }

  try {
    // Use work type router if work type or phase specified
    if (options.workType) {
      return getModelId(options.workType);
    }

    // Map phase to work type ID
    if (options.phase) {
      const workType: WorkTypeId = `issue-agent:${options.phase}` as WorkTypeId;
      return getModelId(workType);
    }

    // Map specialist agent type to work type ID
    if (options.agentType && options.agentType !== 'work-agent') {
      // Specialists: review-agent, test-agent, merge-agent
      const workType: WorkTypeId = `specialist-${options.agentType}` as WorkTypeId;
      return getModelId(workType);
    }

    // LEGACY: Complexity-based routing removed — settings.json no longer exists.
    // All model routing goes through work-type-router via config.yaml.

    // Fall back to default model from Cloister config or claude-sonnet-4-6
    try {
      const cloisterConfig = loadCloisterConfig();
      const defaultModel = cloisterConfig.model_selection?.default_model || 'sonnet';
      const modelMap: Record<string, string> = {
        'opus': 'claude-opus-4-6',
        'sonnet': 'claude-sonnet-4-6',
        'haiku': 'claude-haiku-4-5',
      };
      return modelMap[defaultModel] || 'claude-sonnet-4-6';
    } catch {
      return 'claude-sonnet-4-6';
    }
  } catch (error) {
    // If work type router fails, fall back to default
    console.warn('Warning: Could not resolve model using work type router, using default');
    return options.model || 'claude-sonnet-4-6';
  }
}

/**
 * Shared tracker resolution logic for issue state transitions.
 *
 * Resolution order (by project tracker type):
 * 1. github_repo → GitHub Issues (takes priority over issue_prefix, since projects
 *    like panopticon-cli use GitHub Issues with a prefix, not Linear)
 * 2. rally_project → Rally
 * 3. issue_prefix (no github_repo) → Linear (covers gitlab+linear and pure-linear projects)
 * 4. gitlab_repo only → warn and skip (GitLab doesn't support label-based state transitions)
 *
 * Precedence rationale: issue_prefix was renamed from linear_team but is now also set on
 * GitHub-hosted projects (e.g. issue_prefix: PAN for panopticon-cli GitHub Issues).
 * github_repo must be checked first so GitHub projects don't misroute to Linear.
 */
async function transitionIssueState(issueId: string, state: IssueState, workspacePath?: string): Promise<void> {
  // Guard: bare numeric IDs (no alphabetic prefix, e.g. "484") must never reach
  // any tracker API. Linear's searchIssues("484") would match MIN-484 in the wrong
  // team. Log a warning and skip — the workspace's project must use prefixed IDs.
  if (/^\d+$/.test(issueId)) {
    console.warn(
      `[agents] Skipping ${state} transition for bare numeric ID "${issueId}" — ` +
      `issue IDs must include a project prefix (e.g. PAN-${issueId}). ` +
      `This workspace was likely created before the pan- prefix convention.`
    );
    return;
  }

  // Resolve the project from workspacePath — its configured tracker is authoritative.
  // Every issue MUST belong to a registered project with a tracker configured.
  const projectConfig = workspacePath ? findProjectByPath(workspacePath) : null;
  if (!projectConfig) {
    throw new Error(`Cannot transition ${issueId}: no project config found for workspace ${workspacePath || '(none)'}. Register the project in projects.yaml.`);
  }

  // Project has a GitHub repo — use GitHub Issues tracker.
  // Checked BEFORE issue_prefix because github_repo projects (e.g. panopticon-cli)
  // set issue_prefix for their GitHub Issue prefix (PAN-), not for Linear.
  if (projectConfig.github_repo) {
    const [owner, repo] = projectConfig.github_repo.split('/');
    const tracker = createTracker({ type: 'github', owner, repo });
    await tracker.transitionIssue(issueId, state);
    console.log(`[agents] Transitioned ${issueId} to ${state} via GitHub (${projectConfig.github_repo})`);
    return;
  }

  // Project has a Rally project — use Rally tracker
  if (projectConfig.rally_project) {
    const config = loadConfig();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.rally) {
      throw new Error(`Project ${projectConfig.name} uses Rally (project: ${projectConfig.rally_project}) but no Rally tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'rally');
    await tracker.transitionIssue(issueId, state);
    console.log(`[agents] Transitioned ${issueId} to ${state} via Rally (project: ${projectConfig.rally_project})`);
    return;
  }

  // Project has a Linear team prefix (and no github_repo) — use Linear tracker.
  // This covers: pure-Linear projects and gitlab+Linear projects (e.g. mind-your-now).
  if (getIssuePrefix(projectConfig)) {
    const config = loadConfig();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.linear) {
      throw new Error(`Project ${projectConfig.name} uses Linear (team: ${getIssuePrefix(projectConfig)}) but no Linear tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'linear');
    await tracker.transitionIssue(issueId, state);
    console.log(`[agents] Transitioned ${issueId} to ${state} via Linear (team: ${getIssuePrefix(projectConfig)})`);
    return;
  }

  if (projectConfig.gitlab_repo) {
    console.warn(`[agents] GitLab project detected (${projectConfig.gitlab_repo}) but GitLab does not support ${state} label transitions`);
    return;
  }

  throw new Error(`Project ${projectConfig.name} has no tracker configured (need issue_prefix, github_repo, or rally_project in projects.yaml)`);
}

export async function transitionIssueToInProgress(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_progress', workspacePath);
}

/**
 * Transitions an issue to "in_review" state in the configured issue tracker.
 * Fire-and-forget — logs warnings on failure but never blocks the pipeline.
 */
export async function transitionIssueToInReview(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_review', workspacePath);
}

export interface AgentLaunchConfig {
  launcherContent: string;
  providerEnv: Record<string, string>;
}

export async function buildAgentLaunchConfig(opts: {
  agentId: string;
  model: string;
  workspace: string;
  agentType: 'work' | 'resume';
  resumeSessionId?: string;
  isPlanning?: boolean;
}): Promise<AgentLaunchConfig> {
  const model = opts.model;

  const providerEnv = await getProviderEnvForModel(model);

  const provider = getProviderForModel(model as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuth(provider, opts.workspace);
  } else {
    clearCredentialFileAuth(opts.workspace);
  }

  const providerExports = await getProviderExportsForModel(model);

  if (opts.agentType === 'resume' && opts.resumeSessionId) {
    const launcherContent = generateLauncherScript({
      agentType: 'resume',
      workingDir: opts.workspace,
      changeDir: false,
      setCi: true,
      providerExports,
      baseCommand: 'claude',
      permissionFlags: ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'],
      resumeSessionId: opts.resumeSessionId,
      model: providerExports.includes('ANTHROPIC_BASE_URL') ? model : undefined,
    });
    return { launcherContent, providerEnv };
  }

  const yamlConfig = loadYamlConfig();
  const cavemanExports = await buildCavemanExports(
    opts.workspace,
    yamlConfig.config.caveman,
    opts.isPlanning ?? false,
  );

  const launcherContent = generateLauncherScript({
    agentType: 'work',
    workingDir: opts.workspace,
    changeDir: false,
    setCi: true,
    setTerminalEnv: true,
    providerExports,
    cavemanExports,
    baseCommand: await getAgentRuntimeBaseCommand(model),
  });

  return { launcherContent, providerEnv };
}

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const agentId = options.slotId != null
    ? `agent-${options.issueId.toLowerCase()}-${options.slotId}`
    : `agent-${options.issueId.toLowerCase()}`;

  // Check if already running (scoped to the exact session name, including slot suffix)
  if (await sessionExistsAsync(agentId)) {
    throw new Error(`Agent ${agentId} already running. Use 'pan tell' to message it.`);
  }

  // Initialize hook for this agent (FPP support)
  initHook(agentId);

  // Determine model based on configuration
  const selectedModel = determineModel(options);
  console.log(`[DEBUG] Selected model: ${selectedModel}`);

  // When routing a GPT agent through ChatGPT subscription auth, the local
  // CLIProxyAPI sidecar MUST already be running. We only check — never
  // install/start from here, because spawnAgent is reachable from dashboard
  // route handlers where blocking on curl/tar would freeze the event loop
  // (see PAN-70 / PAN-446 — no blocking I/O in server code).
  if (
    getProviderForModel(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunningAsync } = await import('./cliproxy.js');
    if (!(await isCliproxyRunningAsync())) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription agents route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT agent.',
      );
    }
  }

  // Create state
  const existingState = getAgentState(agentId);
  const state: AgentState = {
    id: agentId,
    issueId: options.issueId,
    workspace: options.workspace,
    runtime: options.runtime || 'claude',
    model: selectedModel,
    status: 'starting',
    startedAt: new Date().toISOString(),
    // Initialize Phase 4 fields (legacy)
    complexity: options.difficulty,
    handoffCount: 0,
    costSoFar: 0,
    // Work type system (PAN-118)
    phase: options.phase,
    workType: options.workType,
    preSpawnStashRef: existingState?.preSpawnStashRef,
    preSpawnStashMessage: existingState?.preSpawnStashMessage,
    preSpawnBaselineHead: existingState?.preSpawnBaselineHead,
  };

  saveAgentState(state);

  // Transition issue tracker to "in progress" immediately so Linear reflects reality
  // while workspace setup continues. Best-effort, don't block agent spawn.
  // Only for work agents, not planning/specialist agents.
  if (!options.agentType || options.agentType === 'work-agent') {
    transitionIssueToInProgress(options.issueId, options.workspace).catch((err) => {
      console.warn(`[agents] Could not transition ${options.issueId} to in_progress: ${err.message}`);
    });
  }

  // For child stories: synthesize feature context from parent feature plan
  // before the agent starts so readFeatureContext has O(1) local access.
  if (!options.agentType || options.agentType === 'work-agent') {
    try {
      const { writeStoryFeatureContext } = await import('./cloister/work-agent-prompt.js');
      await writeStoryFeatureContext(options.workspace, options.issueId);
    } catch (ctxErr: any) {
      console.warn(`[agents] Could not write story feature context for ${options.issueId}: ${ctxErr.message}`);
    }
  }

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork, items } = checkHook(agentId);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(agentId);
    if (fixedPointPrompt) {
      prompt = fixedPointPrompt + '\n\n---\n\n' + prompt;
    }
  }

  // Write prompt to file for complex prompts (avoids shell escaping issues)
  const promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
  if (prompt) {
    writeFileSync(promptFile, prompt);
  }

  // Auto-setup hooks if not configured
  checkAndSetupHooks();

  // Ensure TLDR daemon is running for the workspace (non-blocking, non-fatal)
  try {
    const venvPath = join(options.workspace, '.venv');
    if (existsSync(venvPath)) {
      const { getTldrDaemonService } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonService(options.workspace, venvPath);
      const status = await tldrService.getStatus();
      if (!status.running) {
        await tldrService.start(true);
        console.log(`[${agentId}] Started TLDR daemon for workspace`);
      }
    }
  } catch {
    // Non-fatal — agents degrade to direct file reads if TLDR unavailable
  }

  // Write initial task cache for heartbeat hook
  writeTaskCache(agentId, options.issueId);

  // Clear ready signal before spawning (clean slate for PAN-87 fix)
  clearReadySignal(agentId);

  const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
    agentId,
    model: selectedModel,
    workspace: options.workspace,
    agentType: 'work',
    isPlanning: options.phase === 'planning',
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  writeFileSync(launcherScript, launcherContent, { mode: 0o755 });
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=work-agent | model=${state.model} | source=agents.ts:spawnAgent | session=${agentId} | command="${claudeCmd}"`);

  // Pre-trust workspace directory in Claude Code to avoid the trust prompt
  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(options.workspace);
  } catch { /* non-fatal */ }

  // Configure workspace for GitHub App bot identity (PAN-536)
  // Agents push as panopticon-agent[bot] with short-lived installation tokens
  try {
    const { isGitHubAppConfigured, generateInstallationToken, configureWorkspaceForBot } = await import('./github-app.js');
    if (isGitHubAppConfigured()) {
      const { findProjectByPath } = await import('./projects.js');
      const project = findProjectByPath(resolve(options.workspace, '..', '..'));
      const ghRepo = project?.github_repo;
      if (ghRepo) {
        const [owner, repo] = ghRepo.split('/');
        const { token } = await generateInstallationToken();
        await configureWorkspaceForBot(options.workspace, owner, repo, token);
        console.log(`[${agentId}] Configured workspace for bot push (panopticon-agent[bot])`);
      }
    }
  } catch (err: any) {
    console.warn(`[${agentId}] GitHub App config failed (falling back to SSH): ${err.message}`);
  }

  clearReadySignal(agentId);

  await createSessionAsync(agentId, options.workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV, // Blank stale provider vars inherited by tmux server
      TERM: 'xterm-256color',
      PANOPTICON_AGENT_ID: agentId,
      PANOPTICON_ISSUE_ID: options.issueId,
      PANOPTICON_SESSION_TYPE: options.phase || 'implementation',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      GIT_SEQUENCE_EDITOR: 'false', // Block interactive rebase / squash (agents forbidden from rewriting history)
      ...providerEnv, // Set correct provider env vars (BASE_URL, AUTH_TOKEN, etc.)
    }
  });

  // Send the initial prompt after Claude's interactive prompt is ready.
  // Wait for the session to be ready by polling tmux output for Claude's prompt.
  if (prompt) {
    // Wait for tmux session to exist and Claude to show its prompt
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!(await sessionExistsAsync(agentId))) {
        console.error(`[${agentId}] Tmux session died before becoming ready`);
        break;
      }
      // Try reading ready signal first (fastest path)
      if (existsSync(join(getAgentDir(agentId), 'ready'))) {
        ready = true;
        break;
      }
      // Fallback: check tmux output for Claude's prompt indicator
      try {
        const pane = await capturePaneAsync(agentId, 200);
        if (pane.includes('bypass permissions on') || pane.includes('Claude Code')) {
          ready = true;
          break;
        }
      } catch { /* non-fatal */ }
    }
    if (ready) {
      // Small delay after ready to ensure Claude is fully rendered and accepting input
      await new Promise(r => setTimeout(r, 500));
      await sendKeysAsync(agentId, prompt);
    } else {
      console.error(`[${agentId}] Claude did not become ready within 30s`);
    }
  }

  // Update status
  markAgentRunning(state);
  saveAgentState(state);

  // Track work in CV
  startWork(agentId, options.issueId);

  // Emit activity + TTS so the user knows an agent has started
  const isPlanning = options.phase === 'planning';
  emitActivityEntry({
    source: isPlanning ? 'planning-agent' : 'dashboard',
    level: 'info',
    message: isPlanning
      ? `Planning started for ${options.issueId}`
      : `Work agent started for ${options.issueId}`,
    issueId: options.issueId,
  });
  emitActivityTts({
    utterance: isPlanning
      ? `Planning started for ${options.issueId}`
      : `Work agent started for ${options.issueId}`,
    priority: 2,
    issueId: options.issueId,
  });

  return state;
}

export function listRunningAgents(): (AgentState & { tmuxActive: boolean })[] {
  const tmuxSessions = getAgentSessions();
  const tmuxNames = new Set(tmuxSessions.map(s => s.name));

  const agents: (AgentState & { tmuxActive: boolean })[] = [];

  // Read all agent states
  if (!existsSync(AGENTS_DIR)) return agents;

  const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const state = getAgentState(dir.name);
    if (state) {
      const normalizedId = normalizeAgentId(state.id || dir.name);
      agents.push({
        ...state,
        id: normalizedId,
        tmuxActive: tmuxNames.has(normalizedId),
      });
    }
  }

  return agents;
}

export async function listRunningAgentsAsync(): Promise<(AgentState & { tmuxActive: boolean })[]> {
  const tmuxSessions = await getAgentSessionsAsync();
  const tmuxNames = new Set(tmuxSessions.map(s => s.name));

  const agents: (AgentState & { tmuxActive: boolean })[] = [];

  // Read all agent states
  if (!existsSync(AGENTS_DIR)) return agents;

  const entries = await readdir(AGENTS_DIR).catch(() => [] as string[]);

  await Promise.all(
    entries.map(async (entry) => {
      const state = await getAgentStateAsync(entry);
      if (state) {
        const normalizedId = normalizeAgentId(state.id || entry);
        agents.push({
          ...state,
          id: normalizedId,
          tmuxActive: tmuxNames.has(normalizedId),
        });
      }
    })
  );

  return agents;
}

/**
 * Scan ~/.panopticon/agents/ for state files with bare numeric issueIds
 * (e.g. "484" instead of "PAN-484") and log warnings to stderr.
 *
 * These workspaces were created before the pan- prefix convention and may
 * cause cross-tracker pollution if their in_review transition is triggered.
 * Called once at server startup to surface legacy state files.
 */
export function warnOnBareNumericIssueIds(): void {
  if (!existsSync(AGENTS_DIR)) return;

  const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  const legacy: string[] = [];
  for (const dir of dirs) {
    const state = getAgentState(dir.name);
    if (state?.issueId && /^\d+$/.test(state.issueId)) {
      legacy.push(`${dir.name} (issueId: "${state.issueId}")`);
    }
  }

  if (legacy.length > 0) {
    console.warn(
      `[agents] WARNING: ${legacy.length} agent state file(s) have bare numeric issueIds ` +
      `(created before the pan- prefix convention). These agents will not be able to ` +
      `transition tracker state. Consider removing or updating them:\n` +
      legacy.map(l => `  ~/.panopticon/agents/${l}`).join('\n')
    );
  }
}

export function stopAgent(agentId: string): void {
  const normalizedId = normalizeAgentId(agentId);

  if (sessionExists(normalizedId)) {
    // Capture tmux output before killing so logs remain viewable after stop
    try {
      const output = capturePane(normalizedId, 5000);
      if (output) {
        const agentDir = getAgentDir(normalizedId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'output.log'), output);
      }
    } catch {
      // Non-fatal — best effort log capture
    }

    killSession(normalizedId);
  }

  const state = getAgentState(normalizedId);
  if (state) {
    // Ensure id is set — runtime state files may lack it (PAN-150)
    if (!state.id) state.id = normalizedId;

    markAgentStoppedState(state);
    saveAgentState(state);
  }

  // Also mark runtime.json as stopped so Cloister/Deacon won't auto-restart.
  // state.json and runtime.json are separate files — both must agree the agent
  // was intentionally stopped to prevent race conditions with health check polls.
  console.log(`[agents] Stopping ${normalizedId}: tmux=${sessionExists(normalizedId)} stateStatus=${state?.status ?? 'none'}`);
  saveAgentRuntimeState(normalizedId, {
    state: 'stopped',
    lastActivity: new Date().toISOString(),
  });
}

export async function stopAgentAsync(agentId: string): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  if (await sessionExistsAsync(normalizedId)) {
    try {
      const output = await capturePaneAsync(normalizedId, 5000);
      if (output) {
        const agentDir = getAgentDir(normalizedId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'output.log'), output);
      }
    } catch {
      // Non-fatal — best effort log capture
    }

    await killSessionAsync(normalizedId);
  }

  const state = getAgentState(normalizedId);
  if (state) {
    if (!state.id) state.id = normalizedId;

    markAgentStoppedState(state);
    saveAgentState(state);
  }

  console.log(`[agents] Stopping ${normalizedId} (async): tmux=${await sessionExistsAsync(normalizedId)} stateStatus=${state?.status ?? 'none'}`);
  saveAgentRuntimeState(normalizedId, {
    state: 'stopped',
    lastActivity: new Date().toISOString(),
  });
}

export async function messageAgent(agentId: string, message: string): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  // Check if agent is suspended - auto-resume if so (PAN-80)
  const runtimeState = getAgentRuntimeState(normalizedId);
  if (runtimeState?.state === 'suspended') {
    console.log(`[agents] Auto-resuming suspended agent ${normalizedId} to deliver message`);
    const result = await resumeAgent(normalizedId, message);
    if (!result.success) {
      throw new Error(`Failed to auto-resume agent: ${result.error}`);
    }
    if (result.messageDelivered === false) {
      throw new Error(`Agent resumed but ready signal did not fire — message not delivered. Feedback is in the mail queue.`);
    }
    // Message already sent during resume
    return;
  }

  // Check if agent is stopped — auto-resume to deliver feedback (PAN-367 / PAN-705)
  //
  // IMPORTANT: We delegate to resumeAgent() so we pick up the saved Claude session id
  // (`claude --resume <id>`) instead of fresh-launching with a new, empty session.
  // The previous implementation of this branch called `getAgentRuntimeBaseCommand(model)`
  // and passed an inline "You are resuming work" prompt as a positional argument,
  // which booted Claude Code in a fresh session (ctx 0%) with no memory of the
  // prior conversation, destroying agent continuity every time feedback arrived.
  //
  // We also restart when the tmux session still exists. Planning/work sessions use
  // `remain-on-exit on` so the shell persists after the agent process exits, and
  // sessionExists() returns true for that dead shell. resumeAgent() kills the zombie
  // session before re-creating it.
  const agentState = getAgentState(normalizedId);
  if (agentState && agentState.status === 'stopped') {
    console.log(`[agents] Auto-resuming stopped agent ${normalizedId} to deliver feedback (session exists: ${await sessionExistsAsync(normalizedId)})`);

    const resumeResult = await resumeAgent(normalizedId, message);

    // Save to mail queue regardless so the agent can re-read feedback if needed
    const mailDir = join(getAgentDir(normalizedId), 'mail');
    mkdirSync(mailDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      join(mailDir, `${timestamp}.md`),
      `# Message\n\n${message}\n`
    );

    if (resumeResult.success && resumeResult.messageDelivered !== false) {
      console.log(`[agents] Resumed ${normalizedId} and delivered feedback`);
      return;
    }

    // Resume failed OR message was not delivered (ready signal timed out). Fall back to
    // a fresh launch so feedback is not silently dropped. This path intentionally mirrors
    // spawnAgent's launcher (provider exports + unset of leaked env vars) so the fallback
    // doesn't inherit stale ANTHROPIC_BASE_URL / OPENAI_API_KEY from the parent process.
    if (!resumeResult.success) {
      console.warn(`[agents] Resume failed for ${normalizedId}: ${resumeResult.error} — falling back to fresh launch`);
    } else {
      console.warn(`[agents] Resume succeeded for ${normalizedId} but message not delivered (ready signal timed out) — falling back to fresh launch`);
    }

    const providerEnv = agentState.model ? await getProviderEnvForModel(agentState.model) : {};
    if (agentState.model) {
      const provider = getProviderForModel(agentState.model as ModelId);
      if (provider.authType === 'credential-file') {
        setupCredentialFileAuth(provider, agentState.workspace);
      } else {
        clearCredentialFileAuth(agentState.workspace);
      }
    }

    clearReadySignal(normalizedId);
    if (await sessionExistsAsync(normalizedId)) {
      try { await killSessionAsync(normalizedId); } catch { /* ignore */ }
    }

    const providerExports = await getProviderExportsForModel(agentState.model || 'claude-sonnet-4-6');
    const fallbackLauncher = join(getAgentDir(normalizedId), 'launcher.sh');
    const fallbackContent = generateLauncherScript({
      agentType: 'work',
      workingDir: agentState.workspace,
      changeDir: false,
      setCi: true,
      providerExports,
      baseCommand: await getAgentRuntimeBaseCommand(agentState.model || 'claude-sonnet-4-6'),
    });
    writeFileSync(fallbackLauncher, fallbackContent, { mode: 0o755 });
    await createSessionAsync(normalizedId, agentState.workspace, `bash ${fallbackLauncher}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.phase || 'implementation',
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    });

    markAgentRunning(agentState);
    saveAgentState(agentState);

    const ready = await waitForReadySignal(normalizedId, 30);
    const resumePrompt = `You are resuming work on ${agentState.issueId}. Check .pan/feedback/ for specialist feedback that arrived while you were stopped, then continue working.\n\n${message}`;
    if (ready) {
      await sendKeysAsync(normalizedId, resumePrompt);
      console.log(`[agents] Fallback-restarted ${normalizedId} and delivered feedback`);
    } else {
      console.warn(`[agents] Fallback-restarted ${normalizedId} but ready signal not detected — feedback in mail queue`);
    }

    return;
  }

  // Check if this is a remote agent
  const { loadRemoteAgentState, sendToRemoteAgent } = await import('./remote/remote-agents.js');
  const remoteState = loadRemoteAgentState(normalizedId);
  if (remoteState && remoteState.vmName) {
    console.log(`[agents] Sending message to remote agent ${normalizedId} on ${remoteState.vmName}`);
    await sendToRemoteAgent(normalizedId, remoteState.vmName, message);

    // Also save to mail queue for persistence
    const mailDir = join(getAgentDir(normalizedId), 'mail');
    mkdirSync(mailDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      join(mailDir, `${timestamp}.md`),
      `# Message\n\n${message}\n`
    );
    return;
  }

  if (!(await sessionExistsAsync(normalizedId))) {
    throw new Error(`Agent ${normalizedId} not running`);
  }

  // Guard: if tmux session exists but Claude Code has exited, resume instead
  // of typing the message into a bare bash shell.
  //
  // Launchers differ: specialists `exec claude` so pane_pid IS claude, but
  // work-agent launchers run `bash launcher.sh` so pane_pid is bash and claude
  // runs as a descendant. Walk the pane's process subtree and treat the pane
  // as live if any descendant is a claude runtime.
  const panePids = await listPaneValuesAsync(normalizedId, '#{pane_pid}');
  if (panePids.length > 0 && !(await hasAgentRuntimeInSubtree(panePids[0]))) {
    console.warn(`[agents] ${normalizedId} tmux session is a zombie (no Claude) — attempting resume`);
    const resumeResult = await resumeAgent(normalizedId, message);
    if (resumeResult.success) {
      return;
    }
    throw new Error(`Agent ${normalizedId} session is dead and resume failed: ${resumeResult.error}`);
  }

  // Wait for Claude prompt to be ready before sending — reduces dropped Enter
  // when Claude Code is still initializing or rendering warning banners.
  const promptReady = await waitForClaudePrompt(normalizedId, 5000);
  if (!promptReady) {
    console.warn(`[agents] ${normalizedId} not at ready prompt after 5s — sending message anyway`);
  }

  await sendKeysAsync(normalizedId, message);

  // Also save to mail queue
  const mailDir = join(getAgentDir(normalizedId), 'mail');
  mkdirSync(mailDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(mailDir, `${timestamp}.md`),
    `# Message\n\n${message}\n`
  );
}

/**
 * Resume a suspended agent (PAN-80)
 *
 * Reads saved session ID and creates new tmux session with --resume flag.
 * Optionally sends a message after resuming.
 *
 * Auto-resume triggers:
 * - Specialists: When queued work arrives
 * - Work agents: When message is sent via /work-tell
 */
export async function resumeAgent(agentId: string, message?: string, opts?: { model?: string }): Promise<{ success: boolean; messageDelivered?: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  logAgentLifecycle(normalizedId, `resumeAgent called (message=${message ? 'yes' : 'no'})`);

  // Check runtime state — allow both suspended (auto-suspend) and stopped/idle (manual stop, crash)
  const runtimeState = getAgentRuntimeState(normalizedId);
  const agentState = getAgentState(normalizedId);
  const hasWorkspace = !!agentState?.workspace && existsSync(agentState.workspace);
  const isPlaceholder = !!agentState && agentState.status === 'starting' && typeof agentState.model === 'string' && agentState.model.startsWith('pending-');
  const allowedRuntimeStates = ['suspended', 'idle'];
  const allowedAgentStatuses = ['stopped', 'completed'];

  // Also allow resuming a "running" agent with no live tmux session — this happens after
  // a system crash where tmux was killed but state.json was never updated to 'stopped'.
  const isCrashed = agentState?.status === 'running' && !(await sessionExistsAsync(normalizedId));

  const canResume = (runtimeState && allowedRuntimeStates.includes(runtimeState.state))
    || (agentState && allowedAgentStatuses.includes(agentState.status))
    || isCrashed;

  if (!canResume) {
    const reason = `Cannot resume agent in state: runtime=${runtimeState?.state || 'unknown'}, status=${agentState?.status || 'unknown'}`;
    logAgentLifecycle(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  // Get saved session ID from any available source
  const sessionId = getLatestSessionId(normalizedId);
  if (!sessionId) {
    const reason = 'No saved session ID found — this agent is not resumable. Start a fresh agent instead.';
    logAgentLifecycle(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  if (!agentState || !hasWorkspace || isPlaceholder) {
    const reason = 'Saved Claude session is orphaned because the backing workspace/agent state is missing or placeholder-only. Start a fresh agent instead.';
    logAgentLifecycle(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  // Kill any zombie tmux session (crashed agent left behind)
  if (await sessionExistsAsync(normalizedId)) {
    try {
      await killSessionAsync(normalizedId);
    } catch { /* non-fatal */ }
  }

  // Remove completed marker so the agent can work again
  const completedFile = join(getAgentDir(normalizedId), 'completed');
  if (existsSync(completedFile)) {
    try { unlinkSync(completedFile); } catch { /* non-fatal */ }
  }

  // Append 'resume' session entry to continue state (PAN-946: workspace-44p)
  try {
    if (agentState?.workspace) {
      const issueId = agentState.issueId || normalizedId.replace('agent-', '').toUpperCase();
      const resolved = resolveProjectFromIssue(issueId);
      if (resolved) {
        appendContinueSessionEntryForIssue(resolved.projectPath, issueId, {
          reason: 'resume',
          agentModel: agentState.model || undefined,
        });
      }
    }
  } catch (continueErr: any) {
    console.warn(`[resumeAgent] Failed to append resume entry to continue state (non-fatal): ${continueErr?.message ?? continueErr}`);
  }

  try {
    // Clear ready signal before resuming (clean slate for PAN-87 fix)
    clearReadySignal(normalizedId);

    const model = opts?.model || agentState.model || 'claude-sonnet-4-6';
    if (opts?.model && opts.model !== agentState.model) {
      agentState.model = opts.model;
      saveAgentState(agentState);
    }
    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model,
      workspace: agentState.workspace,
      agentType: 'resume',
      resumeSessionId: sessionId,
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    writeFileSync(launcherScript, launcherContent, { mode: 0o755 });
    const claudeCmd = `bash ${launcherScript}`;

    await createSessionAsync(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.phase || 'implementation',
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    });

    // If there's a message, wait for ready signal then send
    let messageDelivered = false;
    if (message) {
      // Wait for SessionStart hook to signal ready (PAN-87: reliable message delivery)
      const ready = await waitForReadySignal(normalizedId, 30);

      if (ready) {
        // Send message
        await sendKeysAsync(normalizedId, message);
        messageDelivered = true;
      } else {
        console.error('Claude SessionStart hook did not fire during resume, message not sent');
      }
    }

    const resumedAt = new Date().toISOString();
    console.log(`[agents] Resumed ${normalizedId} with Claude session ${sessionId}`);
    logAgentLifecycle(normalizedId, `resumeAgent SUCCESS: sessionId=${sessionId}, messageDelivered=${messageDelivered}`);
    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: resumedAt,
    });

    // Update agent state
    if (agentState) {
      markAgentRunning(agentState);
      saveAgentState(agentState);
    }

    return { success: true, messageDelivered };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycle(normalizedId, `resumeAgent FAILED: ${msg}`);
    return {
      success: false,
      error: `Failed to resume agent: ${msg}`
    };
  }
}

export interface RestartAgentOptions {
  model?: string;
  graceful?: boolean;
  message?: string;
}

export async function restartAgent(
  agentId: string,
  opts: RestartAgentOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const { graceful = true, model: newModel, message } = opts;

  const agentState = getAgentState(normalizedId);
  if (!agentState) {
    return { success: false, error: `Agent ${normalizedId} not found` };
  }
  if (!agentState.workspace || !existsSync(agentState.workspace)) {
    return { success: false, error: `Agent workspace missing: ${agentState.workspace}` };
  }

  logAgentLifecycle(normalizedId, `restartAgent called (graceful=${graceful}, model=${newModel || 'unchanged'})`);

  if (graceful && await sessionExistsAsync(normalizedId)) {
    const warning = 'Restarting in 30s. Update .pan/continue.json now with all progress, decisions, hazards, and resume point.';
    try {
      await sendKeysAsync(normalizedId, warning);
    } catch { /* non-fatal — session may already be dead */ }

    await new Promise(r => setTimeout(r, 30_000));

    const continueFile = join(agentState.workspace, '.pan', 'continue.json');
    if (existsSync(continueFile)) {
      const mtime = statSync(continueFile).mtimeMs;
      const ageMs = Date.now() - mtime;
      if (ageMs > 5 * 60 * 1000) {
        console.warn(`[restartAgent] continue.json is stale (${Math.round(ageMs / 1000)}s old) — proceeding anyway`);
      }
    }
  }

  await stopAgentAsync(normalizedId);

  const effectiveModel = newModel || agentState.model || 'claude-sonnet-4-6';
  if (newModel && newModel !== agentState.model) {
    agentState.model = newModel;
  }
  agentState.status = 'starting';
  saveAgentState(agentState);

  try {
    clearReadySignal(normalizedId);

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: effectiveModel,
      workspace: agentState.workspace,
      agentType: 'work',
      isPlanning: agentState.phase === 'planning',
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    writeFileSync(launcherScript, launcherContent, { mode: 0o755 });
    const claudeCmd = `bash ${launcherScript}`;

    await createSessionAsync(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        TERM: 'xterm-256color',
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.phase || 'implementation',
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        GIT_SEQUENCE_EDITOR: 'false',
        ...providerEnv,
      },
    });

    const prompt = message || `You are resuming work on ${agentState.issueId}. Read .pan/continue.json for context and pick up where you left off.`;
    const ready = await waitForReadySignal(normalizedId, 30);
    if (ready) {
      await new Promise(r => setTimeout(r, 500));
      await sendKeysAsync(normalizedId, prompt);
    } else {
      console.error(`[restartAgent] Claude did not become ready within 30s for ${normalizedId}`);
    }

    markAgentRunning(agentState);
    saveAgentState(agentState);

    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });

    logAgentLifecycle(normalizedId, `restartAgent SUCCESS: model=${effectiveModel}`);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycle(normalizedId, `restartAgent FAILED: ${msg}`);
    return { success: false, error: `Failed to restart agent: ${msg}` };
  }
}

/**
 * Check whether a tmux session has an active Claude Code process.
 * A session may exist with only a bare bash shell after Claude exits.
 */
function isClaudeRunningInSession(sessionName: string): boolean {
  try {
    const panePids = listPaneValues(sessionName, '#{pane_pid}');
    if (panePids.length === 0) return false;
    const panePid = panePids[0]!;
    const comm = execSync(`ps -p ${panePid} -o comm=`, { encoding: 'utf-8' }).trim();
    return comm === 'claude';
  } catch {
    return false;
  }
}

/**
 * Detect crashed agents (state shows running but tmux session is gone)
 */
export function detectCrashedAgents(): AgentState[] {
  const agents = listRunningAgents();
  return agents.filter(
    (agent) => agent.status === 'running' && !agent.tmuxActive
  );
}

/**
 * Recover a crashed agent by restarting it with context
 */
export async function recoverAgent(agentId: string): Promise<AgentState | null> {
  const normalizedId = normalizeAgentId(agentId);
  logAgentLifecycle(normalizedId, 'recoverAgent called');
  const state = getAgentState(normalizedId);

  if (!state) {
    logAgentLifecycle(normalizedId, 'recoverAgent BLOCKED: no state.json');
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  if (!state.workspace || !state.model) {
    const reason = `[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`;
    console.error(reason);
    logAgentLifecycle(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  // Check if already running — session may exist with only a bare shell
  // after Claude exited (zombie session). Kill it and recover.
  if (sessionExists(normalizedId)) {
    if (isClaudeRunningInSession(normalizedId)) {
      return state;
    }
    console.log(`[agents] ${normalizedId} tmux session is a zombie (no Claude process) — killing and recovering`);
    try { killSession(normalizedId); } catch { /* ignore */ }
  }

  // Update crash count in health file
  const healthFile = join(getAgentDir(normalizedId), 'health.json');
  let health = { consecutiveFailures: 0, killCount: 0, recoveryCount: 0 };
  if (existsSync(healthFile)) {
    try {
      health = { ...health, ...JSON.parse(readFileSync(healthFile, 'utf-8')) };
    } catch {}
  }
  health.recoveryCount = (health.recoveryCount || 0) + 1;
  writeFileSync(healthFile, JSON.stringify(health, null, 2));

  // Build recovery prompt
  const recoveryPrompt = generateRecoveryPrompt(state);

  // Get provider env for the agent's model (reads latest API key from settings)
  const providerEnv = state.model ? await getProviderEnvForModel(state.model) : {};

  // For credential-file providers, ensure apiKeyHelper is configured.
  // For all other providers, clear stale apiKeyHelper from previous runs.
  if (state.model) {
    const provider = getProviderForModel(state.model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuth(provider, state.workspace);
    } else {
      clearCredentialFileAuth(state.workspace);
    }
  }

  // Restart the agent with recovery context (YOLO mode - skip permissions)
  const claudeCmd = `${await getAgentRuntimeBaseCommand(state.model)} "${recoveryPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  createSession(normalizedId, state.workspace, claudeCmd, {
    env: {
      PANOPTICON_AGENT_ID: normalizedId,
      PANOPTICON_ISSUE_ID: state.issueId || '',
      PANOPTICON_SESSION_TYPE: state.phase || 'implementation',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      ...providerEnv
    }
  });

  // Update state
  markAgentRunning(state);
  saveAgentState(state);

  logAgentLifecycle(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount}`);
  return state;
}

/**
 * Generate a recovery prompt for a crashed agent
 */
function generateRecoveryPrompt(state: AgentState): string {
  const lines: string[] = [
    '# Agent Recovery',
    '',
    '⚠️ This agent session was recovered after a crash.',
    '',
    '## Previous Context',
    `- Issue: ${state.issueId}`,
    `- Workspace: ${state.workspace}`,
    `- Started: ${state.startedAt}`,
    '',
    '## Recovery Steps',
    '1. Check beads for context: `bd show ' + state.issueId + '`',
    '2. Review recent git commits: `git log --oneline -10`',
    '3. Check hook for pending work: `pan admin fpp check`',
    '4. Resume from last known state',
    '',
    '## FPP Reminder',
    '> "Any runnable action is a fixed point and must resolve before the system can rest."',
    '',
  ];

  // Add FPP work if available
  const { hasWork } = checkHook(state.id);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPrompt(state.id);
    if (fixedPointPrompt) {
      lines.push('---');
      lines.push('');
      lines.push(fixedPointPrompt);
    }
  }

  return lines.join('\n');
}

/**
 * Auto-recover all crashed agents
 */
export async function autoRecoverAgents(): Promise<{ recovered: string[]; failed: string[] }> {
  const crashed = detectCrashedAgents();
  const recovered: string[] = [];
  const failed: string[] = [];

  for (const agent of crashed) {
    try {
      const result = await recoverAgent(agent.id);
      if (result) {
        recovered.push(agent.id);
      } else {
        failed.push(agent.id);
      }
    } catch (error) {
      failed.push(agent.id);
    }
  }

  return { recovered, failed };
}

/**
 * Check if Panopticon hooks are configured, and auto-setup if not
 */
function checkAndSetupHooks(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const hookPath = join(homedir(), '.panopticon', 'bin', 'heartbeat-hook');

  // Check if settings.json exists and has heartbeat hook configured
  if (existsSync(settingsPath)) {
    try {
      const settingsContent = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      const postToolUse = settings?.hooks?.PostToolUse || [];

      const hookConfigured = postToolUse.some((hookConfig: any) =>
        hookConfig.hooks?.some((hook: any) =>
          hook.command === hookPath ||
          hook.command?.includes('panopticon') ||
          hook.command?.includes('heartbeat-hook')
        )
      );

      if (hookConfigured) {
        return; // Already configured
      }
    } catch {
      // Ignore errors, will attempt setup
    }
  }

  // Hooks not configured - run setup silently
  try {
    console.log('Configuring Panopticon heartbeat hooks...');
    // Note: This runs during spawn which is now async, so we can use execAsync
    // But this is called from a sync context in checkAndSetupHooks, so we use fire-and-forget
    exec('pan admin hooks install', (error: Error | null) => {
      if (error) {
        console.warn('⚠ Failed to auto-configure hooks. Run `pan admin hooks install` manually.');
      } else {
        console.log('✓ Heartbeat hooks configured');
      }
    });
  } catch (error) {
    console.warn('⚠ Failed to auto-configure hooks. Run `pan admin hooks install` manually.');
  }
}

/**
 * Write task cache for heartbeat hook to use
 */
function writeTaskCache(agentId: string, issueId: string): void {
  const cacheDir = join(getAgentDir(agentId));
  mkdirSync(cacheDir, { recursive: true });

  const cacheFile = join(cacheDir, 'current-task.json');
  writeFileSync(
    cacheFile,
    JSON.stringify({
      id: issueId,
      title: `Working on ${issueId}`,
      updated_at: new Date().toISOString()
    }, null, 2)
  );
}

