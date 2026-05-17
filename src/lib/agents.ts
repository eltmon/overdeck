import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, unlinkSync, statSync, rmSync } from 'fs';
import { mkdir, readFile, readdir, writeFile, writeFile as writeFileAsync, mkdir as mkdirAsync, rename as renameAsync } from 'fs/promises';
import { request as httpRequest } from 'node:http';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { AGENTS_DIR } from './paths.js';
import { getClaudePermissionFlagsString, resolvePermissionMode, bypassPrefixForAgentFlag } from './claude-permissions.js';
import { createSession, createSessionAsync, killSession, killSessionAsync, sendKeysAsync, sendRawKeystrokeAsync, sessionExists, sessionExistsAsync, getAgentSessions, getAgentSessionsAsync, capturePane, capturePaneAsync, listPaneValues, listPaneValuesAsync, waitForClaudePrompt } from './tmux.js';
import { initHook, checkHook, generateFixedPointPrompt } from './hooks.js';
import { startWork, completeWork, getAgentCV } from './cv.js';
import { BLANKED_PROVIDER_ENV } from './child-env.js';
import type { ModelId, ComplexityLevel } from './settings.js';
import { getProviderForModel, getProviderEnv, setupCredentialFileAuth, clearCredentialFileAuth } from './providers.js';
import { validateProviderHealth } from './provider-health.js';
import { loadConfig as loadYamlConfig, isClaudeCodeChannelsEnabled, resolveModel } from './config-yaml.js';
import type { NormalizedCavemanConfig } from './config-yaml.js';
import type { AuthMode } from './subscription-types.js';
import { readCavemanVariant } from './caveman/workspace.js';
import { loadConfig } from './config.js';
import { getOpenAIAuthStatus, getOpenAIAuthStatusSync } from './openai-auth.js';
import { getClaudeAuthStatus } from './claude-auth.js';
import { bridgeGeminiAuthToCliproxyAsync, getCliproxyClientEnv } from './cliproxy.js';
import { ensureOpenAICompatibleProxyRunning } from './openai-compatible-proxy.js';
import { createTrackerFromConfig, createTracker } from './tracker/factory.js';
import type { IssueState } from './tracker/interface.js';
import { findProjectByPath, getIssuePrefix, resolveProjectFromIssue } from './projects.js';
import { appendContinueSessionEntryForIssue } from './vbrief/lifecycle-io.js';
import { generateLauncherScript } from './launcher-generator.js';
import { createConversation } from './database/conversations-db.js';
import { logAgentLifecycle } from './persistent-logger.js';
import { emitActivityEntry, emitActivityTts } from './activity-logger.js';
import { BRIDGE_TOKEN_HEADER, readBridgeToken, writeBridgeToken } from './bridge-token.js';
import { canUseHarness } from './harness-policy.js';
import type { RuntimeName } from './runtimes/types.js';
import { createPiFifo, piFifoPaths, writePiCommand, PiNotReady } from './runtimes/pi-fifo.js';
import { assertIssueHasBeads } from './beads-query.js';
import { getWorkspaceStackHealth } from './workspace/stack-health.js';
import { normalizeModelOverride, requireModelOverride, shellQuoteModelId } from './model-validation.js';
import { resolveAutoResumeConfigForIssue } from './cloister/auto-resume-config.js';

const execAsync = promisify(exec);

export type Role = 'plan' | 'work' | 'review' | 'test' | 'ship';

/**
 * Write an agent launcher script atomically. Every agent shares a fixed
 * `launcher.sh` path inside its agent dir, and spawn/resume/restart paths can
 * overlap (e.g. a Deacon recovery racing a manual restart). Writing in place
 * lets one path read a half-written script; write to a unique temp file then
 * rename (atomic on the same filesystem).
 */
async function writeLauncherScriptAtomic(launcherScript: string, content: string): Promise<void> {
  const tmp = `${launcherScript}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, { mode: 0o755 });
  await renameAsync(tmp, launcherScript);
}

/**
 * BFS-walk a process subtree rooted at `rootPid` looking for the Claude Code
 * runtime (comm == 'claude'). Returns true if any process in the tree matches,
 * false if the tree exists but no match, false on any error.
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
      if (name === 'claude') return true;
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

async function getPiLauncherFields(agentId: string, model: string): Promise<{
  harness: 'pi';
  piExtensionPath: string;
  piFifoPath: string;
  piSessionDir: string;
  model: string;
}> {
  const paths = piFifoPaths(agentId);
  await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
  const piExtensionPath = resolve(process.cwd(), 'packages/pi-extension/dist/index.js');
  if (!existsSync(piExtensionPath)) {
    throw new Error(
      `Pi extension not built. Run: cd packages/pi-extension && npm run build\n(expected: ${piExtensionPath})`
    );
  }
  // PAN-1048 review feedback 006 (S1): thread the resolved role/workhorse model
  // through to buildPiCommand. The Pi launcher branch ignores baseCommand and
  // rebuilds from scratch starting with the literal `pi`, so the only way to
  // surface --model is via the launcher config's `model` field. Without this,
  // a Pi-backed role silently fell back to Pi's default model and ignored the
  // configured workhorse model entirely.
  return {
    harness: 'pi',
    piExtensionPath,
    piFifoPath: await createPiFifo(agentId),
    piSessionDir: paths.agentDir,
    model,
  };
}

/**
 * Wait for the Pi work-agent ready marker (`ready.json`) to appear.
 * Pi does not produce the Claude SessionStart hook signal, so resume/restart
 * paths must use this instead of `waitForReadySignal()`.
 */
async function waitForPiAgentReady(agentId: string, timeoutSec = 30): Promise<boolean> {
  const { readyPath } = piFifoPaths(agentId);
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (existsSync(readyPath)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Deliver a prompt to a Pi work agent through the FIFO JSONL command protocol.
 * Pi never reads tmux input — pasting prompts there is a no-op as far as the
 * model is concerned. Throws if Pi never reached readiness within the timeout.
 */
async function writePiAgentPrompt(agentId: string, prompt: string, timeoutSec = 30): Promise<void> {
  const ready = await waitForPiAgentReady(agentId, timeoutSec);
  if (!ready) {
    throw new Error(`Pi agent ${agentId} did not become ready within ${timeoutSec}s`);
  }
  try {
    writePiCommand(agentId, { id: randomUUID(), type: 'prompt', message: prompt });
  } catch (err) {
    if (err instanceof PiNotReady) {
      throw new Error(`Pi agent ${agentId} reader gone before prompt could be delivered: ${err.message}`);
    }
    throw err;
  }
}

async function resolveEffectiveHarness(harness: unknown, model: string): Promise<RuntimeName> {
  const requested: RuntimeName = harness === 'pi' || harness === 'claude-code' ? harness : 'claude-code';
  const decision = canUseHarness(requested, model, await getProviderAuthMode(model));
  return decision.allowed ? requested : 'claude-code';
}

export async function getProviderAuthMode(model: string): Promise<AuthMode | undefined> {
  const provider = getProviderForModel(model);
  if (provider.name === 'anthropic') {
    const authStatus = await getClaudeAuthStatus();
    if (authStatus.hasAnthropicApiKey) return 'api-key';
    return authStatus.loggedIn ? 'subscription' : undefined;
  }

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

/**
 * Build the base command that the launcher will exec for an agent.
 *
 * The `harness` parameter (PAN-636) selects between Claude Code (default)
 * and Pi. When `harness === 'pi'` the function short-circuits to a
 * `pi --mode rpc --model <model>` line; the launcher generator then layers
 * --session-dir, --extension, --no-context-files, and the stdin-from-fifo
 * redirect on top via generateLauncherScript. The `agentName` (PAN-982:
 * --name) and `agentDefinition` (PAN-982: --agent) parameters only apply to the
 * Claude Code path — Pi has no agent-definition system.
 */
export async function getAgentRuntimeBaseCommand(
  model: string,
  agentName?: string,
  agentDefinition?: string,
  harness: 'claude-code' | 'pi' = 'claude-code',
): Promise<string> {
  const validatedModel = requireModelOverride(model);
  const quotedModel = shellQuoteModelId(validatedModel);
  if (harness === 'pi') {
    return `pi --mode rpc --model ${quotedModel}`;
  }


  const provider = getProviderForModel(validatedModel);
  const permissionFlags = getClaudePermissionFlagsString();
  // PAN-982: --name <agentId> creates a human-readable Claude session name discoverable via
  // `claude --resume`.
  const nameFlag = agentName ? ` --name ${agentName}` : '';
  // PAN-982: When agentDefinition is provided, pass it directly to --agent.
  // The agent frontmatter declares permissionMode, tools, and per-agent hooks.
  // Still pass --model when launching with an agent definition so explicit model
  // routing (state.json model, switch-model, cloister settings) wins over any
  // frontmatter default model.
  const agentFlag = agentDefinition ? ` --agent ${agentDefinition}` : '';
  // When the user has opted into full bypass (PAN_YOLO=true or claude.permissionMode=bypass
  // in config), --dangerously-skip-permissions is added on top of --agent. The agent
  // frontmatter's permissionMode: bypassPermissions only bypasses prompts INSIDE cwd —
  // cross-directory reads (e.g. ~/.panopticon/cliproxy/, ~/pan-tts/) still prompt without
  // DSP. The flag is passed through ahead of --agent so it applies before frontmatter is
  // resolved.
  const bypassWithAgent = agentDefinition ? bypassPrefixForAgentFlag() : '';

  // OpenAI subscription → local CLIProxyAPI sidecar exposes an
  // Anthropic-compatible /v1/messages endpoint, so Claude Code can drive
  // gpt-* models directly via ANTHROPIC_BASE_URL (no wrapper process).
  // The provider env vars are injected separately by getProviderEnvForModel.
  if (provider.name === 'openai' && (await getProviderAuthMode(validatedModel)) === 'subscription') {
    // CLIProxy supports gpt-5.x but not the -pro variant; map aliases to real names.
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[validatedModel] ?? validatedModel;
    if (agentDefinition) {
      // CLIProxy: --agent + --model override (frontmatter model: only accepts Anthropic ids).
      return `claude${bypassWithAgent}${agentFlag} --model ${shellQuoteModelId(resolvedModel)}${nameFlag}`;
    }
    return `claude ${permissionFlags} --model ${shellQuoteModelId(resolvedModel)}${nameFlag}`;
  }

  if (agentDefinition) {
    // --model is always passed when state has a resolved model so explicit
    // overrides (state.json model, switch-model, cloister routing) win over
    // the agent frontmatter's default model. Without this, Anthropic-direct
    // launches silently fall back to the frontmatter model and ignore the
    // user's selection — observed when switching PAN-977 to Opus 4.7 left
    // the launcher running Sonnet.
    return `claude${bypassWithAgent}${agentFlag} --model ${quotedModel}${nameFlag}`;
  }
  return `claude ${permissionFlags} --model ${quotedModel}${nameFlag}`;
}

/**
 * Resolve the role's Claude-harness agent-definition path.
 *
 * Returns the file Claude Code's `--agent` flag should load to seed the run
 * with the role's frontmatter (permissions, tools, hooks, default model).
 * Returns `null` when the role does not have a Claude agent definition — for
 * example, the review convoy sub-roles, whose prompts are harness-agnostic
 * templates the orchestrator inlines into the spawn message (see
 * `buildConvoyPrompt` in `src/lib/cloister/review-agent.ts`). Sub-role
 * templates live in `roles/review-<subRole>.md`; they are deliberately not
 * loaded via `--agent` so the same content drives Claude Code, Pi, and
 * future harnesses uniformly and never auto-discovers as an ambient Claude
 * subagent inside a work agent's session.
 *
 * Without a sub-role the return is always the top-level role file; callers
 * can rely on the overload to avoid null-handling on that path.
 */
export function roleAgentDefinitionPath(role: Role): string;
export function roleAgentDefinitionPath(role: Role, subRole: string | undefined): string | null;
export function roleAgentDefinitionPath(role: Role, subRole?: string): string | null {
  if (role === 'review' && subRole) {
    return null;
  }
  return `roles/${role}.md`;
}

/** Build a Claude/Pi base command for role-based runs. */
export async function getRoleRuntimeBaseCommand(
  model: string,
  agentName: string,
  role: Role,
  harness: 'claude-code' | 'pi' = 'claude-code',
  subRole?: string,
): Promise<string> {
  const validatedModel = requireModelOverride(model);
  const quotedModel = shellQuoteModelId(validatedModel);
  if (harness === 'pi') {
    return `pi --mode rpc --model ${quotedModel}`;
  }

  const provider = getProviderForModel(validatedModel);
  const definitionPath = roleAgentDefinitionPath(role, subRole);
  const agentFlag = definitionPath ? ` --agent ${definitionPath}` : '';
  const nameFlag = ` --name ${agentName}`;
  // The convoy sub-roles have no `--agent` definition, so claude won't pick up
  // a frontmatter permissionMode. Fall back to the global Claude permission
  // flags in that case so the run still launches with the user's bypass/plan
  // settings honored.
  const permissionFlags = definitionPath ? '' : ` ${getClaudePermissionFlagsString()}`;
  const bypassWithAgent = definitionPath ? bypassPrefixForAgentFlag() : '';

  const printFlag = role === 'review' && subRole ? ' --print' : '';

  if (provider.name === 'openai' && (await getProviderAuthMode(validatedModel)) === 'subscription') {
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[validatedModel] ?? validatedModel;
    return `claude${bypassWithAgent}${printFlag}${agentFlag}${permissionFlags} --model ${shellQuoteModelId(resolvedModel)}${nameFlag}`;
  }

  return `claude${bypassWithAgent}${printFlag}${agentFlag}${permissionFlags} --model ${quotedModel}${nameFlag}`;
}

/** Known agent ID prefixes — IDs with these prefixes are already normalized */
const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-'];

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

  if (provider.name === 'google') {
    if (!apiKey) {
      throw new Error(`Google API key not configured. Add GOOGLE_API_KEY in Settings → Google or ~/.panopticon.env before using model "${model}".`);
    }

    if (!await bridgeGeminiAuthToCliproxyAsync(apiKey)) {
      throw new Error(`Failed to bridge Google API key into CLIProxy before using model "${model}".`);
    }

    return getCliproxyClientEnv();
  }

  if (provider.name === 'openai') {
    const authStatus = await getOpenAIAuthStatus();
    if (authStatus.loggedIn) {
      // Route through the local CLIProxyAPI sidecar using the user's
      // ChatGPT subscription OAuth tokens. Claude Code sees a normal
      // Anthropic-compatible endpoint and never needs an API key.
      return getCliproxyClientEnv();
    }

    const configuredKey = apiKey || authStatus.hasOpenAIApiKey;
    throw new Error(
      configuredKey
        ? `OpenAI API-key routing is no longer supported for model "${model}" because api.openai.com does not expose an Anthropic-compatible /v1/messages endpoint. Sign in with a Codex/ChatGPT subscription via \`pan admin specialists codex login\` or Dashboard Settings → Codex Login.`
        : `Codex/ChatGPT subscription login required for OpenAI model "${model}". Sign in via \`pan admin specialists codex login\` or Dashboard Settings → Codex Login.`,
    );
  }

  if (apiKey) {
    if (provider.name === 'nous') {
      await ensureOpenAICompatibleProxyRunning();
    }
    await validateProviderHealth(model, apiKey);
    return getProviderEnv(provider, apiKey);
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
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
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
 * Build a sanitized env for programmatically spawning `claude`.
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
  /** Coding-agent harness this agent runs under (PAN-636). */
  harness?: 'claude-code' | 'pi';
  /** Unified role primitive (PAN-1048). */
  role: Role;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  stoppedAt?: string;
  /** True when markAgentStopped was called (user-initiated stop). Cleared on
   *  resume. Read by deacon's autoResumeStoppedWorkAgents to distinguish a
   *  deliberate stop from a crash/orphan. */
  stoppedByUser?: boolean;
  paused?: boolean;
  pausedReason?: string;
  pausedAt?: string;
  troubled?: boolean;
  troubledAt?: string;
  consecutiveFailures?: number;
  firstFailureInRunAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  lastFailureNextRetryAt?: string;
  branch?: string; // Git branch name for this agent
  costSoFar?: number;
  sessionId?: string; // For resuming sessions after handoff

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis';
  workType?: string; // Current work type ID
  preSpawnStashRef?: string;
  preSpawnStashMessage?: string;
  preSpawnBaselineHead?: string;

  /**
   * Whether this work agent was launched with the experimental Claude Code
   * Channels prompt-delivery path enabled. Set at launch time after the
   * eligibility check; never mutated after. Read by deliverAgentMessage to
   * decide whether to attempt the bridge socket before falling back to
   * sendKeysAsync. Absent or false means tmux-only delivery (current default).
   */
  channelsEnabled?: boolean;
  /**
   * Delivery method for agent messages. 'auto' tries channels then falls back
   * to tmux; 'channels' is strict (throws on failure); 'tmux' bypasses
   * channels entirely. When absent, resolved from global settings.
   */
  deliveryMethod?: 'auto' | 'channels' | 'tmux';

  /**
   * Short HEAD sha (8 chars) of the workspace at the moment this role run was
   * spawned. Used by the reactive scheduler's activeRoleRunExists() to detect a
   * stale/zombie role session: if the workspace HEAD has advanced past this
   * marker, the existing session ran against old code and must not block a
   * fresh re-dispatch for the new HEAD. Set for non-work roles in spawnRun.
   */
  roleRunHead?: string;

  /** Review-convoy metadata for server-side reviewer lifecycle monitoring. */
  reviewSubRole?: string;
  reviewRunId?: string;
  reviewOutputPath?: string;
  reviewSynthesisAgentId?: string;
  reviewDeadlineAt?: string;
  reviewMonitorSignaled?: 'ready' | 'failed' | 'timeout';
  hostOverride?: boolean;
}

export function getAgentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

function isRole(value: unknown): value is Role {
  return value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship';
}

function cleanAgentState(raw: AgentState): AgentState {
  return {
    id: raw.id,
    issueId: raw.issueId,
    workspace: raw.workspace,
    harness: raw.harness,
    role: raw.role,
    model: raw.model,
    status: raw.status,
    startedAt: raw.startedAt,
    lastActivity: raw.lastActivity,
    stoppedAt: raw.stoppedAt,
    stoppedByUser: raw.stoppedByUser,
    paused: raw.paused,
    pausedReason: raw.pausedReason,
    pausedAt: raw.pausedAt,
    troubled: raw.troubled,
    troubledAt: raw.troubledAt,
    consecutiveFailures: raw.consecutiveFailures,
    firstFailureInRunAt: raw.firstFailureInRunAt,
    lastFailureAt: raw.lastFailureAt,
    lastFailureReason: raw.lastFailureReason,
    lastFailureNextRetryAt: raw.lastFailureNextRetryAt,
    branch: raw.branch,
    costSoFar: raw.costSoFar,
    sessionId: raw.sessionId,
    preSpawnStashRef: raw.preSpawnStashRef,
    preSpawnStashMessage: raw.preSpawnStashMessage,
    preSpawnBaselineHead: raw.preSpawnBaselineHead,
    roleRunHead: raw.roleRunHead,
    channelsEnabled: raw.channelsEnabled,
    deliveryMethod: raw.deliveryMethod,
    reviewSubRole: raw.reviewSubRole,
    reviewRunId: raw.reviewRunId,
    reviewOutputPath: raw.reviewOutputPath,
    reviewSynthesisAgentId: raw.reviewSynthesisAgentId,
    reviewDeadlineAt: raw.reviewDeadlineAt,
    reviewMonitorSignaled: raw.reviewMonitorSignaled,
    hostOverride: raw.hostOverride,
  };
}

function parseAgentState(content: string, normalizedId: string): AgentState | null {
  try {
    const state = JSON.parse(content) as Partial<AgentState>;
    if (!isRole(state.role)) {
      // Roleless states are invisible to getAgentState; cleanup is handled
      // by warnOnBareNumericIssueIds / dropLegacyAgentStatesMissingRoleAsync.
      return null;
    }
    if (!state.id) state.id = normalizedId;
    return cleanAgentState(state as AgentState);
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
    JSON.stringify(cleanAgentState(state), null, 2)
  );

  if (oldStatus && oldStatus !== state.status) {
    logAgentLifecycle(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentState)`);
  }
}

/**
 * PAN-1048 P1: Async variant of saveAgentState for hot paths reachable from
 * the dashboard event loop (spawnRun is invoked by Effect routes and the
 * reactive Cloister scheduler). Uses fs/promises so we never block the
 * Node event loop on disk I/O. Status-transition audit logging is preserved
 * — `getAgentState` is still synchronous because it's called from synchronous
 * read paths elsewhere; reading once before the write is acceptable here
 * (small file, infrequent transitions).
 */
export async function saveAgentStateAsync(state: AgentState): Promise<void> {
  const dir = getAgentDir(state.id);
  await mkdirAsync(dir, { recursive: true });

  const oldState = await getAgentStateAsync(state.id);
  const oldStatus = oldState?.status;

  if (state.status === 'running' || state.status === 'starting') {
    delete state.stoppedAt;
  } else if (state.status === 'stopped' && !state.stoppedAt) {
    state.stoppedAt = new Date().toISOString();
  }

  await writeFileAsync(
    join(dir, 'state.json'),
    JSON.stringify(cleanAgentState(state), null, 2),
  );

  if (oldStatus && oldStatus !== state.status) {
    logAgentLifecycle(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentStateAsync)`);
  }
}

function clearFailureTrackingFields(state: AgentState): void {
  state.consecutiveFailures = 0;
  delete state.firstFailureInRunAt;
  delete state.lastFailureAt;
  delete state.lastFailureReason;
  delete state.lastFailureNextRetryAt;
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
function applyAgentPaused(state: AgentState, reason?: string): void {
  if (!state.paused) {
    state.pausedAt = new Date().toISOString();
  }
  state.paused = true;
  if (reason === undefined) {
    delete state.pausedReason;
  } else {
    state.pausedReason = reason;
  }
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
export function setAgentPaused(agentId: string, reason?: string): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;

  applyAgentPaused(state, reason);
  saveAgentState(state);
  return true;
}

/** Sets the persistent manual pause gate using async filesystem operations. */
export async function setAgentPausedAsync(agentId: string, reason?: string): Promise<AgentState | null> {
  const state = await getAgentStateAsync(agentId);
  if (!state) return null;

  applyAgentPaused(state, reason);
  await saveAgentStateAsync(state);
  return state;
}

function applyAgentUnpaused(state: AgentState): void {
  delete state.paused;
  delete state.pausedReason;
  delete state.pausedAt;
}

function isAgentPauseClear(state: AgentState): boolean {
  return !state.paused && state.pausedReason === undefined && state.pausedAt === undefined;
}

/** Clears the persistent manual pause gate without spawning the agent. */
export function clearAgentPaused(agentId: string): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;
  if (isAgentPauseClear(state)) return true;

  applyAgentUnpaused(state);
  saveAgentState(state);
  return true;
}

/** Clears the persistent manual pause gate using async filesystem operations. */
export async function clearAgentPausedAsync(agentId: string): Promise<AgentState | null> {
  const state = await getAgentStateAsync(agentId);
  if (!state) return null;
  if (isAgentPauseClear(state)) return state;

  applyAgentUnpaused(state);
  await saveAgentStateAsync(state);
  return state;
}

/** Marks an agent as troubled after repeated resume failures. */
export function markAgentTroubled(agentId: string): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;

  if (!state.troubled) {
    state.troubledAt = new Date().toISOString();
  }
  state.troubled = true;
  saveAgentState(state);
  return true;
}

function isAgentTroubledClear(state: AgentState): boolean {
  return !state.troubled && state.troubledAt === undefined && (state.consecutiveFailures ?? 0) === 0 && state.firstFailureInRunAt === undefined && state.lastFailureAt === undefined && state.lastFailureReason === undefined && state.lastFailureNextRetryAt === undefined;
}

function applyAgentUntroubled(state: AgentState): void {
  delete state.troubled;
  delete state.troubledAt;
  clearFailureTrackingFields(state);
}

/** Clears the troubled gate and its accumulated failure state. */
export function clearAgentTroubled(agentId: string): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;
  if (isAgentTroubledClear(state)) return true;

  applyAgentUntroubled(state);
  saveAgentState(state);
  return true;
}

/** Clears the troubled gate and accumulated failure state using async filesystem operations. */
export async function clearAgentTroubledAsync(agentId: string): Promise<AgentState | null> {
  const state = await getAgentStateAsync(agentId);
  if (!state) return null;
  if (isAgentTroubledClear(state)) return state;

  applyAgentUntroubled(state);
  await saveAgentStateAsync(state);
  return state;
}

function applyAgentFailure(state: AgentState, reason: string): void {
  const config = resolveAutoResumeConfigForIssue(state.issueId);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const firstFailureMs = Date.parse(state.firstFailureInRunAt ?? '');
  const hasValidFirstFailure = Number.isFinite(firstFailureMs);
  const windowElapsed = hasValidFirstFailure
    && nowMs - firstFailureMs > config.troubledWindowMs;

  if (windowElapsed || !hasValidFirstFailure) {
    state.consecutiveFailures = 1;
    state.firstFailureInRunAt = now;
  } else {
    state.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
  }

  const backoffSeconds = config.failureBackoffSchedule[
    Math.min(state.consecutiveFailures - 1, config.failureBackoffSchedule.length - 1)
  ];
  state.lastFailureAt = now;
  state.lastFailureReason = reason;
  state.lastFailureNextRetryAt = new Date(nowMs + backoffSeconds * 1000).toISOString();

  const firstFailureInRunMs = Date.parse(state.firstFailureInRunAt ?? '');
  const shouldMarkTroubled = state.consecutiveFailures >= config.maxConsecutiveFailures
    && Number.isFinite(firstFailureInRunMs)
    && nowMs - firstFailureInRunMs <= config.troubledWindowMs;

  if (shouldMarkTroubled) {
    if (!state.troubled) {
      state.troubledAt = now;
    }
    state.troubled = true;
  }
}

/** Records one failed resume/crash observation for later backoff and troubled gating. */
export function recordAgentFailure(agentId: string, reason: string): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;

  applyAgentFailure(state, reason);
  saveAgentState(state);
  return true;
}

/** Records one failed resume/crash observation using async filesystem operations. */
export async function recordAgentFailureAsync(agentId: string, reason: string): Promise<AgentState | null> {
  const state = await getAgentStateAsync(agentId);
  if (!state) return null;

  applyAgentFailure(state, reason);
  await saveAgentStateAsync(state);
  return state;
}

/** Resets failure tracking after an agent reaches running state. */
export function resetAgentFailureCount(agentId: string): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;
  if ((state.consecutiveFailures ?? 0) === 0 && state.firstFailureInRunAt === undefined && state.lastFailureAt === undefined && state.lastFailureReason === undefined && state.lastFailureNextRetryAt === undefined) return true;

  clearFailureTrackingFields(state);
  saveAgentState(state);
  return true;
}

/** Reports whether the manual pause gate is set for this agent. */
export function isAgentPaused(agentId: string): boolean {
  return getAgentState(agentId)?.paused === true;
}

/** Reports whether the troubled gate is set for this agent. */
export function isAgentTroubled(agentId: string): boolean {
  return getAgentState(agentId)?.troubled === true;
}

/** Update just the delivery method on an agent's state file. */
export async function setAgentDeliveryMethod(
  agentId: string,
  deliveryMethod: 'auto' | 'channels' | 'tmux',
): Promise<void> {
  const state = await getAgentStateAsync(agentId);
  if (!state) return;
  state.deliveryMethod = deliveryMethod;
  await saveAgentStateAsync(state);
}

/**
 * Resolve PANOPTICON_HOME — same fallback semantics as panopticon-bridge.
 */
function panopticonHomeForChannels(): string {
  return process.env.PANOPTICON_HOME ?? join(homedir(), '.panopticon');
}

/**
 * Append a delivery-event log line to the per-agent bridge log. Best-effort.
 */
async function appendChannelDeliveryLog(
  agentId: string,
  entry: { path: 'channel' | 'tmux'; reason?: string; caller?: string },
): Promise<void> {
  try {
    const home = panopticonHomeForChannels();
    const dir = join(home, 'logs');
    await (await import('fs/promises')).mkdir(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      agentId,
      ...entry,
    });
    await (await import('fs/promises')).appendFile(
      join(dir, `bridge-${agentId}.log`),
      `${line}\n`,
      'utf-8',
    );
  } catch {
    // Non-critical
  }
}

/**
 * POST a JSON body to a Unix-domain socket using node:net + a hand-rolled
 * minimal HTTP/1.1 request. Resolves on a 200-class response, rejects on any
 * error including socket-not-found, connection refused, write timeout, or
 * non-2xx status. Kept tiny on purpose: this is a hot path, only one caller,
 * and the whole point of a fallback to tmux is that we do not need a robust
 * HTTP client here.
 */
async function postUnixSocketJson(
  socketPath: string,
  body: unknown,
  timeoutMs: number,
  bridgeToken: string,
): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(body);

  return new Promise((resolveCall, reject) => {
    // Settle exactly once. Without this guard a late idle-timeout or
    // post-response socket error could reject after the response already
    // resolved the promise.
    let settled = false;
    const finishOk = (value: { status: number; body: string }) => {
      if (settled) return;
      settled = true;
      req.setTimeout(0); // cancel the idle timer
      req.removeAllListeners('timeout');
      resolveCall(value);
    };
    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      req.setTimeout(0);
      req.removeAllListeners('timeout');
      reject(err);
    };

    const req = httpRequest(
      {
        socketPath,
        path: '/',
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          [BRIDGE_TOKEN_HEADER]: bridgeToken,
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            finishOk({ status, body: responseBody });
            return;
          }
          finishErr(new Error(`socket POST: status ${status}: ${responseBody.slice(0, 100)}`));
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('socket POST timeout'));
    });
    req.on('error', (err: Error) => {
      finishErr(err);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Single delivery primitive for orchestrator-to-work-agent messages. When the
 * target agent has channelsEnabled set in its state.json AND the per-agent
 * bridge socket exists AND the POST returns 200, the message goes through the
 * bridge and tmux is not involved. In every other case (flag off, state file
 * missing, socket missing, socket POST failure for any reason) the call falls
 * back to sendKeysAsync — the user-visible behaviour is identical to today's
 * tmux-only delivery. Internal callers that today reach for sendKeysAsync to
 * talk to a work agent should call this primitive instead so the eligibility
 * and fallback policy live in one place.
 */
export async function deliverAgentMessage(
  agentId: string,
  message: string,
  caller: string = 'unknown',
  deliveryMethod?: 'auto' | 'channels' | 'tmux',
): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  // Resolve delivery method.
  let resolvedMethod = deliveryMethod;
  if (!resolvedMethod) {
    let channelsEnabled = false;
    try {
      const state = await getAgentStateAsync(normalizedId);
      channelsEnabled = Boolean(state?.channelsEnabled);
      resolvedMethod = state?.deliveryMethod ?? (channelsEnabled ? 'auto' : 'tmux');
    } catch {
      resolvedMethod = 'tmux';
    }
  }

  if (resolvedMethod === 'tmux') {
    await sendKeysAsync(normalizedId, message);
    return;
  }

  // resolvedMethod is 'auto' or 'channels' — attempt channels delivery.
  const socketPath = join(panopticonHomeForChannels(), 'sockets', `agent-${normalizedId}.sock`);
  if (!existsSync(socketPath)) {
    const errMsg = `Channels socket missing for ${normalizedId} (${caller})`;
    if (resolvedMethod === 'channels') {
      throw new Error(`MessageDeliveryFailed: ${errMsg}`);
    }
    // auto mode: log visibly and fallback
    console.error(`[CHANNELS-DELIVERY-FAILED] ${errMsg}`);
    await appendChannelDeliveryLog(normalizedId, {
      path: 'tmux',
      reason: 'socket-missing',
      caller,
    });
    await sendKeysAsync(normalizedId, message);
    return;
  }

  const bridgeToken = readBridgeToken(normalizedId);
  if (!bridgeToken) {
    const errMsg = `Channels bridge token missing for ${normalizedId} (${caller})`;
    if (resolvedMethod === 'channels') {
      throw new Error(`MessageDeliveryFailed: ${errMsg}`);
    }
    console.error(`[CHANNELS-DELIVERY-FAILED] ${errMsg}`);
    await appendChannelDeliveryLog(normalizedId, {
      path: 'tmux',
      reason: 'bridge-token-missing',
      caller,
    });
    await sendKeysAsync(normalizedId, message);
    return;
  }

  try {
    await postUnixSocketJson(
      socketPath,
      { content: message, meta: { caller } },
      2000,
      bridgeToken,
    );
    await appendChannelDeliveryLog(normalizedId, { path: 'channel', caller });
    return;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const errMsg = `Channels socket post failed for ${normalizedId} (${caller}): ${reason}`;
    if (resolvedMethod === 'channels') {
      throw new Error(`MessageDeliveryFailed: ${errMsg}`);
    }
    console.error(`[CHANNELS-DELIVERY-FAILED] ${errMsg}`);
    await appendChannelDeliveryLog(normalizedId, {
      path: 'tmux',
      reason: `socket-post-failed: ${reason}`,
      caller,
    });
    await sendKeysAsync(normalizedId, message);
    return;
  }
}

export async function deliverAgentPermissionDecision(
  agentId: string,
  requestId: string,
  behavior: 'allow' | 'deny',
): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  let state: AgentState | null = null;
  try {
    state = await getAgentStateAsync(normalizedId);
  } catch {
    state = null;
  }

  if (!state?.channelsEnabled) {
    throw new Error(`agent ${normalizedId} is not using Claude channels`);
  }

  const socketPath = join(panopticonHomeForChannels(), 'sockets', `agent-${normalizedId}.sock`);
  if (!existsSync(socketPath)) {
    throw new Error(`bridge socket missing for ${normalizedId}`);
  }

  const bridgeToken = readBridgeToken(normalizedId);
  if (!bridgeToken) {
    throw new Error(`bridge token missing for ${normalizedId}`);
  }

  await postUnixSocketJson(
    socketPath,
    {
      type: 'permission_response',
      requestId,
      behavior,
    },
    2000,
    bridgeToken,
  );

  await appendChannelDeliveryLog(normalizedId, {
    path: 'channel',
    caller: `permission-response:${requestId}:${behavior}`,
  });
}

/**
 * Inputs to the channels eligibility decision. We pass through agentId,
 * SpawnOptions, and the in-construction AgentState so this function can be
 * called from the spawn path without re-reading the state file.
 */
interface ChannelsDecision {
  eligible: boolean;
  reason?: string;
}

/**
 * Decide whether to enable Claude Code Channels for a work-agent launch.
 *
 * Eligibility (all required):
 *   - experimental.claudeCodeChannels is true in the merged config
 *   - the agent is a work agent (specialists/conversations stay on tmux)
 *   - the harness is Claude Code (not Pi or another runtime harness)
 *   - auth provider is Anthropic-direct (excludes Bedrock/Vertex/Foundry)
 *   - the workspace is not running inside a Docker container
 *
 * Logs the decision exactly once with a category prefix so users can see why
 * the bridge did or did not engage. The function is otherwise side-effect
 * free; the caller is responsible for writing the .mcp.json and mutating
 * state.channelsEnabled when eligible is true.
 */
export function decideChannelsForWorkAgent(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): ChannelsDecision {
  const log = (eligible: boolean, reason?: string): void => {
    const tag = eligible ? 'channels:eligible' : `channels:ineligible:${reason ?? 'unknown'}`;
    console.log(`[${agentId}] ${tag}`);
  };

  if (!isClaudeCodeChannelsEnabled()) {
    // Flag-off path is the silent default: no log line, no work. The bead
    // explicitly limits eligibility logs to launches where the flag is on so
    // the signal is meaningful.
    return { eligible: false, reason: 'flag-off' };
  }

  if (state.role !== 'work') {
    log(false, 'not-a-work-agent');
    return { eligible: false, reason: 'not-a-work-agent' };
  }

  if (state.harness !== 'claude-code') {
    log(false, `harness-${state.harness ?? 'unknown'}`);
    return { eligible: false, reason: `harness-${state.harness ?? 'unknown'}` };
  }

  // Auth gate. The Channels capability is gated by Anthropic auth in the
  // compiled Claude Code binary; we only attempt the bridge when the model
  // routes to the anthropic provider.
  const provider = getProviderForModel(state.model as ModelId);
  if (provider.name !== 'anthropic') {
    log(false, `provider-${provider.name}`);
    return { eligible: false, reason: `provider-${provider.name}` };
  }

  if (
    process.env.CLAUDE_CODE_USE_BEDROCK === '1' ||
    process.env.CLAUDE_CODE_USE_VERTEX === '1' ||
    process.env.CLAUDE_CODE_USE_FOUNDRY === '1'
  ) {
    log(false, 'auth-bedrock-vertex-foundry');
    return { eligible: false, reason: 'auth-bedrock-vertex-foundry' };
  }

  // Docker workspace gate. We do not yet share a socket dir between host and
  // container; deferred to a follow-up issue (see hazards H10).
  if (
    process.env.PANOPTICON_DOCKER_WORKSPACE === '1' ||
    process.env.PAN_DOCKER === '1'
  ) {
    log(false, 'docker-not-supported-yet');
    return { eligible: false, reason: 'docker-not-supported-yet' };
  }

  log(true);
  return { eligible: true };
}

/**
 * Write the per-agent MCP config that points claude at the panopticon-bridge
 * stdio server. The path is the workspace-local <workspace>/.pan/agent-mcp.json
 * — one config per agent, never shared, never reused.
 */
export async function writeChannelsBridgeMcpConfig(
  configPath: string,
  agentId: string,
): Promise<void> {
  const fsp = await import('fs/promises');
  await fsp.mkdir(dirname(configPath), { recursive: true });
  // Resolve the bridge entrypoint from the project root. The source file
  // lives in src/lib/channels/ and is executed directly via `bun run`
  // (Bun runs TypeScript without pre-compilation). We must point at the
  // source, not a dist copy, because the build does not copy the bridge
  // script into the bundle output.
  const here = dirname(import.meta.url.replace('file://', ''));
  const projectRoot = join(here, '..', '..');
  const repoBridgePath = join(projectRoot, 'src', 'lib', 'channels', 'panopticon-bridge.ts');
  const mcpConfig = {
    mcpServers: {
      'panopticon-bridge': {
        command: 'bun',
        args: ['run', repoBridgePath],
        env: {
          PANOPTICON_AGENT_ID: agentId,
          PANOPTICON_HOME: process.env.PANOPTICON_HOME ?? join(homedir(), '.panopticon'),
        },
      },
    },
  };
  await fsp.writeFile(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
}

/**
 * Dismiss the dev-channels confirmation TUI dialog rendered by
 * `claude --dangerously-load-development-channels`. The dialog text
 * 'WARNING: Loading development channels' must be on screen before any prompt
 * is delivered, otherwise the channel listener never registers and every
 * early channel push silently falls back to tmux.
 *
 * Polling budget is 20s because cold-start claude with TLDR + Playwright MCP
 * servers attached commonly takes 8–15s to render the first frame; a tighter
 * budget false-negatives. If the dialog is not detected within the timeout,
 * we proceed — the dialog is suppressed in some auth states (e.g. when the
 * binary takes a non-interactive code path), and the launch must not block
 * forever.
 *
 * Uses sendRawKeystrokeAsync intentionally: sendKeysAsync's load-buffer +
 * paste-buffer machinery is for typing message bodies, not for a single
 * Enter on a TUI prompt where mistimed paste can fire before the dialog
 * accepts input.
 *
 * Once the dialog is detected we send Enter and KEEP checking — a single
 * keystroke can be dropped if the TUI is still mid-render, which left the
 * dialog on screen with the helper already returned. We re-send Enter every
 * RESEND_INTERVAL_MS until the needle is gone (bounded by DISMISS_BUDGET_MS).
 */
export async function dismissDevChannelsDialog(agentId: string): Promise<void> {
  const TIMEOUT_MS = 20_000;
  const POLL_INTERVAL_MS = 200;
  const RESEND_INTERVAL_MS = 150;
  const DISMISS_BUDGET_MS = 5_000;
  const NEEDLE = 'WARNING: Loading development channels';
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const pane = await capturePaneAsync(agentId, 50);
      if (pane.includes(NEEDLE)) {
        // Dialog is up. Send Enter, then keep re-sending until the needle
        // clears — the first keystroke can land before the TUI is ready to
        // accept it, leaving the dialog stuck on screen.
        const dismissStart = Date.now();
        while (Date.now() - dismissStart < DISMISS_BUDGET_MS) {
          await sendRawKeystrokeAsync(agentId, 'C-m', 'channels:dismiss-dev-dialog');
          await new Promise((r) => setTimeout(r, RESEND_INTERVAL_MS));
          const after = await capturePaneAsync(agentId, 50).catch(() => '');
          if (!after.includes(NEEDLE)) return;
        }
        console.log(`[${agentId}] channels:dismiss:dialog-still-present-after-budget`);
        return;
      }
    } catch {
      // Capture failures are transient (tmux session not yet visible to
      // the new pane); keep polling within the budget.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.log(`[${agentId}] channels:dismiss:dialog-not-detected`);
}

function markAgentRunning(state: AgentState): void {
  const oldStatus = state.status;
  state.status = 'running';
  state.lastActivity = new Date().toISOString();
  clearFailureTrackingFields(state);
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
  /** Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted. */
  harness?: 'claude-code' | 'pi';
  model?: string;
  prompt?: string;
  role?: 'work';
  difficulty?: ComplexityLevel;
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis';
  workType?: string; // Explicit work type ID (overrides phase-based detection)

  // Swarm slot support (PAN-970): when set, session name becomes agent-<issueId>-<slotId>
  // and the one-agent-per-issue uniqueness check is scoped to the slot.
  slotId?: number;
  swarmItemId?: string; // vBRIEF item ID this slot is working on
  allowHost?: boolean;
}

export interface SpawnRunOptions {
  workspace?: string;
  harness?: 'claude-code' | 'pi';
  model?: string;
  prompt?: string;
  agentId?: string;
  /**
   * Sub-role within the review convoy (PAN-1059).
   * When set alongside role='review', each convoy reviewer gets its own
   * isolated tmux session using the code-review-<subRole> agent definition.
   * Values: 'security' | 'correctness' | 'performance' | 'requirements'
   */
  subRole?: string;
  /**
   * Review convoy wiring (PAN-977). When spawning a review sub-role, the
   * synthesis agent id and the reviewer's output path are passed in up front
   * so the generated launcher can own the REVIEWER_READY/FAILED/TIMEOUT signal
   * deterministically on process exit. Persisted onto AgentState too.
   */
  reviewSynthesisAgentId?: string;
  reviewOutputPath?: string;
  allowHost?: boolean;
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
 * Determine which model to use for a role-based work agent.
 *
 * Priority:
 * 1. Explicitly provided model (options.model)
 * 2. Role routing via config.yaml roles/workhorses (defaults to work)
 *
 * Resolution failures propagate as spawn-time errors. Per PAN-1048 PRD:
 * invalid workhorse references and unresolved role configs must fail loudly
 * at config-load/spawn time, not silently fall back to a hidden default
 * model. Defaults are seeded into the config when entries are absent
 * (DEFAULT_WORKHORSES / DEFAULT_ROLES) — anything that still raises here
 * is a real configuration bug the user must see.
 */
export function determineModel(options: { model?: string; role?: Role } = {}): string {
  const modelOverride = normalizeModelOverride(options.model);
  if (modelOverride) {
    return modelOverride;
  }

  return requireModelOverride(resolveModel(options.role ?? 'work', undefined, loadYamlConfig().config));
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
  role: Role;
  spawnMode?: 'resume';
  resumeSessionId?: string;
  isPlanning?: boolean;
  /** Per-agent .mcp.json path for the experimental Channels bridge. */
  channelsBridgeMcpConfig?: string;
  /** MCP server name to load as a Channel; defaults to 'panopticon-bridge'. */
  channelsBridgeServerName?: string;
  /**
   * Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted —
   * preserves bit-for-bit pre-PAN-636 behavior. When 'pi', the launcher is
   * built via the Pi command-line generator instead of the claude path; opts
   * like agentId-as-name and agent-frontmatter are ignored because Pi has
   * no agent-definition system.
   */
  harness?: 'claude-code' | 'pi';
}): Promise<AgentLaunchConfig> {
  const model = requireModelOverride(opts.model);

  // Substrate guard: inject permission deny rules for Panopticon infrastructure
  // paths (.claude/agents/, .claude/hooks/, ~/.panopticon/, JSONL session dirs)
  // into the workspace's .claude/settings.local.json. Idempotent. Without this
  // a vBRIEF action like "delete the legacy pan-*-agent.md files" can convince
  // an agent to brick its own runtime. PAN-1048 X1 incident, 2026-05-09.
  try {
    const { injectPanopticonInfraDeny } = await import('./claude-settings-overlay.js');
    await injectPanopticonInfraDeny(opts.workspace);
  } catch (err) {
    console.warn(`[agents] injectPanopticonInfraDeny failed for ${opts.agentId} (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  const providerEnv = await getProviderEnvForModel(model);

  const provider = getProviderForModel(model as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuth(provider, opts.workspace);
  } else {
    clearCredentialFileAuth(opts.workspace);
  }

  const providerExports = await getProviderExportsForModel(model);

  // PAN-1048: resume/restart launchers must respect the agent's role.
  // A resumed review/test/ship run loads the wrong frontmatter (and wrong
  // tool permissions) if it always points at roles/work.md.
  const launchRole: Role = opts.isPlanning ? 'plan' : opts.role;

  // PAN-1055: pi harness needs --session-dir + fifo redirect threaded into
  // the launcher; getPiLauncherFields() resolves them from the agent state
  // and they're spread into generateLauncherScript() below.
  const piLauncherFields = opts.harness === 'pi'
    ? await getPiLauncherFields(opts.agentId, model)
    : {};

  if (opts.spawnMode === 'resume' && opts.resumeSessionId) {
    // Resume sessions adopt the role definition via --agent.
    // Permissions/model/tools/hooks come from roles/<role>.md frontmatter.
    // --name <agentId> gives the resumed Claude session a human-readable handle.
    //
    // The frontmatter's permissionMode: bypassPermissions only bypasses prompts
    // INSIDE cwd. Tools that touch siblings of cwd (e.g. bd reading
    // .beads/issues.jsonl through git subprocesses, pan reading
    // ~/.panopticon/...) still hit "Do you want to proceed?" without DSP.
    // Mid-Bash dialog dismissals (deacon nudge, paste-buffer write, sibling
    // hook output) cancel the in-flight tool call and surface as
    // `Interrupted · What should Claude do instead?` (PAN-1024 reproduced
    // this loop on every fresh resume of PAN-1044/PAN-934).
    //
    // Match the fresh-spawn path: when permissionMode resolves to 'bypass'
    // (PAN_YOLO=true OR claude.permissionMode=bypass in config), prepend
    // --dangerously-skip-permissions on resume too.
    // Use the shared helper so the only string literal for DSP lives in
    // claude-permissions.ts (see scripts/lint-permissions.sh allowlist).
    // bypassPrefixForAgentFlag returns ' --dangerously-skip-permissions' (leading
    // space) or ''; the resume command needs it as a TRAILING-space token, so
    // re-trim and re-append.
    const bypassPrefix = bypassPrefixForAgentFlag();
    const bypassFlag = bypassPrefix ? `${bypassPrefix.trim()} ` : '';
    const launcherContent = generateLauncherScript({
      role: launchRole,
      spawnMode: 'resume',
      workingDir: opts.workspace,
      changeDir: false,
      setCi: true,
      providerExports,
      // PAN-1048 + PAN-1055: claude-code resumes load the role-specific
      // frontmatter (roleAgentDefinitionPath); pi resumes route through
      // getAgentRuntimeBaseCommand which short-circuits to the pi rpc form.
      baseCommand: opts.harness === 'pi'
        ? await getAgentRuntimeBaseCommand(model, opts.agentId, launchRole, 'pi')
        : `claude ${bypassFlag}--agent ${roleAgentDefinitionPath(launchRole)}`,
      resumeSessionId: opts.resumeSessionId,
      model: opts.harness === 'pi' || providerExports.includes('ANTHROPIC_BASE_URL') ? model : undefined,
      extraArgs: opts.harness === 'pi' ? undefined : `--name ${opts.agentId}`,
      ...piLauncherFields,
    });
    return { launcherContent, providerEnv };
  }

  const yamlConfig = loadYamlConfig();
  const cavemanExports = await buildCavemanExports(
    opts.workspace,
    yamlConfig.config.caveman,
    opts.isPlanning ?? false,
  );

  // PAN-982: pass the role definition path + agentId through getAgentRuntimeBaseCommand so it
  // emits 'claude --agent roles/<role>.md --name <agentId>'.
  // PAN-636: when harness === 'pi' the helper short-circuits to a pi --mode rpc
  // line and the agentName/agentDefinition arguments are ignored (Pi has no agent
  // definitions). The launcher generator's pi branch then layers --session-dir
  // and the fifo redirect on top.
  const agentDefinition = roleAgentDefinitionPath(launchRole);
  const launcherContent = generateLauncherScript({
    role: launchRole,
    workingDir: opts.workspace,
    changeDir: false,
    setCi: true,
    setTerminalEnv: true,
    providerExports,
    cavemanExports,
    baseCommand: await getAgentRuntimeBaseCommand(model, opts.agentId, agentDefinition, opts.harness ?? 'claude-code'),
    ...piLauncherFields,
    ...(opts.channelsBridgeMcpConfig
      ? {
          channelsBridgeMcpConfig: opts.channelsBridgeMcpConfig,
          channelsBridgeServerName: opts.channelsBridgeServerName ?? 'panopticon-bridge',
        }
      : {}),
  });

  return { launcherContent, providerEnv };
}

function defaultRunWorkspace(issueId: string): string {
  const project = resolveProjectFromIssue(issueId);
  if (!project) {
    throw new Error(`Cannot spawn role run for ${issueId}: no project is configured for this issue prefix`);
  }
  return join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

function runAgentId(issueId: string, role: Role, subRole?: string): string {
  const base = role === 'work'
    ? `agent-${issueId.toLowerCase()}`
    : `agent-${issueId.toLowerCase()}-${role}`;
  return subRole ? `${base}-${subRole}` : base;
}

/**
 * Spawn a role-based Panopticon run. Work delegates to the existing work-agent
 * path; review/test/ship use the role definition files under roles/.
 */
/**
 * Review sub-role wall-clock budget (PAN-977). Mirrors REVIEWER_TIMEOUT_MS in
 * cloister/review-agent.ts (20 minutes). Kept as a local constant rather than
 * an import to avoid an agents.ts ↔ review-agent.ts module cycle.
 */
const REVIEW_SUBROLE_TIMEOUT_SECONDS = 20 * 60;

export async function assertWorkspaceStackHealthyForSpawn(
  issueId: string,
  role: Role,
  allowHost = false,
  workspacePath?: string,
): Promise<void> {
  if (role === 'plan') return;

  const health = await getWorkspaceStackHealth(issueId, { workspacePath });
  if (health.healthy) return;

  const normalizedIssue = issueId.toUpperCase();
  const details = health.reasons.join('; ');
  const message = `Workspace docker stack for ${normalizedIssue} is not healthy: ${details}. Run 'pan workspace rebuild ${normalizedIssue}' or retry with --host to override.`;

  if (allowHost) {
    console.warn(`[agents] ${message}`);
    emitActivityEntry({
      source: role,
      level: 'warn',
      issueId: normalizedIssue,
      message: `agent-spawn-host-override: ${normalizedIssue}`,
      details,
    });
    return;
  }

  emitActivityEntry({
    source: role,
    level: 'error',
    issueId: normalizedIssue,
    message: `agent-spawn-blocked-stack-unhealthy: ${normalizedIssue}`,
    details,
  });
  throw new Error(message);
}

export async function spawnRun(issueId: string, role: Role, options: SpawnRunOptions = {}): Promise<AgentState> {
  const workspace = options.workspace ?? defaultRunWorkspace(issueId);
  const selectedModel = determineModel({ model: options.model, role });

  if (role === 'work') {
    return spawnAgent({
      issueId,
      workspace,
      harness: options.harness,
      model: selectedModel,
      prompt: options.prompt,
      role: 'work',
      allowHost: options.allowHost,
    });
  }

  const agentId = options.agentId ?? runAgentId(issueId, role, options.subRole);
  if (await sessionExistsAsync(agentId)) {
    throw new Error(`Role run ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(issueId, role, options.allowHost, workspace);

  initHook(agentId);

  // PAN-1048 C5: Resolve the harness for this role from config.roles[role].harness
  // before falling back to claude-code. Explicit options.harness takes precedence
  // (used by the dashboard run picker), then config, then default. Without this
  // step, every role spawned through spawnRun ignored the per-role harness slot
  // surfaced in the Settings UI.
  //
  // PAN-1048 review feedback 005 (C4): every spawn entry point must pass the
  // requested harness through canUseHarness() before persisting or launching
  // (harness-policy.ts:3-6). resolveEffectiveHarness() collapses the requested
  // harness to claude-code when the policy gate (e.g. Pi + Anthropic
  // subscription auth, a ToS violation) blocks it, so a config-level
  // `roles.work.harness: pi` cannot silently bypass the gate just because the
  // model+auth combination is illegal.
  const requestedHarness: 'claude-code' | 'pi' = options.harness
    ?? loadYamlConfig().config.roles?.[role]?.harness
    ?? 'claude-code';
  const resolvedHarness: 'claude-code' | 'pi' = await resolveEffectiveHarness(requestedHarness, selectedModel);

  if (
    getProviderForModel(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunningAsync } = await import('./cliproxy.js');
    if (!(await isCliproxyRunningAsync())) {
      throw new Error(
        'CLIProxyAPI sidecar is not running. GPT subscription role runs route through '
        + 'a local cliproxy process managed by `pan up`. Run `pan up` (or restart the '
        + 'dashboard) before spawning a GPT role run.',
      );
    }
  }

  const state: AgentState = {
    id: agentId,
    issueId,
    workspace,
    harness: resolvedHarness,
    role,
    model: selectedModel,
    status: 'starting',
    startedAt: new Date().toISOString(),
    costSoFar: 0,
    hostOverride: options.allowHost || undefined,
  };
  // PAN-1048 P1: spawnRun is on the dashboard hot path (Effect routes,
  // reactive Cloister scheduler). All disk I/O here uses async fs/promises
  // so we never block the Node event loop.
  await saveAgentStateAsync(state);

  let promptFile: string | undefined;
  if (options.prompt) {
    promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
    await writeFileAsync(promptFile, options.prompt);
  }

  checkAndSetupHooks();

  const provider = getProviderForModel(selectedModel as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuth(provider, workspace);
  } else {
    clearCredentialFileAuth(workspace);
  }

  const providerExports = await getProviderExportsForModel(selectedModel);
  const providerEnv = await getProviderEnvForModel(selectedModel);

  // PAN-1048 review feedback 005 (S1): when the resolved harness is Pi, thread
  // the per-agent Pi launcher fields (--session-dir, --extension, FIFO
  // redirect) through generateLauncherScript so the role launcher emits the
  // correct `pi --mode rpc` command instead of a malformed Claude command.
  // Without this, a config'd `roles.review.harness: pi` produced a launcher
  // that silently fell back to Claude shape.
  const piLauncherFields = resolvedHarness === 'pi'
    ? await getPiLauncherFields(agentId, selectedModel)
    : {};

  // Create a conversation record for every specialist role — sub-role reviewers,
  // the review orchestrator/synthesizer, test, and ship. The row is the index
  // the dashboard reads to (a) locate the JSONL via claude_session_id, (b) carry
  // pre-JSONL state (spawn_error, fork_status), and (c) let the
  // conversation-lifecycle service compute sessionAlive from real tmux liveness
  // instead of from the agent state machine's status field, which can lag.
  // Excluding the orchestrator here previously forced AgentOutputPanel to
  // synthesize a Conversation whose sessionAlive came from `agent.status`, and
  // stale snapshots made active synthesizers render as "Starting…".
  const isSpecialistRole = role === 'review' || role === 'test' || role === 'ship';
  let sessionId: string | undefined;
  if (isSpecialistRole) {
    sessionId = randomUUID();
    try {
      createConversation({
        name: agentId,
        tmuxSession: agentId,
        cwd: workspace,
        issueId,
        claudeSessionId: sessionId,
        model: selectedModel,
        harness: resolvedHarness,
      });
    } catch (err) {
      // Non-fatal: the specialist still runs, but without a conversation record
      console.warn(`[spawnRun] Failed to create conversation for ${agentId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  // PAN-977: for a Claude Code review sub-role, hand the launcher the synthesis
  // wiring so the launcher's own bash process — not the agent's good behavior,
  // not Deacon's patrol — owns the REVIEWER_READY/FAILED/TIMEOUT signal. The
  // launcher signals deterministically on process exit and touches a marker
  // file; Deacon only steps in if that bash process was SIGKILLed.
  const isClaudeCodeReviewSubRole = role === 'review' && !!options.subRole && resolvedHarness === 'claude-code';
  const reviewSignal = isClaudeCodeReviewSubRole && options.reviewSynthesisAgentId && options.reviewOutputPath
    ? {
        synthesisAgentId: options.reviewSynthesisAgentId,
        subRole: options.subRole as string,
        outputPath: options.reviewOutputPath,
        signalMarkerPath: join(getAgentDir(agentId), 'reviewer-signaled'),
        launcherPidPath: join(getAgentDir(agentId), 'reviewer-launcher.pid'),
        timeoutSeconds: REVIEW_SUBROLE_TIMEOUT_SECONDS,
      }
    : undefined;
  if (options.reviewSynthesisAgentId) state.reviewSynthesisAgentId = options.reviewSynthesisAgentId;
  if (options.reviewOutputPath) state.reviewOutputPath = options.reviewOutputPath;

  // PAN-1059 / PAN-977: specialist roles (review sub-roles, test, ship) must not
  // pass the prompt as a positional argument to Claude Code. Inside a detached
  // tmux session, `--session-id` combined with a large positional prompt causes
  // Claude Code to exit immediately (session-env directory created, then silent
  // death). Work agents avoid this by delivering the prompt via tmux send-keys
  // after Claude boots. Specialist roles now use the same delivery path.
  // Exception: review sub-roles use `--print` mode which requires the prompt
  // as an argument — tmux send-keys delivery doesn't work with `--print`.
  const usesPrintMode = role === 'review' && options.subRole;
  const shouldDeliverPromptViaTmux = isSpecialistRole && !usesPrintMode;

  const launcherContent = generateLauncherScript({
    role,
    workingDir: workspace,
    changeDir: false,
    setCi: true,
    setTerminalEnv: true,
    providerExports,
    promptFile: shouldDeliverPromptViaTmux ? undefined : promptFile,
    panopticonEnv: { agentId, issueId, sessionType: options.subRole ? `${role}.${options.subRole}` : role },
    baseCommand: await getRoleRuntimeBaseCommand(selectedModel, agentId, role, resolvedHarness, options.subRole),
    sessionId,
    reviewSignal,
    // PAN-977: review sub-role launchers must outlive their tmux session. The
    // session gets reaped quickly (orphan-recovery / cleanup / restart churn)
    // which SIGHUPs the launcher; `trap '' HUP` keeps the launcher's bash
    // process alive so it always runs its signal block when claude exits.
    trapHup: reviewSignal ? true : undefined,
    ...piLauncherFields,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=role-run | role=${role} | model=${state.model} | source=agents.ts:spawnRun | session=${agentId} | command="${claudeCmd}"`);

  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(workspace);
  } catch { /* non-fatal */ }

  await createSessionAsync(agentId, workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV,
      TERM: 'xterm-256color',
      PANOPTICON_AGENT_ID: agentId,
      PANOPTICON_ISSUE_ID: issueId,
      PANOPTICON_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      GIT_SEQUENCE_EDITOR: 'false',
      ...providerEnv,
    },
  });

  // Deliver prompt via tmux for specialist roles after Claude boots.
  if (shouldDeliverPromptViaTmux && options.prompt) {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      if (!(await sessionExistsAsync(agentId))) {
        console.error(`[${agentId}] Tmux session died before becoming ready`);
        break;
      }
      try {
        const pane = await capturePaneAsync(agentId, 200);
        if (pane.includes('bypass permissions on') || pane.includes('Claude Code')) {
          ready = true;
          break;
        }
      } catch { /* non-fatal */ }
    }
    if (ready) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await deliverAgentMessage(agentId, options.prompt, 'spawnRun:initial-prompt');
    } else {
      console.error(`[${agentId}] Claude did not become ready within 30s`);
    }
  }

  markAgentRunning(state);

  // Stamp the workspace HEAD this role run was launched against. The reactive
  // scheduler uses this to tell a still-relevant run from a zombie session
  // left behind by an agent that finished work but never exited (the ship/test
  // stall class of bug). A non-fatal git probe — if it fails the marker is
  // simply absent and activeRoleRunExists falls back to status-only checks.
  try {
    const { stdout } = await execAsync('git rev-parse --short=8 HEAD', { cwd: workspace });
    const head = stdout.trim();
    if (head) state.roleRunHead = head;
  } catch { /* non-fatal — marker stays absent */ }

  await saveAgentStateAsync(state);

  emitActivityEntry({
    source: role,
    level: 'info',
    message: `${role} role started for ${issueId}`,
    issueId,
  });

  return state;
}

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const agentId = options.slotId != null
    ? `agent-${options.issueId.toLowerCase()}-${options.slotId}`
    : `agent-${options.issueId.toLowerCase()}`;
  const role: 'work' = options.role ?? 'work';

  // Check if already running (scoped to the exact session name, including slot suffix)
  if (await sessionExistsAsync(agentId)) {
    throw new Error(`Agent ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(options.issueId, role, options.allowHost, options.workspace);

  // Initialize hook for this agent (FPP support)
  initHook(agentId);

  await assertIssueHasBeads(options.workspace, options.issueId);

  // Determine model based on role configuration
  const selectedModel = determineModel({ model: options.model, role });
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

  // PAN-1048 review feedback 003: respect roles.work.harness from config when
  // the caller did not pass an explicit options.harness. Without this, every
  // work spawn ignored the per-role harness slot surfaced in Settings → Roles
  // and silently fell back to claude-code — the same bug spawnRun() already
  // fixed for non-work roles at line 1665.
  //
  // PAN-1048 review feedback 005 (C4): also gate through resolveEffectiveHarness
  // so the policy check (e.g. Pi + Anthropic subscription auth → ToS violation)
  // runs before we persist the resolved harness or hand it to the launcher.
  const requestedHarness: 'claude-code' | 'pi' = options.harness
    ?? loadYamlConfig().config.roles?.work?.harness
    ?? 'claude-code';
  const resolvedHarness: 'claude-code' | 'pi' = await resolveEffectiveHarness(requestedHarness, selectedModel);

  // Create state
  const existingState = getAgentState(agentId);
  const state: AgentState = {
    id: agentId,
    issueId: options.issueId,
    workspace: options.workspace,
    harness: resolvedHarness,
    role,
    model: selectedModel,
    status: 'starting',
    startedAt: new Date().toISOString(),
    costSoFar: 0,
    preSpawnStashRef: existingState?.preSpawnStashRef,
    preSpawnStashMessage: existingState?.preSpawnStashMessage,
    preSpawnBaselineHead: existingState?.preSpawnBaselineHead,
    hostOverride: options.allowHost || undefined,
  };

  saveAgentState(state);

  // Transition issue tracker to "in progress" immediately so Linear reflects reality
  // while workspace setup continues. Best-effort, don't block agent spawn.
  // Only for work agents, not planning/specialist agents.
  if (role === 'work') {
    transitionIssueToInProgress(options.issueId, options.workspace).catch((err) => {
      console.warn(`[agents] Could not transition ${options.issueId} to in_progress: ${err.message}`);
    });
  }

  // For child stories: synthesize feature context from parent feature plan
  // before the agent starts so readFeatureContext has O(1) local access.
  if (role === 'work') {
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

  // Channels gate: when the experimental flag is on AND this work agent is
  // eligible, write a per-agent .mcp.json that wires the panopticon-bridge as
  // a stdio MCP server, set channelsEnabled in the agent state record, and
  // pass the bridge MCP path through to buildAgentLaunchConfig so claude is
  // started with --mcp-config + --dangerously-load-development-channels. When
  // the flag is off OR the agent is ineligible we touch nothing here — same
  // code path, same files on disk, as before PAN-985.
  const channelsDecision = decideChannelsForWorkAgent(agentId, options, state);
  let channelsBridgeMcpConfig: string | undefined;
  if (channelsDecision.eligible) {
    channelsBridgeMcpConfig = join(options.workspace, '.pan', 'agent-mcp.json');
    writeBridgeToken(agentId);
    await writeChannelsBridgeMcpConfig(channelsBridgeMcpConfig, agentId);
    state.channelsEnabled = true;
    saveAgentState(state);
  }

  const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
    agentId,
    model: selectedModel,
    workspace: options.workspace,
    role: 'work',
    isPlanning: false,
    channelsBridgeMcpConfig,
    harness: state.harness ?? 'claude-code',
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
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
      PANOPTICON_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      GIT_SEQUENCE_EDITOR: 'false', // Block interactive rebase / squash (agents forbidden from rewriting history)
      ...providerEnv, // Set correct provider env vars (BASE_URL, AUTH_TOKEN, etc.)
    }
  });

  // Channels: dismiss the dev-channels confirmation dialog before any prompt
  // delivery. Must run while we are still in the launch path so the channel
  // listener is registered before deliverAgentMessage starts preferring the
  // socket. Skipped when the agent was not eligible at launch time.
  if (state.channelsEnabled) {
    await dismissDevChannelsDialog(agentId);
  }

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
      await deliverAgentMessage(agentId, prompt, 'spawnAgent:initial-prompt', state.deliveryMethod);
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
  emitActivityEntry({
    source: role,
    level: 'info',
    message: `Work agent started for ${options.issueId}`,
    issueId: options.issueId,
  });
  emitActivityTts({
    utterance: `Work agent started for ${options.issueId}`,
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
 * PAN-1048 P2: async startup migration.
 *
 * The previous synchronous version used readdirSync, readFileSync,
 * killSession (sync tmux subprocess), and rmSync — all on the Node
 * event loop. Called from warnOnBareNumericIssueIds() during dashboard
 * read-model bootstrap, this blocked all HTTP/WebSocket/PTY traffic on
 * server startup while it scanned every agent dir, killed stale tmux
 * sessions, and recursively deleted directories.
 *
 * This async variant does the same work using fs/promises and the
 * already-async killSessionAsync() so the bootstrap path no longer
 * stalls the event loop.
 */
async function dropLegacyAgentStatesMissingRoleAsync(): Promise<number> {
  if (!existsSync(AGENTS_DIR)) return 0;

  const fsp = await import('fs/promises');
  let entries: string[];
  try {
    entries = await fsp.readdir(AGENTS_DIR);
  } catch {
    return 0;
  }

  let dropped = 0;
  await Promise.all(
    entries.map(async (entry) => {
      const dirPath = join(AGENTS_DIR, entry);
      let stat;
      try {
        stat = await fsp.stat(dirPath);
      } catch {
        return;
      }
      if (!stat.isDirectory()) return;

      const agentId = normalizeAgentId(entry);
      const stateFile = join(dirPath, 'state.json');
      let raw: { role?: unknown };
      try {
        const contents = await fsp.readFile(stateFile, 'utf8');
        raw = JSON.parse(contents) as { role?: unknown };
      } catch {
        return;
      }
      if (isRole(raw.role)) return;

      try { await killSessionAsync(agentId); } catch { /* best effort */ }
      try {
        await fsp.rm(dirPath, { recursive: true, force: true });
        dropped++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[agents] Failed to drop legacy agent state ${agentId}: ${msg}`);
      }
    }),
  );

  return dropped;
}

/**
 * Scan ~/.panopticon/agents/ for state files with bare numeric issueIds
 * (e.g. "484" instead of "PAN-484") and log warnings to stderr.
 *
 * These workspaces were created before the pan- prefix convention and may
 * cause cross-tracker pollution if their in_review transition is triggered.
 * Called once at server startup to surface legacy state files.
 */
/**
 * PAN-1048 P2: bootstrap-path migration is async.
 *
 * Sweeps legacy state files missing a `role` field and warns on bare
 * numeric issueIds. Both passes used to be synchronous (readdirSync,
 * readFileSync, killSession, rmSync), which blocked the dashboard
 * server's event loop on startup. The async version scans the same
 * directory once per concern and uses fs/promises throughout.
 */
export async function warnOnBareNumericIssueIds(): Promise<void> {
  const droppedLegacyAgents = await dropLegacyAgentStatesMissingRoleAsync();
  if (droppedLegacyAgents > 0) {
    console.warn(`[agents] Dropped ${droppedLegacyAgents} legacy agent state file(s) missing role`);
  }

  if (!existsSync(AGENTS_DIR)) return;

  const fsp = await import('fs/promises');
  let entries: string[];
  try {
    entries = await fsp.readdir(AGENTS_DIR);
  } catch {
    return;
  }

  const legacy: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      const dirPath = join(AGENTS_DIR, entry);
      try {
        const stat = await fsp.stat(dirPath);
        if (!stat.isDirectory()) return;
      } catch {
        return;
      }
      const state = await getAgentStateAsync(entry);
      if (state?.issueId && /^\d+$/.test(state.issueId)) {
        legacy.push(`${entry} (issueId: "${state.issueId}")`);
      }
    }),
  );

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
    // PAN-1048 C4: resume must relaunch with the agent's actual role, not
    // hardcoded 'work'. A stopped review/test/ship run was previously
    // resurrected as a work agent because launcher generation ignored the
    // saved role. Use agentState.role and route through getRoleRuntimeBaseCommand
    // so the role-specific .claude/agents/* definition file is loaded.
    const resumeRole: Role = agentState.role ?? 'work';
    // PAN-1048 review feedback 006 (S1): Pi-backed resumes need the same
    // launcher fields the fresh-spawn path threads through generateLauncherScript.
    // buildPiCommand throws on missing piSessionDir, so the previous fallback
    // emitted a launcher that would crash on resume for any Pi role agent.
    const resumeModel = agentState.model || 'claude-sonnet-4-6';
    const fallbackHarness = agentState.harness ?? 'claude-code';
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      resumeRole,
      agentState.hostOverride === true,
      agentState.workspace,
    );
    const fallbackPiFields = fallbackHarness === 'pi'
      ? await getPiLauncherFields(normalizedId, resumeModel)
      : {};
    const fallbackContent = generateLauncherScript({
      role: resumeRole,
      workingDir: agentState.workspace,
      changeDir: false,
      setCi: true,
      providerExports,
      baseCommand: await getRoleRuntimeBaseCommand(
        resumeModel,
        normalizedId,
        resumeRole,
        fallbackHarness,
      ),
      ...fallbackPiFields,
    });
    writeFileSync(fallbackLauncher, fallbackContent, { mode: 0o755 });
    await createSessionAsync(normalizedId, agentState.workspace, `bash ${fallbackLauncher}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    });

    markAgentRunning(agentState);
    saveAgentState(agentState);

    const ready = await waitForReadySignal(normalizedId, 30);
    const resumePrompt = `You are resuming work on ${agentState.issueId}. Check .pan/feedback/ for specialist feedback that arrived while you were stopped, then continue working.\n\n${message}`;
    if (ready) {
      await deliverAgentMessage(normalizedId, resumePrompt, 'resumeAgent:resume-prompt', agentState.deliveryMethod);
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

  const deliveryMethod = agentState?.deliveryMethod;
  await deliverAgentMessage(normalizedId, message, 'messageAgent:pan-tell', deliveryMethod);

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
  const requestedModel = normalizeModelOverride(opts?.model);
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

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycle(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
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

    const model = requestedModel || requireModelOverride(agentState.model || 'claude-sonnet-4-6');
    if (requestedModel && requestedModel !== agentState.model) {
      agentState.model = requestedModel;
      saveAgentState(agentState);
    }
    const effectiveHarness = await resolveEffectiveHarness(agentState.harness, model);
    agentState.harness = effectiveHarness;
    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
      spawnMode: 'resume',
      resumeSessionId: sessionId,
      harness: effectiveHarness,
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    const claudeCmd = `bash ${launcherScript}`;

    await createSessionAsync(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    });

    // Always wake the resumed agent with a continue prompt — without it, the
    // re-attached claude session sits silently at its last state, and the user
    // (or deacon nudge loop) ends up sending one manually anyway. Default
    // matches restartAgent's wording so behaviour is consistent across both
    // entry points. Caller-supplied message wins.
    const issueId = agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase();
    const effectiveMessage =
      message ??
      `You are resuming work on ${issueId}. Read .pan/continue.json for context and pick up where you left off — do not wait for further instructions.`;

    let messageDelivered = false;
    if (effectiveHarness === 'pi') {
      // Pi does not fire the Claude SessionStart hook; wait for ready.json and
      // deliver the auto-continue prompt through the FIFO JSONL protocol.
      try {
        await writePiAgentPrompt(normalizedId, effectiveMessage);
        messageDelivered = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[resumeAgent] Pi prompt delivery failed: ${msg}`);
      }
    } else {
      // Wait for SessionStart hook to signal ready (PAN-87: reliable message delivery)
      const ready = await waitForReadySignal(normalizedId, 30);
      if (ready) {
        await deliverAgentMessage(normalizedId, effectiveMessage, 'resumeAgent:auto-continue', agentState.deliveryMethod);
        messageDelivered = true;
      } else {
        console.error('Claude SessionStart hook did not fire during resume, continue prompt not sent');
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
  harness?: 'claude-code' | 'pi';
  graceful?: boolean;
  message?: string;
}

export async function restartAgent(
  agentId: string,
  opts: RestartAgentOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const { graceful = true, model: rawNewModel, harness: newHarness, message } = opts;
  const newModel = normalizeModelOverride(rawNewModel);

  const agentState = getAgentState(normalizedId);
  if (!agentState) {
    return { success: false, error: `Agent ${normalizedId} not found` };
  }
  if (!agentState.workspace || !existsSync(agentState.workspace)) {
    return { success: false, error: `Agent workspace missing: ${agentState.workspace}` };
  }

  logAgentLifecycle(normalizedId, `restartAgent called (graceful=${graceful}, model=${newModel || 'unchanged'}, harness=${newHarness || 'unchanged'})`);

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycle(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

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

  const effectiveModel = newModel || requireModelOverride(agentState.model || 'claude-sonnet-4-6');
  const requestedHarness = newHarness ?? agentState.harness;
  const effectiveHarness = await resolveEffectiveHarness(requestedHarness, effectiveModel);
  if (newModel && newModel !== agentState.model) {
    agentState.model = newModel;
  }
  agentState.harness = effectiveHarness;
  agentState.status = 'starting';
  saveAgentState(agentState);

  try {
    clearReadySignal(normalizedId);

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: effectiveModel,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
      harness: effectiveHarness,
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    const claudeCmd = `bash ${launcherScript}`;

    await createSessionAsync(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        TERM: 'xterm-256color',
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        GIT_SEQUENCE_EDITOR: 'false',
        ...providerEnv,
      },
    });

    const prompt = message || `You are resuming work on ${agentState.issueId}. Read .pan/continue.json for context and pick up where you left off.`;
    if (effectiveHarness === 'pi') {
      // Pi does not fire the Claude SessionStart hook and does not read tmux
      // input — wait for ready.json and write the continue prompt through the
      // FIFO JSONL protocol.
      try {
        await writePiAgentPrompt(normalizedId, prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[restartAgent] Pi prompt delivery failed for ${normalizedId}: ${msg}`);
      }
    } else {
      const ready = await waitForReadySignal(normalizedId, 30);
      if (ready) {
        await new Promise(r => setTimeout(r, 500));
        await sendKeysAsync(normalizedId, prompt);
      } else {
        console.error(`[restartAgent] Claude did not become ready within 30s for ${normalizedId}`);
      }
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
export async function recoverAgent(
  agentId: string,
  opts: { modelOverride?: string } = {},
): Promise<AgentState | null> {
  const normalizedId = normalizeAgentId(agentId);
  logAgentLifecycle(normalizedId, 'recoverAgent called');
  const state = getAgentState(normalizedId);

  if (!state) {
    logAgentLifecycle(normalizedId, 'recoverAgent BLOCKED: no state.json');
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  const modelOverride = normalizeModelOverride(opts.modelOverride);
  if (modelOverride) {
    state.model = modelOverride;
    logAgentLifecycle(normalizedId, `recoverAgent: model overridden → ${modelOverride}`);
  }
  if (!state.workspace || !state.model) {
    const reason = `[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`;
    console.error(reason);
    logAgentLifecycle(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  const recoveryRole: Role = state.role
    ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work');
  try {
    await assertWorkspaceStackHealthyForSpawn(
      state.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      recoveryRole,
      state.hostOverride === true,
      state.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
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

  // Restart the agent with recovery context. PAN-1048 C4: derive the role from
  // the saved AgentState (or the session-id heuristic for legacy planning-* IDs)
  // and route through getRoleRuntimeBaseCommand so review/test/ship don't get
  // resurrected as work agents.
  const recoveryHarness: RuntimeName = (state.harness === 'pi' || state.harness === 'claude-code')
    ? state.harness
    : 'claude-code';

  if (recoveryHarness === 'pi') {
    // PAN-1055: Pi cannot consume the recovery prompt as a positional shell
    // argument the way the Claude direct command path does — Pi reads JSONL
    // commands from its FIFO. Build a real Pi launcher (extension path,
    // --session-dir, FIFO redirect) via buildAgentLaunchConfig, then deliver
    // the recovery prompt through the FIFO once Pi reports ready.
    const { launcherContent, providerEnv: piProviderEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: state.model,
      workspace: state.workspace,
      role: recoveryRole,
      isPlanning: recoveryRole === 'plan',
      harness: 'pi',
    });
    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    await createSessionAsync(normalizedId, state.workspace, `bash ${launcherScript}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: state.issueId || '',
        PANOPTICON_SESSION_TYPE: recoveryRole,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...piProviderEnv,
      },
    });
    try {
      await writePiAgentPrompt(normalizedId, recoveryPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[recoverAgent] Pi recovery prompt delivery failed for ${normalizedId}: ${msg}`);
    }
    markAgentRunning(state);
    saveAgentState(state);
    logAgentLifecycle(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (pi)`);
    return state;
  }

  const claudeCmd = `${await getRoleRuntimeBaseCommand(state.model, agentId, recoveryRole, recoveryHarness)} "${recoveryPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  createSession(normalizedId, state.workspace, claudeCmd, {
    env: {
      PANOPTICON_AGENT_ID: normalizedId,
      PANOPTICON_ISSUE_ID: state.issueId || '',
      PANOPTICON_SESSION_TYPE: state.role ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work'),
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

