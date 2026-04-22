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
import type { ModelId } from './settings.js';
import { getModelId, WorkTypeId } from './work-type-router.js';
import { getProviderForModel, getProviderEnv, setupCredentialFileAuth, clearCredentialFileAuth } from './providers.js';
import { loadConfig as loadYamlConfig } from './config-yaml.js';
import type { NormalizedCavemanConfig } from './config-yaml.js';
import { readCavemanVariant } from './caveman/workspace.js';
import { loadConfig } from './config.js';
import { getOpenAIAuthStatusSync } from './openai-auth.js';
import { getCliproxyClientEnv } from './cliproxy.js';
import { createTrackerFromConfig, createTracker } from './tracker/factory.js';
import type { IssueState } from './tracker/interface.js';
import { findProjectByPath, getIssuePrefix } from './projects.js';

const execAsync = promisify(exec);

function getProviderAuthMode(model: string): string | undefined {
  const provider = getProviderForModel(model);
  if (provider.name === 'openai') {
    const { config } = loadYamlConfig();
    return getOpenAIAuthStatusSync().loggedIn
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
  'gpt-5.4-pro': 'gpt-5.4',
};

export function getLaunchModelForModel(model: string): string {
  return getClaudishPrefix(model, getProviderAuthMode(model));
}

export function getAgentRuntimeBaseCommand(model: string): string {
  const provider = getProviderForModel(model);
  const permissionFlags = '--dangerously-skip-permissions --permission-mode bypassPermissions';
  if (provider.compatibility === 'direct') {
    return `claude ${permissionFlags} --model ${model}`;
  }

  // OpenAI subscription → local CLIProxyAPI sidecar exposes an
  // Anthropic-compatible /v1/messages endpoint, so Claude Code can drive
  // gpt-* models directly via ANTHROPIC_BASE_URL (no claudish wrapper).
  // The provider env vars are injected separately by getProviderEnvForModel.
  if (provider.name === 'openai' && getProviderAuthMode(model) === 'subscription') {
    // CLIProxy supports gpt-5.4 but not the -pro variant; map aliases to real names.
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[model] ?? model;
    return `claude ${permissionFlags} --model ${resolvedModel}`;
  }

  const routedModel = getLaunchModelForModel(model);
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
export function getProviderEnvForModel(model: string): Record<string, string> {
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
    const authStatus = getOpenAIAuthStatusSync();
    if (authStatus.loggedIn) {
      // Route through the local CLIProxyAPI sidecar using the user's
      // ChatGPT subscription OAuth tokens. Claude Code sees a normal
      // Anthropic-compatible endpoint and never needs an API key.
      return getCliproxyClientEnv();
    }
  }

  if (apiKey) {
    return getProviderEnv(provider, apiKey);
  }

  if (provider.name === 'openai' && getOpenAIAuthStatusSync().loggedIn) {
    return getCliproxyClientEnv();
  }

  throw new Error(`No API key configured for ${provider.displayName}. Configure it in Settings before using model "${model}".`);
}

/**
 * Get bash export lines for provider env vars (for use in launcher scripts).
 * Returns empty string for Anthropic models.
 */
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
] as const;

export function getProviderExportsForModel(model: string): string {
  const envVars = getProviderEnvForModel(model);
  const unsetLines = PROVIDER_ENV_KEYS.map(key => `unset ${key}`);
  const exportLines = Object.entries(envVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`);
  return [...unsetLines, ...exportLines].join('\n') + '\n';
}

/**
 * Get tmux -e flags for provider env vars (for use in tmux new-session).
 * Returns empty string for Anthropic models.
 */
export function getProviderTmuxFlags(model: string): string {
  const envVars = getProviderEnvForModel(model);
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
  branch?: string; // Git branch name for this agent

  // Model routing & handoffs (Phase 4)
  complexity?: ComplexityLevel;
  handoffCount?: number;
  costSoFar?: number;
  sessionId?: string; // For resuming sessions after handoff

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning';
  workType?: WorkTypeId; // Current work type ID

  // SageOx session tracking (PAN-278)
  sageoxSessionPath?: string; // Path to SageOx session folder for parent linking
}

export function getAgentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

export function getAgentState(agentId: string): AgentState | null {
  const stateFile = join(getAgentDir(agentId), 'state.json');
  if (!existsSync(stateFile)) return null;

  const content = readFileSync(stateFile, 'utf8');
  return JSON.parse(content);
}

export async function getAgentStateAsync(agentId: string): Promise<AgentState | null> {
  const stateFile = join(getAgentDir(agentId), 'state.json');
  if (!existsSync(stateFile)) return null;

  const content = await readFile(stateFile, 'utf-8');
  return JSON.parse(content);
}

export function saveAgentState(state: AgentState): void {
  const dir = getAgentDir(state.id);
  mkdirSync(dir, { recursive: true });

  if (state.status === 'running' || state.status === 'starting') {
    delete state.stoppedAt;
  } else if (state.status === 'stopped' && !state.stoppedAt) {
    state.stoppedAt = new Date().toISOString();
  }

  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify(state, null, 2)
  );
}

function markAgentRunning(state: AgentState): void {
  state.status = 'running';
  state.lastActivity = new Date().toISOString();
  delete state.stoppedAt;
}

function markAgentStopped(state: AgentState): void {
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  (state as AgentState & { stoppedByUser?: boolean }).stoppedByUser = true;
}

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

import type { AgentRuntimeSnapshot } from '@panopticon/contracts';
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
function determineModel(options: SpawnOptions): string {
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

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const agentId = `agent-${options.issueId.toLowerCase()}`;

  // Check if already running
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
    && getProviderAuthMode(selectedModel) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('./cliproxy.js');
    if (!isCliproxyRunning()) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription agents route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT agent.',
      );
    }
  }

  // Create state
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
  };

  saveAgentState(state);

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

  // Get provider-specific environment variables (BASE_URL, AUTH_TOKEN)
  const providerEnv = getProviderEnvForModel(selectedModel);

  // Determine auth mode for OpenAI. A live Codex/ChatGPT login always wins.
  const provider = getProviderForModel(selectedModel as ModelId);

  // For credential-file providers (e.g. Kimi Code Plan), configure apiKeyHelper
  // so Claude Code can refresh short-lived tokens dynamically.
  // For all other providers, CLEAR any stale apiKeyHelper from previous runs
  // (e.g. switching from Kimi to Anthropic plan-based auth).
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuth(provider, options.workspace);
  } else {
    clearCredentialFileAuth(options.workspace);
  }

  // Create tmux session and start claude in interactive mode.
  // Previous approach used a positional prompt argument (print mode) which exits after
  // one tool-use cycle on recent Claude Code versions. The fix is to start interactive
  // (no positional prompt), then send the prompt via sendKeysAsync once Claude is ready.
  const providerExports = getProviderExportsForModel(state.model);

  // Build caveman env exports for the launcher script.
  // Planning agents are excluded — their output is user-facing and must remain readable.
  // Inspect agents are excluded because their INSPECTION PASSED/BLOCKED sentinels are
  // parsed by Cloister and must not be compressed.
  const yamlConfig = loadYamlConfig();
  const cavemanExports = await buildCavemanExports(
    options.workspace,
    yamlConfig.config.caveman,
    options.phase === 'planning'
  );

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  const launcherContent = `#!/bin/bash
export CI=1
${providerExports}${cavemanExports}${getAgentRuntimeBaseCommand(state.model)}
`;
  writeFileSync(launcherScript, launcherContent, { mode: 0o755 });
  const claudeCmd = `bash ${launcherScript}`;

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

  // Build SageOx environment variables for session linking (only if project is SageOx-initialized)
  // Derive project root from workspace path: <project-root>/workspaces/<branch>
  const projectRoot = resolve(options.workspace, '..', '..');
  const sageoxEnabled = existsSync(join(projectRoot, '.sageox'));
  const sageoxEnv: Record<string, string> = {};

  if (sageoxEnabled) {
    sageoxEnv.OX_PROJECT_ROOT = projectRoot;

    // Add issue tracking for multi-agent pipelines
    if (options.issueId) {
      sageoxEnv.PAN_ISSUE_ID = options.issueId;
    }
    if (options.phase) {
      sageoxEnv.PAN_PHASE = options.phase;
    }

    // For non-planner agents, find the planner's session path for parent linking
    if (options.phase && options.phase !== 'planning') {
      const plannerAgentId = `agent-${options.issueId.toLowerCase()}`;
      const plannerState = getAgentState(plannerAgentId);
      if (plannerState?.sageoxSessionPath) {
        sageoxEnv.PAN_PARENT_SESSION = plannerState.sageoxSessionPath;
      }
    }
  }

  clearReadySignal(agentId);

  await createSessionAsync(agentId, options.workspace, claudeCmd, {
    env: {
      PANOPTICON_AGENT_ID: agentId,
      PANOPTICON_ISSUE_ID: options.issueId,
      PANOPTICON_SESSION_TYPE: options.phase || 'implementation',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      ...providerEnv, // Add provider-specific env vars (BASE_URL, AUTH_TOKEN, etc.)
      ...sageoxEnv // Add SageOx environment variables
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

  // Transition issue tracker to "in progress" (best-effort, don't block agent spawn)
  // Only for work agents, not planning/specialist agents
  if (!options.agentType || options.agentType === 'work-agent') {
    transitionIssueToInProgress(options.issueId, options.workspace).catch((err) => {
      console.warn(`[agents] Could not transition ${options.issueId} to in_progress: ${err.message}`);
    });
  }

  // For planner agents, capture SageOx session path after it becomes available
  if (sageoxEnabled && options.phase === 'planning') {
    captureSageoxSessionPath(agentId, projectRoot).catch((err) => {
      console.warn(`[agents] Could not capture SageOx session path: ${err.message}`);
    });
  }

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
      agents.push({
        ...state,
        tmuxActive: tmuxNames.has(state.id),
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
        agents.push({
          ...state,
          tmuxActive: tmuxNames.has(state.id),
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

    markAgentStopped(state);
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

    markAgentStopped(state);
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

    const providerEnv = agentState.model ? getProviderEnvForModel(agentState.model) : {};
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

    const providerExports = getProviderExportsForModel(agentState.model || 'claude-sonnet-4-6');
    const fallbackLauncher = join(getAgentDir(normalizedId), 'launcher.sh');
    const fallbackContent = `#!/bin/bash
export CI=1
${providerExports}${getAgentRuntimeBaseCommand(agentState.model || 'claude-sonnet-4-6')}
`;
    writeFileSync(fallbackLauncher, fallbackContent, { mode: 0o755 });
    await createSessionAsync(normalizedId, agentState.workspace, `bash ${fallbackLauncher}`, {
      env: {
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
    const resumePrompt = `You are resuming work on ${agentState.issueId}. Check .planning/feedback/ for specialist feedback that arrived while you were stopped, then continue working.\n\n${message}`;
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
  const panePids = await listPaneValuesAsync(normalizedId, '#{pane_pid}');
  if (panePids.length > 0) {
    try {
      const { stdout: comm } = await execAsync(`ps -p ${panePids[0]} -o comm=`);
      if (comm.trim() !== 'claude') throw new Error('not claude');
    } catch {
      console.warn(`[agents] ${normalizedId} tmux session is a zombie (no Claude) — attempting resume`);
      const resumeResult = await resumeAgent(normalizedId, message);
      if (resumeResult.success) {
        return;
      }
      throw new Error(`Agent ${normalizedId} session is dead and resume failed: ${resumeResult.error}`);
    }
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
export async function resumeAgent(agentId: string, message?: string): Promise<{ success: boolean; messageDelivered?: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);

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
    return {
      success: false,
      error: `Cannot resume agent in state: runtime=${runtimeState?.state || 'unknown'}, status=${agentState?.status || 'unknown'}`
    };
  }

  // Get saved session ID from any available source
  const sessionId = getLatestSessionId(normalizedId);
  if (!sessionId) {
    return {
      success: false,
      error: 'No saved session ID found — this agent is not resumable. Start a fresh agent instead.'
    };
  }

  if (!agentState || !hasWorkspace || isPlaceholder) {
    return {
      success: false,
      error: 'Saved Claude session is orphaned because the backing workspace/agent state is missing or placeholder-only. Start a fresh agent instead.'
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

  try {
    // Clear ready signal before resuming (clean slate for PAN-87 fix)
    clearReadySignal(normalizedId);

    // Get provider env for the agent's model (reads latest API key from settings)
    const providerEnv = agentState.model ? getProviderEnvForModel(agentState.model) : {};

    // For credential-file providers, ensure apiKeyHelper is configured.
    // For all other providers, clear stale apiKeyHelper from previous runs.
    if (agentState.model) {
      const provider = getProviderForModel(agentState.model as ModelId);
      if (provider.authType === 'credential-file') {
        setupCredentialFileAuth(provider, agentState.workspace);
      } else {
        clearCredentialFileAuth(agentState.workspace);
      }
    }

    // Create new tmux session with resume command.
    // Write a launcher.sh that unsets any leaked provider env vars (ANTHROPIC_BASE_URL,
    // ANTHROPIC_AUTH_TOKEN, etc — see PAN-705) and then execs claude --resume. tmux's
    // `-e KEY=VALUE` flag can only SET env, not UNSET — so env cleanup must happen
    // inside the shell tmux spawns. This mirrors the spawnAgent pattern at ~line 806.
    const model = agentState.model || 'claude-sonnet-4-6';
    const providerExports = getProviderExportsForModel(model);
    // Non-Anthropic models route through a proxy (ANTHROPIC_BASE_URL). Without an explicit
    // --model flag, Claude Code defaults to claude-sonnet-4-6 on resume, sending claude
    // requests through the proxy → "unknown provider" 502. Always include --model when
    // providerExports sets ANTHROPIC_BASE_URL so the resumed session uses the correct model.
    const resumeModelFlag = providerExports.includes('ANTHROPIC_BASE_URL') ? ` --model ${model}` : '';
    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    const launcherContent = `#!/bin/bash
export CI=1
${providerExports}exec claude --resume "${sessionId}"${resumeModelFlag} --dangerously-skip-permissions --permission-mode bypassPermissions
`;
    writeFileSync(launcherScript, launcherContent, { mode: 0o755 });
    const claudeCmd = `bash ${launcherScript}`;
    await createSessionAsync(normalizedId, agentState.workspace, claudeCmd, {
      env: {
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
    return {
      success: false,
      error: `Failed to resume agent: ${msg}`
    };
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
export function recoverAgent(agentId: string): AgentState | null {
  const normalizedId = normalizeAgentId(agentId);
  const state = getAgentState(normalizedId);

  if (!state) {
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  if (!state.workspace || !state.model) {
    console.error(`[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`);
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
  const providerEnv = state.model ? getProviderEnvForModel(state.model) : {};

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
  const claudeCmd = `${getAgentRuntimeBaseCommand(state.model)} "${recoveryPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
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
export function autoRecoverAgents(): { recovered: string[]; failed: string[] } {
  const crashed = detectCrashedAgents();
  const recovered: string[] = [];
  const failed: string[] = [];

  for (const agent of crashed) {
    try {
      const result = recoverAgent(agent.id);
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

/**
 * Capture SageOx session path for a planner agent.
 * This is used for parent-child session linking in multi-agent pipelines.
 * Subsequent agents (worker, reviewer, tester, merger) will use this path
 * as their PAN_PARENT_SESSION to link their sessions to the planner's session.
 */
async function captureSageoxSessionPath(agentId: string, projectRoot: string): Promise<void> {
  // Wait for SageOx session to be created by the hook (up to 10 seconds)
  const sessionsDir = join(projectRoot, '.sageox', 'sessions');
  let attempts = 0;
  const maxAttempts = 20;
  const delayMs = 500;

  while (attempts < maxAttempts) {
    // Check if sessions directory exists
    if (existsSync(sessionsDir)) {
      // Find the most recent session directory for this agent
      const sessions = readdirSync(sessionsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => ({
          name: d.name,
          path: join(sessionsDir, d.name),
          mtime: existsSync(join(sessionsDir, d.name, '.recording.json'))
            ? readFileSync(join(sessionsDir, d.name, '.recording.json'), 'utf-8')
            : null
        }))
        .filter(s => {
          // Check if this session belongs to our agent
          if (!s.mtime) return false;
          try {
            const state = JSON.parse(s.mtime);
            return state.agent_id === agentId || state.AgentID === agentId;
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          // Sort by modification time (newest first)
          const aTime = existsSync(join(a.path, '.recording.json'))
            ? (statSync(join(a.path, '.recording.json')).mtimeMs || 0)
            : 0;
          const bTime = existsSync(join(b.path, '.recording.json'))
            ? (statSync(join(b.path, '.recording.json')).mtimeMs || 0)
            : 0;
          return bTime - aTime;
        });

      if (sessions.length > 0) {
        // Update agent state with SageOx session path
        const state = getAgentState(agentId);
        if (state) {
          state.sageoxSessionPath = sessions[0].path;
          saveAgentState(state);
          console.log(`[agents] Captured SageOx session path for ${agentId}: ${sessions[0].path}`);
          return;
        }
      }
    }

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, delayMs));
    attempts++;
  }

  throw new Error(`Could not find SageOx session for ${agentId} after ${maxAttempts * delayMs}ms`);
}
