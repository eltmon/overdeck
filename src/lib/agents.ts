import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync, unlinkSync, statSync, rmSync } from 'fs';
import { mkdir, readFile, readdir, stat as statAsync, writeFile, writeFile as writeFileAsync, mkdir as mkdirAsync, rename as renameAsync } from 'fs/promises';
import { request as httpRequest } from 'node:http';
import { join, resolve, dirname, basename } from 'path';
import { homedir } from 'os';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { AGENTS_DIR, packageRoot, sessionFilePath } from './paths.js';
import { getClaudePermissionFlagsStringSync, resolvePermissionModeSync, bypassPrefixForAgentFlagSync } from './claude-permissions.js';
import { createSessionSync, createSession, killSessionSync, killSession, sendKeys, sendRawKeystroke, sessionExistsSync, sessionExists, listSessions, listSessionsSync, capturePaneSync, capturePane, listPaneValuesSync, listPaneValues, setOption } from './tmux.js';
import { initHookSync, checkHookSync, generateFixedPointPromptSync } from './hooks.js';
import { startWorkSync, completeWorkSync, getAgentCVSync } from './cv.js';
import { BLANKED_PROVIDER_ENV } from './child-env.js';
import type { ModelId, ComplexityLevel } from './settings.js';
import { getProviderForModelSync, getProviderEnvSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from './providers.js';
import { validateProviderHealth } from './provider-health.js';
import { loadConfigSync as loadYamlConfig, isClaudeCodeChannelsMcpEnabled, resolveModel, isTldrEnabledSync } from './config-yaml.js';
import type { NormalizedCavemanConfig, RoleEffort } from './config-yaml.js';
import type { AuthMode } from './subscription-types.js';
import { readCavemanVariant } from './caveman/workspace.js';
import { loadConfigSync } from './config.js';
import { getOpenAIAuthStatus, getOpenAIAuthStatusSync } from './openai-auth.js';
import { getClaudeAuthStatus } from './claude-auth.js';
import { bridgeGeminiAuthToCliproxy, getCliproxyClientEnv } from './cliproxy.js';
import { ensureOpenAICompatibleProxyRunning } from './openai-compatible-proxy.js';
import { createTrackerFromConfig, createTracker } from './tracker/factory.js';
import type { IssueState } from './tracker/interface.js';
import { findProjectByPathSync, getIssuePrefix, resolveProjectFromIssueSync } from './projects.js';
import { appendContinueSessionEntryForIssue } from './vbrief/lifecycle-io.js';
import { generateLauncherScriptSync } from './launcher-generator.js';
import { createConversation, getConversationByName, reactivateConversationForSpawn } from './database/conversations-db.js';
import { workspaceContextFile } from './context-layers/layers.js';
import { ensureSessionContextBriefingFile } from './briefing-freshness.js';
import { logAgentLifecycleSync } from './persistent-logger.js';
import { emitActivityEntrySync, emitActivityTtsSync } from './activity-logger.js';
import { BRIDGE_TOKEN_HEADER, readBridgeTokenSync, writeBridgeTokenSync } from './bridge-token.js';
import { PTY_TOKEN_HEADER, readPtyToken, writePtyToken } from './pty-token.js';
import { canUseHarnessSync } from './harness-policy.js';
import type { RuntimeName } from './runtimes/types.js';
import { createPiFifo, piFifoPaths, writePiCommandSync, PiNotReady } from './runtimes/pi-fifo.js';
import { Effect } from 'effect';
import { FsError, TmuxError } from './errors.js';
import { assertIssueHasBeads } from './beads-query.js';
import { getWorkspaceStackHealth } from './workspace/stack-health.js';
import { normalizeModelOverrideSync, requireModelOverrideSync, shellQuoteModelIdSync } from './model-validation.js';
import { resolveAutoResumeConfigForIssue } from './cloister/auto-resume-config.js';
import { recordFeatureRegistryLifecycle } from './registry/feature-registry-population.js';
import { getFlywheelActiveRunId } from './database/app-settings.js';
import { appendOperatorInterventionEvent } from './operator-interventions.js';
import type { MemoryIdentity } from '@panctl/contracts';

const execAsync = promisify(exec);

const toAgentFsError = (operation: string, path: string, cause: unknown): FsError =>
  new FsError({ operation, path, cause });

export type Role = 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel' | 'strike';

type FlywheelSpawnEnv = {
  PANOPTICON_FLYWHEEL_RUN_ID?: string;
  PANOPTICON_FLYWHEEL_AGENT_ROLE?: Role;
};

function normalizeFlywheelRunId(runId: string | null | undefined): string | undefined {
  if (!runId) return undefined;
  const trimmed = runId.trim();
  return /^RUN-\d+$/.test(trimmed) ? trimmed : undefined;
}

function resolveFlywheelSpawnEnv(role: Role, runIdOverride?: string | null): FlywheelSpawnEnv {
  const runId = normalizeFlywheelRunId(runIdOverride ?? getFlywheelActiveRunId());
  return runId
    ? { PANOPTICON_FLYWHEEL_RUN_ID: runId, PANOPTICON_FLYWHEEL_AGENT_ROLE: role }
    : {};
}

function flywheelEnvExports(env: FlywheelSpawnEnv): string[] {
  return [
    env.PANOPTICON_FLYWHEEL_RUN_ID ? `export PANOPTICON_FLYWHEEL_RUN_ID=${env.PANOPTICON_FLYWHEEL_RUN_ID}` : undefined,
    env.PANOPTICON_FLYWHEEL_AGENT_ROLE ? `export PANOPTICON_FLYWHEEL_AGENT_ROLE=${env.PANOPTICON_FLYWHEEL_AGENT_ROLE}` : undefined,
  ].filter((value): value is string => value !== undefined);
}

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

async function claudeSystemPromptFiles(workspace: string, harness: RuntimeName | undefined): Promise<string[]> {
  const files: string[] = [];
  const contextFile = workspaceContextFile(workspace);
  try {
    await statAsync(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNodeNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());

  // PAN-1566: Pi also receives the rendered global context layer.
  if (harness === 'pi') {
    const { piGlobalContextFile } = await import('./context-layers/index.js');
    const globalFile = piGlobalContextFile();
    if (existsSync(globalFile)) {
      files.unshift(globalFile);
    }
  }

  // PAN-1574: Codex receives its rendered global context layer (codex-global.md).
  if (harness === 'codex') {
    const { codexGlobalContextFile } = await import('./context-layers/index.js');
    const globalFile = codexGlobalContextFile();
    if (existsSync(globalFile)) {
      files.unshift(globalFile);
    }
  }

  return files;
}

function isNodeNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * BFS-walk a process subtree rooted at `rootPid` looking for the active agent
 * runtime. Returns true if any process in the tree matches the expected harness,
 * false if the tree exists but no match, false on any error.
 *
 * Used by sendAgentMessage zombie detection. pane_pid is the tmux pane's root
 * process, which is bash for work-agent launchers (`bash launcher.sh`) but can
 * be the runtime directly for specialists (`exec claude ...` / `exec pi ...`).
 */
async function hasAgentRuntimeInSubtree(rootPid: string, harness: RuntimeName = 'claude-code'): Promise<boolean> {
  const expectedProcessNames = harness === 'pi' ? new Set(['pi']) : harness === 'codex' ? new Set(['codex']) : new Set(['claude']);
  const queue: string[] = [rootPid];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid) || !/^\d+$/.test(pid)) continue;
    seen.add(pid);

    try {
      const { stdout: comm } = await execAsync(`ps -p ${pid} -o comm=`);
      const name = comm.trim();
      if (expectedProcessNames.has(name)) return true;
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
    piFifoPath: await Effect.runPromise(createPiFifo(agentId)),
    piSessionDir: paths.agentDir,
    model,
  };
}

function getCodexLauncherFields(agentId: string, model: string): {
  harness: 'codex';
  codexMode: 'exec';
  codexHome: string;
  codexSessionDir: string;
  model: string;
} {
  const codexHome = join(homedir(), '.panopticon', 'agents', agentId, 'codex-home');
  return {
    harness: 'codex',
    codexMode: 'exec',
    codexHome,
    codexSessionDir: join(codexHome, 'sessions'),
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
 * Inject prompt-time memory context into a Pi prompt (PAN-1546).
 * Mirrors Claude Code's UserPromptSubmit hook behaviour: every follow-up
 * prompt gets relevant memory surfaced via RAG.
 */
async function injectPiPromptTimeMemory(agentId: string, prompt: string): Promise<string> {
  if (!prompt.trim()) return prompt;

  const agentState = getAgentStateSync(agentId);
  if (!agentState || !agentState.workspace || !agentState.issueId) {
    return prompt;
  }

  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(agentState.workspace),
      workspaceId: basename(agentState.workspace),
      issueId: agentState.issueId,
      runId: agentId,
      sessionId: agentId,
      agentRole: agentState.role ?? 'work',
      agentHarness: agentState.harness ?? 'pi',
    };
    const { injectPromptTimeMemory } = await import('./memory/injection.js');
    const result = await injectPromptTimeMemory({ prompt, identity, surface: 'user-prompt' });
    if (result.context) {
      return `${result.context}\n\n---\n\n${prompt}`;
    }
  } catch (error) {
    console.warn(`[agents] Prompt-time memory injection failed for ${agentId}:`, error instanceof Error ? error.message : String(error));
  }
  return prompt;
}

/**
 * Prompt-time memory injection for a Pi CONVERSATION follow-up (PAN-1546).
 *
 * The rpc/work-agent path (injectPiPromptTimeMemory) reads agent-state.json,
 * which conversations do not have — they deliver follow-ups via tmux
 * paste-buffer, not the FIFO. This builds the memory identity from the
 * conversation's cwd + issueId instead. Only issue-linked conversations have
 * memory to surface; everything else (and any failure) passes through
 * unchanged so a memory hiccup can never block a message.
 */
export async function injectPiConversationMemory(
  opts: { cwd: string; issueId?: string | null; conversationName: string },
  prompt: string,
): Promise<string> {
  if (!prompt.trim() || !opts.issueId || !opts.cwd) return prompt;
  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(opts.cwd),
      workspaceId: basename(opts.cwd),
      issueId: opts.issueId,
      runId: opts.conversationName,
      sessionId: opts.conversationName,
      agentRole: 'work',
      agentHarness: 'pi',
    };
    const { injectPromptTimeMemory } = await import('./memory/injection.js');
    const result = await injectPromptTimeMemory({ prompt, identity, surface: 'user-prompt' });
    if (result.context) {
      return `${result.context}\n\n---\n\n${prompt}`;
    }
  } catch (error) {
    console.warn(`[agents] Conversation memory injection failed for ${opts.conversationName}:`, error instanceof Error ? error.message : String(error));
  }
  return prompt;
}

/**
 * Deliver a prompt to a Pi work agent through the FIFO JSONL command protocol.
 * Pi never reads tmux input — pasting prompts there is a no-op as far as the
 * model is concerned. Throws if Pi never reached readiness within the timeout.
 */
async function writePiAgentPrompt(agentId: string, prompt: string, timeoutSec = 30): Promise<void> {
  const augmentedPrompt = await injectPiPromptTimeMemory(agentId, prompt);
  const ready = await waitForPiAgentReady(agentId, timeoutSec);
  if (!ready) {
    throw new Error(`Pi agent ${agentId} did not become ready within ${timeoutSec}s`);
  }
  try {
    writePiCommandSync(agentId, { id: randomUUID(), type: 'prompt', message: augmentedPrompt });
  } catch (err) {
    if (err instanceof PiNotReady) {
      throw new Error(`Pi agent ${agentId} reader gone before prompt could be delivered: ${err.message}`);
    }
    throw err;
  }
}

async function resolveEffectiveHarness(harness: unknown, model: string): Promise<RuntimeName> {
  const requested: RuntimeName = harness === 'pi' || harness === 'claude-code' || harness === 'codex' ? harness : 'claude-code';
  const decision = canUseHarnessSync(requested, model, await getProviderAuthMode(model));
  return decision.allowed ? requested : 'claude-code';
}

export async function getProviderAuthMode(model: string): Promise<AuthMode | undefined> {
  const provider = getProviderForModelSync(model);
  if (provider.name === 'anthropic') {
    const authStatus = await Effect.runPromise(getClaudeAuthStatus());
    if (authStatus.hasAnthropicApiKey) return 'api-key';
    return authStatus.loggedIn ? 'subscription' : undefined;
  }

  if (provider.name === 'openai') {
    const { config } = loadYamlConfig();
    const authStatus = await Effect.runPromise(getOpenAIAuthStatus());
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
  harness: RuntimeName = 'claude-code',
  effort?: RoleEffort,
): Promise<string> {
  const validatedModel = requireModelOverrideSync(model);
  const quotedModel = shellQuoteModelIdSync(validatedModel);
  if (harness === 'pi') {
    return `pi --mode rpc --model ${quotedModel}`;
  }
  if (harness === 'codex') {
    // buildCodexCommand in launcher-generator builds the full `codex exec` line;
    // return a stub base command so the launcher generator can short-circuit.
    return `codex`;
  }

  const provider = getProviderForModelSync(validatedModel);
  const permissionFlags = getClaudePermissionFlagsStringSync();
  // PAN-982: --name <agentId> creates a human-readable Claude session name discoverable via
  // `claude --resume`.
  const nameFlag = agentName ? ` --name ${agentName}` : '';
  const effortFlag = effort ? ` --effort ${effort}` : '';
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
  const bypassWithAgent = agentDefinition ? bypassPrefixForAgentFlagSync() : '';

  // OpenAI subscription → local CLIProxyAPI sidecar exposes an
  // Anthropic-compatible /v1/messages endpoint, so Claude Code can drive
  // gpt-* models directly via ANTHROPIC_BASE_URL (no wrapper process).
  // The provider env vars are injected separately by getProviderEnvForModel.
  if (provider.name === 'openai' && (await getProviderAuthMode(validatedModel)) === 'subscription') {
    // CLIProxy supports gpt-5.x but not the -pro variant; map aliases to real names.
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[validatedModel] ?? validatedModel;
    if (agentDefinition) {
      // CLIProxy: --agent + --model override (frontmatter model: only accepts Anthropic ids).
      return `claude${bypassWithAgent}${agentFlag} --model ${shellQuoteModelIdSync(resolvedModel)}${effortFlag}${nameFlag}`;
    }
    return `claude ${permissionFlags} --model ${shellQuoteModelIdSync(resolvedModel)}${effortFlag}${nameFlag}`;
  }

  if (agentDefinition) {
    // --model is always passed when state has a resolved model so explicit
    // overrides (state.json model, switch-model, cloister routing) win over
    // the agent frontmatter's default model. Without this, Anthropic-direct
    // launches silently fall back to the frontmatter model and ignore the
    // user's selection — observed when switching PAN-977 to Opus 4.7 left
    // the launcher running Sonnet.
    return `claude${bypassWithAgent}${agentFlag} --model ${quotedModel}${effortFlag}${nameFlag}`;
  }
  return `claude ${permissionFlags} --model ${quotedModel}${effortFlag}${nameFlag}`;
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
  harness: RuntimeName = 'claude-code',
  subRole?: string,
  effort?: RoleEffort,
): Promise<string> {
  const validatedModel = requireModelOverrideSync(model);
  const quotedModel = shellQuoteModelIdSync(validatedModel);
  if (harness === 'pi') {
    return `pi --mode rpc --model ${quotedModel}`;
  }
  if (harness === 'codex') {
    return `codex`;
  }

  const provider = getProviderForModelSync(validatedModel);
  const definitionPath = roleAgentDefinitionPath(role, subRole);
  const agentFlag = definitionPath ? ` --agent ${definitionPath}` : '';
  const nameFlag = ` --name ${agentName}`;
  const effortFlag = effort ? ` --effort ${effort}` : '';
  // The convoy sub-roles have no `--agent` definition, so claude won't pick up
  // a frontmatter permissionMode. Fall back to the global Claude permission
  // flags in that case so the run still launches with the user's bypass/plan
  // settings honored.
  const permissionFlags = definitionPath ? '' : ` ${getClaudePermissionFlagsStringSync()}`;
  const bypassWithAgent = definitionPath ? bypassPrefixForAgentFlagSync() : '';

  // PAN-1557: convoy sub-reviewers now run as interactive, attachable sessions
  // (prompt delivered via tmux, completion signalled by the Stop-hook) instead
  // of headless `claude --print`. No role uses --print anymore.
  const printFlag = '';

  if (provider.name === 'openai' && (await getProviderAuthMode(validatedModel)) === 'subscription') {
    const resolvedModel = CLI_PROXY_MODEL_ALIASES[validatedModel] ?? validatedModel;
    return `claude${bypassWithAgent}${printFlag}${agentFlag}${permissionFlags} --model ${shellQuoteModelIdSync(resolvedModel)}${effortFlag}${nameFlag}`;
  }

  return `claude${bypassWithAgent}${printFlag}${agentFlag}${permissionFlags} --model ${quotedModel}${effortFlag}${nameFlag}`;
}

/** Known agent ID prefixes — IDs with these prefixes are already normalized */
const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
const SINGLETON_AGENT_IDS = new Set(['flywheel-orchestrator']);

/** Normalize agent ID: preserve known prefixes, add 'agent-' for bare issue IDs */
export function normalizeAgentId(agentId: string): string {
  if (SINGLETON_AGENT_IDS.has(agentId)) return agentId;
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
  const provider = getProviderForModelSync(model);
  if (provider.name === 'anthropic') return {};

  const { config } = loadYamlConfig();

  // OpenRouter API key is stored in config.yaml under providers.openrouter.api_key
  if (provider.name === 'openrouter') {
    const apiKey = config.apiKeys.openrouter;
    if (apiKey) {
      return getProviderEnvSync(provider, apiKey);
    }
    throw new Error(`OpenRouter API key not configured. Add your key in Settings → OpenRouter before using model "${model}".`);
  }

  const apiKey = config.apiKeys[provider.name as keyof typeof config.apiKeys];

  if (provider.name === 'google') {
    if (!apiKey) {
      throw new Error(`Google API key not configured. Add GOOGLE_API_KEY in Settings → Google or ~/.panopticon.env before using model "${model}".`);
    }

    if (!await Effect.runPromise(bridgeGeminiAuthToCliproxy(apiKey))) {
      throw new Error(`Failed to bridge Google API key into CLIProxy before using model "${model}".`);
    }

    return getCliproxyClientEnv();
  }

  if (provider.name === 'openai') {
    const authStatus = await Effect.runPromise(getOpenAIAuthStatus());
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
      await Effect.runPromise(ensureOpenAICompatibleProxyRunning());
    }
    await Effect.runPromise(validateProviderHealth(model, apiKey));
    return getProviderEnvSync(provider, apiKey);
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
  // Pi-native provider env vars (bridged from Panopticon settings so Pi can auth)
  'KIMI_API_KEY',
  'MINIMAX_API_KEY',
  'ZAI_API_KEY',
  'MIMO_API_KEY',
  'OPENROUTER_API_KEY',
  'NOUS_API_KEY',
  'DASHSCOPE_API_KEY',
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
export function clearReadySignal(agentId: string): void {
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
 *
 * Hook-driven (PAN-1594): readiness is signaled by `ready.json`, written by the
 * session-start hook (Claude) / Pi extension when the session reaches the
 * prompt, and cleared by clearReadySignal() before each (re)launch — so its
 * presence means the *current* session is ready for input. There is no tmux
 * pane-scrape fallback and no dependency on permission mode (the old fallback
 * matched the bypass-permissions footer `⏵⏵` / `bypass permissions on`, which
 * silently broke readiness for every non-bypass agent).
 *
 * Returns true if the ready signal arrives within the timeout, false otherwise.
 */
export async function waitForReadySignal(agentId: string, timeoutSeconds = 30): Promise<boolean> {
  const readyPath = getReadySignalPath(agentId);

  for (let i = 0; i < timeoutSeconds; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Non-blocking sleep

    if (existsSync(readyPath)) {
      try {
        const signal = JSON.parse(readFileSync(readyPath, 'utf-8'));
        // Accept both the Claude hook shape ({ ready: true, ... }) and the Pi
        // extension shape ({ agentId, sessionId, ... } with no `ready` field).
        if (signal && typeof signal === 'object' && signal.ready !== false) {
          return true;
        }
      } catch {
        // File exists but mid-write / invalid — keep waiting.
      }
    }
  }

  return false;
}

/**
 * Wait until a hook-instrumented agent reports it is idle at the prompt, via the
 * runtime mirror (Stop / SessionStart hook → activity 'idle'), or the timeout
 * elapses. Returns true if idle was observed.
 *
 * PAN-1594/1596: this is the hook-derived "is the agent idle right now" check.
 * It replaced the tmux pane-scrape `waitForClaudePrompt` (since removed). Works
 * for any hook-instrumented session — agents AND conversations (`conv-*`), which
 * feed the runtime mirror once their heartbeat POSTs authenticate (PAN-1596). No
 * dependency on tmux output or permission mode.
 *
 * Distinct from waitForReadySignal: that answers the one-time "has this
 * (re)launched session reached the prompt" (ready.json gate, used by the
 * conversation reattach/fork paths); this answers "is the running agent idle at
 * the prompt right now".
 */
export async function waitForAgentIdle(agentId: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (getAgentRuntimeStateSync(agentId)?.state === 'idle') return true;
    await new Promise(r => setTimeout(r, 250));
  } while (Date.now() < deadline);
  return getAgentRuntimeStateSync(agentId)?.state === 'idle';
}

export type DeliveryResult = {
  ok: boolean;
  path: 'supervisor' | 'channels' | 'tmux' | 'pi' | 'codex';
  failure?: string;
};

export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  /** Coding-agent harness this agent runs under (PAN-636). */
  harness?: RuntimeName;
  /** Unified role primitive (PAN-1048). */
  role: Role;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
  lastActivity?: string;
  /**
   * Tri-state kickoff delivery signal for work-agent lifecycle monitoring:
   * undefined = legacy/pre-feature agent or non-applicable role;
   * false = spawned but kickoff delivery not yet confirmed;
   * true = kickoff delivery confirmed.
   */
  kickoffDelivered?: boolean;
  stoppedAt?: string;
  /** True when markAgentStopped was called (user-initiated stop). Cleared on
   *  resume. Read by deacon's autoResumeStoppedWorkAgents to distinguish a
   *  deliberate stop from a crash/orphan. */
  stoppedByUser?: boolean;
  stoppedByPause?: boolean;
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
  /** True when this work agent was launched through the PTY supervisor wrapper. */
  supervisorEnabled?: boolean;
  /**
   * Delivery method for agent messages. 'auto' tries supervisor, then channels,
   * then tmux; explicit socket methods are strict (throw on failure); 'tmux'
   * bypasses socket transports entirely.
   */
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';

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
  return value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship' || value === 'flywheel' || value === 'strike';
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
    kickoffDelivered: raw.kickoffDelivered,
    stoppedAt: raw.stoppedAt,
    stoppedByUser: raw.stoppedByUser,
    stoppedByPause: raw.stoppedByPause,
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
    supervisorEnabled: raw.supervisorEnabled,
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

export function getAgentStateSync(agentId: string): AgentState | null {
  const normalizedId = normalizeAgentId(agentId);
  const stateFile = join(getAgentDir(normalizedId), 'state.json');
  if (!existsSync(stateFile)) return null;

  const content = readFileSync(stateFile, 'utf8');
  return parseAgentState(content, normalizedId);
}


export const getAgentState = (agentId: string): Effect.Effect<AgentState | null, FsError> => {
  const normalizedId = normalizeAgentId(agentId);
  const stateFile = join(getAgentDir(normalizedId), 'state.json');
  if (!existsSync(stateFile)) return Effect.succeed(null);

  return Effect.tryPromise({
    try: () => readFile(stateFile, 'utf-8'),
    catch: (cause) => toAgentFsError('read', stateFile, cause),
  }).pipe(Effect.map((content) => parseAgentState(content, normalizedId)));
};

export function saveAgentStateSync(state: AgentState): void {
  const dir = getAgentDir(state.id);
  mkdirSync(dir, { recursive: true });

  // Detect status transition for audit trail
  const oldState = getAgentStateSync(state.id);
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
    logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentState)`);
  }
}


export const saveAgentState = (state: AgentState): Effect.Effect<void, FsError> => {
  const dir = getAgentDir(state.id);
  const stateFile = join(dir, 'state.json');

  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdirAsync(dir, { recursive: true }),
      catch: (cause) => toAgentFsError('mkdir', dir, cause),
    });

    const oldState = yield* getAgentState(state.id);
    const oldStatus = oldState?.status;

    if (state.status === 'running' || state.status === 'starting') {
      delete state.stoppedAt;
    } else if (state.status === 'stopped' && !state.stoppedAt) {
      state.stoppedAt = new Date().toISOString();
    }

    yield* Effect.tryPromise({
      try: () => writeFileAsync(stateFile, JSON.stringify(cleanAgentState(state), null, 2)),
      catch: (cause) => toAgentFsError('write', stateFile, cause),
    });
    recordFeatureRegistryAgentState(state);

    if (oldStatus && oldStatus !== state.status) {
      logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → ${state.status} (saveAgentStateProgram)`);
    }
  });
};

function recordFeatureRegistryAgentState(state: AgentState): void {
  const status = state.status === 'starting' || state.status === 'running' ? 'active' : 'deferred';
  void recordFeatureRegistryLifecycle({
    issueId: state.issueId,
    workspacePath: state.workspace,
    agentId: state.id,
    status,
  });
}

function clearFailureTrackingFields(state: AgentState): void {
  state.consecutiveFailures = 0;
  delete state.firstFailureInRunAt;
  delete state.lastFailureAt;
  delete state.lastFailureReason;
  delete state.lastFailureNextRetryAt;
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
function applyAgentPaused(state: AgentState, reason?: string, stoppedByPause = false): void {
  if (!state.paused) {
    state.pausedAt = new Date().toISOString();
  }
  state.paused = true;
  if (stoppedByPause) {
    state.stoppedByPause = true;
  }
  if (reason === undefined) {
    delete state.pausedReason;
  } else {
    state.pausedReason = reason;
  }
}

/** Sets the persistent manual pause gate used before stopping or suppressing resume. */
export function setAgentPausedSync(agentId: string, reason?: string, stoppedByPause = false): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  applyAgentPaused(state, reason, stoppedByPause);
  saveAgentStateSync(state);
  return true;
}


export const setAgentPaused = (
  agentId: string,
  reason?: string,
  stoppedByPause = false,
): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;

    applyAgentPaused(state, reason, stoppedByPause);
    yield* saveAgentState(state);
    return state;
  });

function applyAgentUnpaused(state: AgentState): void {
  if (state.stoppedByPause === true) {
    delete state.stoppedByUser;
  }
  delete state.stoppedByPause;
  delete state.paused;
  delete state.pausedReason;
  delete state.pausedAt;
}

function isAgentPauseClear(state: AgentState): boolean {
  return !state.paused && state.pausedReason === undefined && state.pausedAt === undefined;
}

/** Clears the persistent manual pause gate without spawning the agent. */
export function clearAgentPausedSync(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if (isAgentPauseClear(state)) return true;

  applyAgentUnpaused(state);
  saveAgentStateSync(state);
  return true;
}


export const clearAgentPaused = (agentId: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;
    if (isAgentPauseClear(state)) return state;

    applyAgentUnpaused(state);
    yield* saveAgentState(state);
    return state;
  });

/** Marks an agent as troubled after repeated resume failures. */
export function markAgentTroubled(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  if (!state.troubled) {
    state.troubledAt = new Date().toISOString();
  }
  state.troubled = true;
  saveAgentStateSync(state);
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
export function clearAgentTroubledSync(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if (isAgentTroubledClear(state)) return true;

  applyAgentUntroubled(state);
  saveAgentStateSync(state);
  return true;
}


export const clearAgentTroubled = (agentId: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;
    if (isAgentTroubledClear(state)) return state;

    applyAgentUntroubled(state);
    yield* saveAgentState(state);
    return state;
  });

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
export function recordAgentFailureSync(agentId: string, reason: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;

  applyAgentFailure(state, reason);
  saveAgentStateSync(state);
  return true;
}


export const recordAgentFailure = (agentId: string, reason: string): Effect.Effect<AgentState | null, FsError> =>
  Effect.gen(function* () {
    const state = yield* getAgentState(agentId);
    if (!state) return null;

    applyAgentFailure(state, reason);
    yield* saveAgentState(state);
    return state;
  });

/** Resets failure tracking after an agent reaches running state. */
export function resetAgentFailureCount(agentId: string): boolean {
  const state = getAgentStateSync(agentId);
  if (!state) return false;
  if ((state.consecutiveFailures ?? 0) === 0 && state.firstFailureInRunAt === undefined && state.lastFailureAt === undefined && state.lastFailureReason === undefined && state.lastFailureNextRetryAt === undefined) return true;

  clearFailureTrackingFields(state);
  saveAgentStateSync(state);
  return true;
}

/** Reports whether callers should block start, resume, auto-resume, or message delivery on the manual pause gate. */
export function isAgentPaused(agentId: string): boolean {
  return getAgentStateSync(agentId)?.paused === true;
}

/** Reports whether callers should block start, resume, auto-resume, or message delivery on the troubled gate. */
export function isAgentTroubled(agentId: string): boolean {
  return getAgentStateSync(agentId)?.troubled === true;
}

/** Update just the delivery method on an agent's state file. */
export async function setAgentDeliveryMethod(
  agentId: string,
  deliveryMethod: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<void> {
  const state = await Effect.runPromise(getAgentState(agentId));
  if (!state) return;
  state.deliveryMethod = deliveryMethod;
  await Effect.runPromise(saveAgentState(state));
}

/**
 * Resolve PANOPTICON_HOME — same fallback semantics as panopticon-bridge.
 */
function panopticonHomeForSockets(): string {
  return process.env.PANOPTICON_HOME ?? join(homedir(), '.panopticon');
}

function panopticonHomeForChannels(): string {
  return panopticonHomeForSockets();
}

/**
 * Append a delivery-event log line to the per-agent bridge log. Best-effort.
 */
async function appendChannelDeliveryLog(
  agentId: string,
  entry: {
    path: 'supervisor' | 'channel' | 'tmux';
    reason?: string;
    caller?: string;
    'pty-supervisor'?: string;
    channels?: string;
  },
): Promise<void> {
  try {
    const home = panopticonHomeForSockets();
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
  token: string,
  tokenHeader: string = BRIDGE_TOKEN_HEADER,
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
          [tokenHeader]: token,
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
 * Single delivery primitive for orchestrator-to-work-agent messages. Auto mode
 * tries the PTY supervisor socket, then legacy Channels MCP, then tmux. Explicit
 * socket methods are strict and throw instead of falling back.
 */
export async function deliverAgentMessage(
  agentId: string,
  message: string,
  caller: string = 'unknown',
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<DeliveryResult> {
  const normalizedId = normalizeAgentId(agentId);

  let channelsEnabled = false;
  let resolvedMethod = deliveryMethod;
  try {
    const state = await Effect.runPromise(getAgentState(normalizedId));
    // Codex agents are headless one-shot processes; the supervisor/channels/tmux
    // delivery ladder does not apply — route through CodexRuntimeSync.sendMessage
    // (codex exec resume <threadId> <message>).
    if (state?.harness === 'codex') {
      const { CodexRuntimeSync } = await import('./runtimes/codex.js');
      const rt = new CodexRuntimeSync();
      await rt.sendMessage(normalizedId, message);
      return { ok: true, path: 'codex' };
    }
    channelsEnabled = Boolean(state?.channelsEnabled);
    resolvedMethod ??= state?.deliveryMethod ?? 'auto';
  } catch {
    resolvedMethod ??= 'auto';
  }

  if (resolvedMethod === 'tmux') {
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux' };
  }

  let supervisorFailure: string | undefined;
  if (resolvedMethod === 'auto' || resolvedMethod === 'supervisor') {
    const supervisorSocketPath = join(panopticonHomeForSockets(), 'sockets', `pty-${normalizedId}.sock`);
    const ptyToken = await readPtyToken(normalizedId);
    if (!existsSync(supervisorSocketPath)) {
      supervisorFailure = 'socket-missing';
    } else if (!ptyToken) {
      supervisorFailure = 'pty-token-missing';
    } else {
      try {
        await postUnixSocketJson(
          supervisorSocketPath,
          { content: message, meta: { caller } },
          4_000,
          ptyToken,
          PTY_TOKEN_HEADER,
        );
        await appendChannelDeliveryLog(normalizedId, { path: 'supervisor', caller });
        return { ok: true, path: 'supervisor' };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        supervisorFailure = `socket-post-failed: ${reason}`;
      }
    }

    if (resolvedMethod === 'supervisor') {
      throw new Error(`MessageDeliveryFailed: PTY supervisor delivery failed for ${normalizedId} (${caller}): ${supervisorFailure}`);
    }
  }

  if (resolvedMethod === 'auto' || resolvedMethod === 'channels') {
    let channelFailure: string | undefined;
    const socketPath = join(panopticonHomeForSockets(), 'sockets', `agent-${normalizedId}.sock`);
    if (!channelsEnabled) {
      channelFailure = 'channels-disabled';
    } else if (!existsSync(socketPath)) {
      channelFailure = 'socket-missing';
    } else {
      const bridgeToken = readBridgeTokenSync(normalizedId);
      if (!bridgeToken) {
        channelFailure = 'bridge-token-missing';
      } else {
        try {
          await postUnixSocketJson(
            socketPath,
            { content: message, meta: { caller } },
            2000,
            bridgeToken,
          );
          await appendChannelDeliveryLog(normalizedId, {
            path: 'channel',
            caller,
            ...(supervisorFailure ? { 'pty-supervisor': supervisorFailure } : {}),
          });
          return { ok: true, path: 'channels' };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          channelFailure = `socket-post-failed: ${reason}`;
        }
      }
    }

    if (resolvedMethod === 'channels') {
      throw new Error(`MessageDeliveryFailed: Channels delivery failed for ${normalizedId} (${caller}): ${channelFailure}`);
    }

    await appendChannelDeliveryLog(normalizedId, {
      path: 'tmux',
      reason: channelFailure,
      caller,
      ...(supervisorFailure ? { 'pty-supervisor': supervisorFailure } : {}),
      ...(channelFailure ? { channels: channelFailure } : {}),
    });
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux', failure: channelFailure ?? supervisorFailure };
  }

  await Effect.runPromise(sendKeys(normalizedId, message));
  return { ok: true, path: 'tmux' };
}

async function deliverInitialPromptWithRetry(
  agentId: string,
  prompt: string,
  caller: string,
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<DeliveryResult> {
  let lastFailure = 'not-attempted';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const ready = await waitForReadySignal(agentId, 30);
    if (!ready) {
      lastFailure = 'ready-signal-timeout';
      console.error(`[${agentId}] Claude did not become ready within 30s (kickoff attempt ${attempt}/2)`);
      continue;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    try {
      const result = await deliverAgentMessage(agentId, prompt, caller, deliveryMethod);
      if (result.ok) return result;
      lastFailure = result.failure ?? `delivery returned ok=false via ${result.path}`;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
    console.error(`[${agentId}] Kickoff delivery attempt ${attempt}/2 failed: ${lastFailure}`);
  }

  return { ok: false, path: 'tmux', failure: lastFailure };
}

async function buildResumeMessageForAgent(
  state: AgentState,
  fallbackMessage: string,
  callerMessage?: string,
): Promise<{ message?: string; redeliveringKickoff: boolean; error?: string }> {
  if (state.role !== 'work' || state.kickoffDelivered !== false) {
    return { message: callerMessage ?? fallbackMessage, redeliveringKickoff: false };
  }

  const promptPath = join(getAgentDir(state.id), 'initial-prompt.md');
  try {
    const kickoffPrompt = await readFile(promptPath, 'utf-8');
    const suffix = callerMessage
      ? `\n\n---\n\nAdditional message delivered during resume:\n\n${callerMessage}`
      : '';
    return { message: `${kickoffPrompt}${suffix}`, redeliveringKickoff: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      redeliveringKickoff: true,
      error: `kickoff prompt missing at ${promptPath}: ${reason}`,
    };
  }
}

function markKickoffRedelivered(state: AgentState): void {
  state.kickoffDelivered = true;
  saveAgentStateSync(state);
}

async function recordKickoffDeliveryFailure(state: AgentState, issueId: string, source: Role | 'work-agent'): Promise<void> {
  await Effect.runPromise(recordAgentFailure(state.id, 'kickoff delivery failed'));
  const failedState = await Effect.runPromise(getAgentState(state.id));
  if (failedState) {
    failedState.status = 'running';
    failedState.kickoffDelivered = false;
    await Effect.runPromise(saveAgentState(failedState));
  }
  state.status = 'running';
  state.kickoffDelivered = false;
  emitActivityEntrySync({
    source,
    level: 'error',
    message: `${state.id}: kickoff delivery failed`,
    issueId,
  });
}

export async function deliverAgentPermissionDecision(
  agentId: string,
  requestId: string,
  behavior: 'allow' | 'deny',
): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  let state: AgentState | null = null;
  try {
    state = await Effect.runPromise(getAgentState(normalizedId));
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

  const bridgeToken = readBridgeTokenSync(normalizedId);
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

interface SupervisorDecision {
  eligible: boolean;
  reason?: string;
}

export function decideSupervisorForWorkAgent(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): SupervisorDecision {
  void options;
  const log = (eligible: boolean, reason?: string): void => {
    const tag = eligible ? 'supervisor:eligible' : `supervisor:ineligible:${reason ?? 'unknown'}`;
    console.log(`[${agentId}] ${tag}`);
  };

  if (state.role !== 'work') {
    log(false, 'not-a-work-agent');
    return { eligible: false, reason: 'not-a-work-agent' };
  }

  if (process.env.PANOPTICON_DOCKER_WORKSPACE === '1' || process.env.PAN_DOCKER === '1') {
    log(false, 'docker-not-supported-yet');
    return { eligible: false, reason: 'docker-not-supported-yet' };
  }

  if (state.harness !== 'claude-code') {
    const reason = `harness-${state.harness ?? 'unknown'}`;
    log(false, reason);
    return { eligible: false, reason };
  }

  log(true);
  return { eligible: true };
}

async function prepareSupervisorForFreshLaunch(
  agentId: string,
  options: SpawnOptions,
  state: AgentState,
): Promise<{ useSupervisor: boolean; supervisorScriptPath?: string }> {
  const supervisorDecision = decideSupervisorForWorkAgent(agentId, options, state);
  if (!supervisorDecision.eligible) {
    delete state.supervisorEnabled;
    return { useSupervisor: false };
  }

  const supervisorScriptPath = resolvePtySupervisorScriptPath();
  if (!existsSync(supervisorScriptPath)) {
    throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
  }
  await writePtyToken(agentId);
  state.supervisorEnabled = true;
  return { useSupervisor: true, supervisorScriptPath };
}

async function prepareSupervisorForRelaunch(
  agentId: string,
  state: AgentState,
  model: string,
  harness: RuntimeName,
): Promise<{ useSupervisor: boolean; supervisorScriptPath?: string }> {
  if (state.supervisorEnabled !== true) {
    return { useSupervisor: false };
  }

  const relaunchState: AgentState = { ...state, model, harness };
  const supervisorDecision = decideSupervisorForWorkAgent(agentId, {
    issueId: state.issueId || agentId.replace(/^agent-/, '').toUpperCase(),
    workspace: state.workspace,
    role: 'work',
    model,
    harness,
    allowHost: state.hostOverride,
  }, relaunchState);
  if (!supervisorDecision.eligible) {
    delete state.supervisorEnabled;
    return { useSupervisor: false };
  }

  const supervisorScriptPath = resolvePtySupervisorScriptPath();
  if (!existsSync(supervisorScriptPath)) {
    throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
  }
  await writePtyToken(agentId);
  state.supervisorEnabled = true;
  return { useSupervisor: true, supervisorScriptPath };
}

function resolvePtySupervisorScriptPath(): string {
  return join(packageRoot, 'dist', 'pty-supervisor.js');
}

/**
 * Decide whether to enable Claude Code Channels for a work-agent launch.
 *
 * Eligibility (all required):
 *   - experimental.claudeCodeChannelsMcp is true in the merged config
 *   - the agent is a work agent (specialists/conversations stay off MCP)
 *   - the harness is Claude Code (not Pi or another runtime harness)
 *   - auth provider is Anthropic-direct (excludes Bedrock/Vertex/Foundry)
 *   - the workspace is not running inside a Docker container
 *
 * Logs the decision exactly once with a category prefix so users can see why
 * the bridge did or did not engage. The function is otherwise side-effect
 * free; the caller is responsible for writing the .mcp.json and mutating
 * state.channelsEnabled when eligible is true. This legacy MCP transport is now
 * opt-in for new spawns; the PTY supervisor is the default delivery transport.
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

  if (!isClaudeCodeChannelsMcpEnabled()) {
    return { eligible: false, reason: 'mcp-default-off' };
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
  const provider = getProviderForModelSync(state.model as ModelId);
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
      const pane = await Effect.runPromise(capturePane(agentId, 50));
      if (pane.includes(NEEDLE)) {
        // Dialog is up. Send Enter, then keep re-sending until the needle
        // clears — the first keystroke can land before the TUI is ready to
        // accept it, leaving the dialog stuck on screen.
        const dismissStart = Date.now();
        while (Date.now() - dismissStart < DISMISS_BUDGET_MS) {
          await Effect.runPromise(sendRawKeystroke(agentId, 'C-m', 'channels:dismiss-dev-dialog'));
          await new Promise((r) => setTimeout(r, RESEND_INTERVAL_MS));
          const after = await Effect.runPromise(
            capturePane(agentId, 50).pipe(Effect.catch(() => Effect.succeed(''))),
          );
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

function getAgentResumeGateBlockReason(state: Pick<AgentState, 'paused' | 'pausedReason' | 'troubled' | 'consecutiveFailures'>): string | undefined {
  if (state.paused === true) {
    return state.pausedReason
      ? `agent is paused (${state.pausedReason})`
      : 'agent is paused';
  }
  if (state.troubled === true) {
    const failures = state.consecutiveFailures ?? 0;
    return `agent is troubled (${failures} failure${failures === 1 ? '' : 's'})`;
  }
  return undefined;
}

function assertAgentCanTransitionToRunning(state: AgentState): void {
  const reason = getAgentResumeGateBlockReason(state);
  if (reason) {
    throw new Error(`Cannot run ${state.id}: ${reason}. Clear the gate before resuming.`);
  }
}

function markAgentRunning(state: AgentState): void {
  assertAgentCanTransitionToRunning(state);
  const oldStatus = state.status;
  state.status = 'running';
  state.lastActivity = new Date().toISOString();
  clearFailureTrackingFields(state);
  delete state.stoppedAt;
  // Clear user-stop intent so a later crash/orphan can be auto-resumed. Without
  // this the flag is sticky across the stop→resume→crash sequence and autoResume
  // would permanently skip the agent on any subsequent orphan recovery.
  delete state.stoppedByUser;
  logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → running (markAgentRunning)`);
}

function markAgentStopped(state: AgentState): void {
  const oldStatus = state.status;
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  state.stoppedByUser = true;
  logAgentLifecycleSync(state.id, `status changed: ${oldStatus} → stopped (markAgentStopped, user-initiated)`);
}

export function markAgentStoppedState(state: AgentState): AgentState {
  if (!state.id) {
    state.id = normalizeAgentId(state.issueId);
  }
  markAgentStopped(state);
  return state;
}

export function markAgentRunningState(state: AgentState): AgentState {
  if (!state.id) {
    state.id = normalizeAgentId(state.issueId);
  }
  markAgentRunning(state);
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
// lib uses getRuntimeSnapshot (Effect-native); CLI/out-of-process uses
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
import { getRuntimeSnapshot, isAgentStateServiceInProcess } from './agent-runtime-mirror.js';

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
  contextSaturatedAt?: string;
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
    contextSaturatedAt: snap.contextSaturatedAt,
  };
}

export function getAgentRuntimeStateSync(agentId: string): AgentRuntimeState | null {
  // Sync path: read from the in-process mirror (empty in fresh CLI processes,
  // populated inside the dashboard server). CLI commands should use
  // getAgentRuntimeStateProgram so they fall through to HTTP.
  return snapshotToRuntimeState(Effect.runSync(getRuntimeSnapshot(agentId)));
}

export const getAgentRuntimeState = (agentId: string): Effect.Effect<AgentRuntimeState | null> =>
  Effect.gen(function* () {
    if (yield* isAgentStateServiceInProcess()) {
      return snapshotToRuntimeState(yield* getRuntimeSnapshot(agentId));
    }

    const snap = yield* fetchAgentRuntimeSnapshot(agentId);
    return snapshotToRuntimeState(snap);
  });

async function patchRuntimeJson(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
  const agentDir = getAgentDir(agentId);
  const runtimeFile = join(agentDir, 'runtime.json');
  let runtime: Record<string, unknown> = {};

  try {
    runtime = JSON.parse(await readFile(runtimeFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    runtime = {};
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'contextSaturatedAt')) {
    if (patch.contextSaturatedAt === undefined) {
      delete runtime.contextSaturatedAt;
    } else {
      runtime.contextSaturatedAt = patch.contextSaturatedAt;
    }
  }

  await mkdir(agentDir, { recursive: true });
  await writeFile(runtimeFile, JSON.stringify(runtime, null, 2));
}

/**
 * Emit events derived from a legacy-shape patch. Callers gradually migrate to
 * direct emitAgentEvent calls; this adapter keeps existing code working.
 */
export async function saveAgentRuntimeState(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
  if (patch.currentIssue !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'current_issue_set',
      currentIssue: patch.currentIssue || undefined,
    }));
  }

  if (patch.resolution !== undefined && patch.resolutionCount !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'resolution_set',
      resolution: patch.resolution,
      resolutionCount: patch.resolutionCount,
    }));
  }

  if (patch.state !== undefined) {
    if (patch.state === 'waiting-on-human') {
      await Effect.runPromise(emitAgentEvent(agentId, {
        kind: 'waiting_start',
        reason: (patch.waitingReason as 'tool_permission' | 'user_question' | 'disambiguation' | 'other') || 'other',
        message: patch.waitingNotification,
      }));
    } else if (patch.state === 'active') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool }));
    } else if (patch.state === 'idle') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'idle' }));
    } else if (patch.state === 'stopped') {
      await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'stopped' }));
    }
  } else if (patch.currentTool !== undefined) {
    await Effect.runPromise(emitAgentEvent(agentId, { kind: 'activity', activity: 'working', tool: patch.currentTool }));
  }

  if (patch.claudeSessionId) {
    // model_set requires a model — use existing snapshot's model if present.
    const snap = getAgentRuntimeStateSync(agentId);
    if (snap || patch.claudeSessionId) {
      await Effect.runPromise(emitAgentEvent(agentId, {
        kind: 'model_set',
        model: 'unknown',
        claudeSessionId: patch.claudeSessionId,
      }));
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'contextSaturatedAt')) {
    await patchRuntimeJson(agentId, patch);
    await Effect.runPromise(emitAgentEvent(agentId, {
      kind: 'context_saturation_changed',
      contextSaturatedAt: patch.contextSaturatedAt,
    }));
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
export function getLatestSessionIdSync(agentId: string): string | null {
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

  return null;
}

export const getLatestSessionId = (agentId: string): Effect.Effect<string | null> => {
  const agentDir = getAgentDir(agentId);
  const sessionFile = join(agentDir, 'session.id');
  const sessionsFile = join(agentDir, 'sessions.json');

  return Effect.gen(function* () {
    const sessionId = yield* Effect.tryPromise({
      try: () => readFile(sessionFile, 'utf8'),
      catch: (cause) => toAgentFsError('read', sessionFile, cause),
    }).pipe(
      Effect.map((content) => content.trim()),
      Effect.orElseSucceed(() => ''),
    );
    if (sessionId) return sessionId;

    const latestSession = yield* Effect.tryPromise({
      try: async () => JSON.parse(await readFile(sessionsFile, 'utf8')) as unknown,
      catch: (cause) => toAgentFsError('read', sessionsFile, cause),
    }).pipe(
      Effect.map((sessions) => Array.isArray(sessions) && sessions.length > 0 ? String(sessions[sessions.length - 1]) : null),
      Effect.orElseSucceed(() => null),
    );
    if (latestSession) return latestSession;

    const runtimeState = yield* getAgentRuntimeState(agentId);
    return runtimeState?.claudeSessionId ?? null;
  });
};

export interface SpawnOptions {
  issueId: string;
  workspace: string;
  /** Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted. */
  harness?: RuntimeName;
  model?: string;
  prompt?: string;
  /**
   * Spawn role. Defaults to 'work'. The 'strike' role is the bypass path that
   * skips plan/review/test/ship and lands directly on main — see roles/strike.md.
   * Strike sessions are named `strike-<issue-id>` instead of `agent-<issue-id>`.
   */
  role?: 'work' | 'strike';
  difficulty?: ComplexityLevel;
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis';
  workType?: string; // Explicit work type ID (overrides phase-based detection)

  // PAN-1517: swarm slot fields removed (slotId, swarmItemId). Parallelism
  // is now in-context via subagents (see roles/work.md), not via slot agents.
  // `allowHost` (workspace-isolation override) stays — it predates the swarm
  // runtime and is used by review/test/ship agents independently.
  allowHost?: boolean;
  flywheelRunId?: string;
  /** Claude Code `--effort` level for the spawned session (work/strike). */
  effort?: RoleEffort;
}

export interface SpawnRunOptions {
  workspace?: string;
  harness?: RuntimeName;
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
  registerConversation?: boolean;
  effort?: RoleEffort;
  resumeSessionId?: string;
  flywheelRunId?: string;
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

  const variant = await Effect.runPromise(readCavemanVariant(workspacePath));

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
/**
 * Models that are known-broken for autonomous *work* agents and must never be
 * used to spawn one, even if a project pins them in config. The gate falls back
 * to WORK_AGENT_FALLBACK_MODEL (loudly) for the work role when the model wasn't
 * an explicit per-spawn override.
 *
 * Empty as of PAN-1584: gpt-5.5 used to wedge at launch with CLIProxy "System
 * messages are not allowed", which was a stale CLIProxyAPI binary (6.9.45)
 * mis-translating Claude Code's request to the Codex backend. Upgrading the
 * pinned CLIProxyAPI to v7.1.39 (+ a version-aware installer) fixed it; gpt-5.5
 * work agents now launch clean under the claude-code harness. The mechanism is
 * retained for any future known-broken model. (Pi-harness gpt-5.5 was not
 * re-verified in this pass — re-add 'gpt-5.5' here if a Pi init hang resurfaces.)
 */
const WORK_AGENT_BROKEN_MODELS = new Set<string>([]);
/** Safe fallback when a work agent's resolved model is work-broken. */
const WORK_AGENT_FALLBACK_MODEL = 'claude-sonnet-4-6';

export function determineModel(options: { model?: string; role?: Role } = {}): string {
  const modelOverride = normalizeModelOverrideSync(options.model);
  const resolved = modelOverride
    ? modelOverride
    : requireModelOverrideSync(resolveModel(options.role ?? 'work', undefined, loadYamlConfig().config));

  // Work-agent safety net: a config pin (or smart-selection) must not spawn a
  // work agent on a model that is known to wedge for the work role. Fall back
  // loudly rather than launch a dead agent. Only applies to the work role and
  // only when the model wasn't an explicit, deliberate per-spawn override.
  const role = options.role ?? 'work';
  if (role === 'work' && !modelOverride && WORK_AGENT_BROKEN_MODELS.has(resolved)) {
    console.warn(
      `[determineModel] resolved work model "${resolved}" is known-broken for work agents; ` +
      `falling back to "${WORK_AGENT_FALLBACK_MODEL}". Update roles.work.model in config to silence this.`,
    );
    return WORK_AGENT_FALLBACK_MODEL;
  }

  return resolved;
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
  const projectConfig = workspacePath ? findProjectByPathSync(workspacePath) : null;
  if (!projectConfig) {
    throw new Error(`Cannot transition ${issueId}: no project config found for workspace ${workspacePath || '(none)'}. Register the project in projects.yaml.`);
  }

  // Project has a GitHub repo — use GitHub Issues tracker.
  // Checked BEFORE issue_prefix because github_repo projects (e.g. panopticon-cli)
  // set issue_prefix for their GitHub Issue prefix (PAN-), not for Linear.
  if (projectConfig.github_repo) {
    const [owner, repo] = projectConfig.github_repo.split('/');
    const tracker = createTracker({ type: 'github', owner, repo });
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via GitHub (${projectConfig.github_repo})`);
    return;
  }

  // Project has a Rally project — use Rally tracker
  if (projectConfig.rally_project) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.rally) {
      throw new Error(`Project ${projectConfig.name} uses Rally (project: ${projectConfig.rally_project}) but no Rally tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'rally');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via Rally (project: ${projectConfig.rally_project})`);
    return;
  }

  // Project has a Linear team prefix (and no github_repo) — use Linear tracker.
  // This covers: pure-Linear projects and gitlab+Linear projects (e.g. mind-your-now).
  if (getIssuePrefix(projectConfig)) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.linear) {
      throw new Error(`Project ${projectConfig.name} uses Linear (team: ${getIssuePrefix(projectConfig)}) but no Linear tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'linear');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
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
  useSupervisor?: boolean;
  supervisorScriptPath?: string;
  /**
   * Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted —
   * preserves bit-for-bit pre-PAN-636 behavior. When 'pi', the launcher is
   * built via the Pi command-line generator instead of the claude path; opts
   * like agentId-as-name and agent-frontmatter are ignored because Pi has
   * no agent-definition system.
   */
  harness?: RuntimeName;
  extraEnvExports?: string[];
  /** Claude Code `--effort` level threaded into the launcher command. */
  effort?: RoleEffort;
  /** Inline prompt to embed in the launch command (used for codex exec resume). */
  promptInline?: string;
}): Promise<AgentLaunchConfig> {
  const model = requireModelOverrideSync(opts.model);

  // Substrate guard: inject permission deny rules for Panopticon infrastructure
  // paths (.claude/agents/, .claude/hooks/, ~/.panopticon/, JSONL session dirs)
  // into the workspace's .claude/settings.local.json. Idempotent. Without this
  // a vBRIEF action like "delete the legacy pan-*-agent.md files" can convince
  // an agent to brick its own runtime. PAN-1048 X1 incident, 2026-05-09.
  try {
    const { injectPanopticonInfraDeny } = await import('./claude-settings-overlay.js');
    await Effect.runPromise(injectPanopticonInfraDeny(opts.workspace));
  } catch (err) {
    console.warn(`[agents] injectPanopticonInfraDeny failed for ${opts.agentId} (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  const providerEnv = await getProviderEnvForModel(model);

  const provider = getProviderForModelSync(model as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuthSync(provider, opts.workspace);
  } else {
    clearCredentialFileAuthSync(opts.workspace);
  }

  const providerExports = await getProviderExportsForModel(model);

  // PAN-1048: resume/restart launchers must respect the agent's role.
  // A resumed review/test/ship run loads the wrong frontmatter (and wrong
  // tool permissions) if it always points at roles/work.md.
  const launchRole: Role = opts.isPlanning ? 'plan' : opts.role;

  // PAN-1055: pi harness needs --session-dir + fifo redirect threaded into
  // the launcher; getPiLauncherFields() resolves them from the agent state
  // and they're spread into generateLauncherScript() below.
  // PAN-1574: codex harness needs its per-agent CODEX_HOME path.
  const piLauncherFields = opts.harness === 'pi'
    ? await getPiLauncherFields(opts.agentId, model)
    : {};
  const codexLauncherFields = opts.harness === 'codex'
    ? getCodexLauncherFields(opts.agentId, model)
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
    const bypassPrefix = bypassPrefixForAgentFlagSync();
    const bypassFlag = bypassPrefix ? `${bypassPrefix.trim()} ` : '';
    const launcherContent = generateLauncherScriptSync({
      role: launchRole,
      spawnMode: 'resume',
      workingDir: opts.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      // PAN-1048 + PAN-1055: claude-code resumes load the role-specific
      // frontmatter (roleAgentDefinitionPath); pi resumes route through
      // getAgentRuntimeBaseCommand which short-circuits to the pi rpc form.
      baseCommand: opts.harness === 'pi' || opts.harness === 'codex'
        ? await getAgentRuntimeBaseCommand(model, opts.agentId, launchRole, opts.harness)
        : `claude ${bypassFlag}--agent ${roleAgentDefinitionPath(launchRole)}`,
      resumeSessionId: opts.resumeSessionId,
      model: opts.harness === 'pi' || opts.harness === 'codex' || providerExports.includes('ANTHROPIC_BASE_URL') ? model : undefined,
      extraArgs: opts.harness === 'pi' || opts.harness === 'codex' ? undefined : `--name ${opts.agentId}`,
      appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
      extraEnvExports: opts.extraEnvExports,
      useSupervisor: opts.useSupervisor,
      supervisorScriptPath: opts.supervisorScriptPath,
      promptInline: opts.promptInline,
      ...piLauncherFields,
      ...codexLauncherFields,
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
  const launcherContent = generateLauncherScriptSync({
    role: launchRole,
    workingDir: opts.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    cavemanExports,
    baseCommand: await getAgentRuntimeBaseCommand(model, opts.agentId, agentDefinition, opts.harness ?? 'claude-code', opts.effort),
    appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
    extraEnvExports: opts.extraEnvExports,
    useSupervisor: opts.useSupervisor,
    supervisorScriptPath: opts.supervisorScriptPath,
    // PAN-1574: codex work agents embed the initial prompt inline in `codex exec`.
    promptInline: opts.promptInline,
    ...piLauncherFields,
    ...codexLauncherFields,
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
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) {
    throw new Error(`Cannot spawn role run for ${issueId}: no project is configured for this issue prefix`);
  }
  return join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

export async function retrieveSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  if (!input.prompt.trim()) return '';

  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(input.workspace),
      workspaceId: basename(input.workspace),
      issueId: input.issueId,
      runId: input.agentId,
      sessionId: input.agentId,
      agentRole: input.role,
      agentHarness: input.harness,
    };
    const { injectPromptTimeMemory } = await import('./memory/injection.js');
    return (await injectPromptTimeMemory({ prompt: input.prompt, identity, surface: 'spawn' })).context;
  } catch (error) {
    console.warn(`[agents] Spawn-time memory context unavailable for ${input.agentId}:`, error instanceof Error ? error.message : String(error));
    return '';
  }
}

async function withSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  const context = await retrieveSpawnTimeMemoryContext(input);
  return context ? `${context}\n\n---\n\n${input.prompt}` : input.prompt;
}

function inferMemoryProjectId(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  if (workspaceName.startsWith('feature-')) return basename(dirname(dirname(workspacePath)));
  return workspaceName;
}

function runAgentId(issueId: string, role: Role, subRole?: string): string {
  const base = role === 'work'
    ? `agent-${issueId.toLowerCase()}`
    : `agent-${issueId.toLowerCase()}-${role}`;
  return subRole ? `${base}-${subRole}` : base;
}

/**
 * Spawn-time stack-rebuild self-heal state. PAN-1618: the work-spawn gate
 * (`assertWorkspaceStackHealthyForSpawn`) used to fail hard when the workspace
 * docker stack was down, with only manual recoveries (`pan workspace rebuild`
 * or interactive `--host`). Under autonomous operation a fully-planned
 * `proposed` item whose stack happened to be down could never auto-start its
 * work agent — it sat at the gate forever. This mirrors the PAN-1247
 * orphan-test self-heal one role earlier: rebuild the stack before failing,
 * bounded by a cooldown + attempt cap so a stack that genuinely cannot be
 * rebuilt escalates to a human instead of looping `docker compose` forever.
 */
const spawnStackRebuildState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean; hostFallbackNoticed?: boolean }> =
  new Map();
const SPAWN_STACK_REBUILD_COOLDOWN_MS = 15 * 60 * 1000;
const SPAWN_STACK_REBUILD_MAX_ATTEMPTS = 3;

/**
 * Spawn a role-based Panopticon run. Work delegates to the existing work-agent
 * path; review/test/ship use the role definition files under roles/.
 */
export async function assertWorkspaceStackHealthyForSpawn(
  issueId: string,
  role: Role,
  allowHost = false,
  workspacePath?: string,
): Promise<void> {
  if (role === 'plan') return;

  const normalizedIssue = issueId.toUpperCase();

  const health = await Effect.runPromise(getWorkspaceStackHealth(issueId, { workspacePath }));
  if (health.healthy) {
    spawnStackRebuildState.delete(normalizedIssue);
    return;
  }

  const details = health.reasons.join('; ');
  const message = `Workspace docker stack for ${normalizedIssue} is not healthy: ${details}. Run 'pan workspace rebuild ${normalizedIssue}' or retry with --host to override.`;

  if (allowHost) {
    // PAN-1556: host-override is a per-spawn detail, not user-facing activity —
    // it fired once per convoy member and buried real feed items (conversations).
    // Keep the console.warn for debugging; do not emit to the session feed.
    console.warn(`[agents] ${message}`);
    return;
  }

  // PAN-1645 + PAN-1618: an unhealthy stack must NEVER *block* the advancing
  // roles. review/test/ship all operate on the HOST workspace — ship
  // rebases/pushes against the host .git, review reads the committed diff, and
  // test runs the project's quality gates (host-run unless a gate explicitly
  // opts into a container) — so they do not need the workspace's docker
  // containers at all. The long-standing manual `--host` workaround (PAN-1645)
  // burned enormous effort just rediscovering that ship-on-broken-docker is a
  // false gate. For these roles we still attempt one bounded autonomous rebuild
  // (so a project whose test gates DO run in containers gets a healthy stack
  // when recoverable), but if it can't be made healthy we AUTO-FALL-BACK TO
  // HOST and proceed instead of throwing.
  //
  // `work` is different: a work agent may rely on the dev container's services,
  // so silently running it on the host could build/test against a missing
  // environment. work keeps the hard gate (rebuild → escalate to a human).
  const hostFallbackEligible = role !== 'work';

  const record = spawnStackRebuildState.get(normalizedIssue)
    ?? { lastAttempt: 0, attempts: 0, escalated: false };
  const now = Date.now();

  const fallbackToHost = (reason: string): void => {
    console.warn(`[agents] ${message} — auto-falling back to host for ${role} (${reason})`);
    // Emit the host-fallback notice once per issue. Use a SEPARATE latch from
    // the work-escalation latch (`escalated`): if review/test/ship trip the
    // host fallback first, a later `work` spawn for the same broken-stack issue
    // must still be able to emit its own (error-level) dead-end marker — the
    // operator's only signal that a work agent is blocked on docker.
    if (!record.hostFallbackNoticed) {
      record.hostFallbackNoticed = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'warn',
        issueId: normalizedIssue,
        message: `agent-spawn-host-fallback: ${normalizedIssue}`,
        details: `Workspace docker stack unhealthy (${details}); ${role} runs on the host (rebase/verify use host .git + host gates), so proceeding without containers. ${reason}`,
      });
    }
  };

  const blockWork = (markerMessage: string, errDetails: string): never => {
    if (!record.escalated) {
      record.escalated = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'error',
        issueId: normalizedIssue,
        message: markerMessage,
        details: errDetails,
      });
    }
    throw new Error(message);
  };

  if (record.attempts >= SPAWN_STACK_REBUILD_MAX_ATTEMPTS) {
    if (hostFallbackEligible) {
      fallbackToHost(`rebuild exhausted after ${record.attempts} attempts`);
      return;
    }
    blockWork(
      `agent-spawn-stack-rebuild-exhausted: ${normalizedIssue}`,
      `Workspace docker stack still unhealthy after ${record.attempts} rebuild attempts: ${details}. Manual 'pan workspace rebuild ${normalizedIssue}' or retry with --host needed.`,
    );
  }

  if (now - record.lastAttempt < SPAWN_STACK_REBUILD_COOLDOWN_MS) {
    // A rebuild was attempted recently and the stack is still unhealthy —
    // don't hammer `docker compose` every spawn.
    if (hostFallbackEligible) {
      fallbackToHost('rebuild on cooldown');
      return;
    }
    blockWork(`agent-spawn-blocked-stack-unhealthy: ${normalizedIssue}`, details);
  }

  record.lastAttempt = now;
  record.attempts += 1;
  spawnStackRebuildState.set(normalizedIssue, record);
  console.log(
    `[agents] Workspace stack for ${normalizedIssue} unhealthy (${details}) — rebuilding ` +
      `before spawn (attempt ${record.attempts}/${SPAWN_STACK_REBUILD_MAX_ATTEMPTS})`,
  );

  const { rebuildWorkspaceStack } = await import('./workspace/rebuild-stack.js');
  const result = await Effect.runPromise(
    rebuildWorkspaceStack(issueId, {
      onProgress: (m) => console.log(`[agents]   ${normalizedIssue} stack rebuild: ${m}`),
    }),
  ).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : String(err) }));

  if (result.success) {
    spawnStackRebuildState.delete(normalizedIssue);
    console.log(`[agents] Workspace stack for ${normalizedIssue} rebuilt — proceeding with spawn`);
    return;
  }

  console.warn(`[agents] Workspace stack rebuild failed for ${normalizedIssue}: ${result.error}`);
  if (hostFallbackEligible) {
    fallbackToHost(`rebuild failed: ${result.error ?? 'unknown'}`);
    return;
  }
  blockWork(`agent-spawn-stack-rebuild-failed: ${normalizedIssue}`, result.error ?? details);
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
      flywheelRunId: options.flywheelRunId,
      effort: options.effort,
    });
  }

  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);

  const agentId = options.agentId ?? runAgentId(issueId, role, options.subRole);
  if (await Effect.runPromise(sessionExists(agentId))) {
    throw new Error(`Role run ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(issueId, role, options.allowHost, workspace);

  initHookSync(agentId);

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
  const requestedHarness: RuntimeName = options.harness
    ?? loadYamlConfig().config.roles?.[role]?.harness
    ?? 'claude-code';
  const resolvedHarness: RuntimeName = await resolveEffectiveHarness(requestedHarness, selectedModel);

  if (
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('./cliproxy.js');
    if (!(await Effect.runPromise(isCliproxyRunning()))) {
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
  await Effect.runPromise(saveAgentState(state));

  const isSpecialistRole = role === 'review' || role === 'test' || role === 'ship';
  const shouldRegisterConversation = isSpecialistRole || options.registerConversation === true;
  // PAN-1557: convoy sub-reviewers are now interactive specialists — deliver
  // their prompt via tmux after Claude boots (same as the orchestrator/test/
  // ship), not on stdin to a headless `claude --print`.
  const shouldDeliverPromptViaTmux = shouldRegisterConversation && resolvedHarness === 'claude-code';
  const shouldDeliverPromptViaPi = shouldRegisterConversation && resolvedHarness === 'pi';
  // For Codex, the initial prompt is passed inline to `codex exec` via promptFile.
  const prompt = options.prompt
    ? await withSpawnTimeMemoryContext({
        prompt: options.prompt,
        issueId,
        workspace,
        agentId,
        role,
        harness: resolvedHarness,
      })
    : '';

  let promptFile: string | undefined;
  if (prompt && !shouldDeliverPromptViaTmux && !shouldDeliverPromptViaPi) {
    promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
    await writeFileAsync(promptFile, prompt);
  }

  checkAndSetupHooks();

  const provider = getProviderForModelSync(selectedModel as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuthSync(provider, workspace);
  } else {
    clearCredentialFileAuthSync(workspace);
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
  const codexLauncherFields = resolvedHarness === 'codex'
    ? getCodexLauncherFields(agentId, selectedModel)
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
  let sessionId: string | undefined;
  if (shouldRegisterConversation) {
    // When resuming, reuse the prior JSONL session so `claude --resume` reloads conversation history.
    // When starting fresh, generate a new UUID and use `claude --session-id`.
    const rawSessionId = options.resumeSessionId ?? randomUUID();

    // Persist the session ID to <agentDir>/session.id so resolveClaudeSessionId can locate the
    // JSONL after the specialist exits. Works for both fresh (--session-id) and resumed (--resume).
    try {
      const agentDir = getAgentDir(agentId);
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, 'session.id'), rawSessionId, 'utf-8');
    } catch (err) {
      console.warn(`[spawnRun] Failed to persist session.id for ${agentId}:`, err instanceof Error ? err.message : String(err));
    }

    try {
      const conversation = {
        name: agentId,
        tmuxSession: agentId,
        cwd: workspace,
        issueId,
        claudeSessionId: rawSessionId,
        model: selectedModel,
        harness: resolvedHarness,
      };
      if (getConversationByName(agentId)) {
        reactivateConversationForSpawn(conversation);
      } else {
        createConversation(conversation);
      }
    } catch (err) {
      // Non-fatal: the specialist still runs, but without a conversation record
      console.warn(`[spawnRun] Failed to register conversation for ${agentId}:`, err instanceof Error ? err.message : String(err));
    }

    // Only set sessionId (→ --session-id flag) for fresh spawns.
    // Resumes pass resumeSessionId (→ --resume flag) to the launcher instead.
    if (!options.resumeSessionId) {
      sessionId = rawSessionId;
    }
  }

  // PAN-1557: convoy reviewers are interactive now, so the launcher no longer
  // owns the REVIEWER_READY/FAILED signal (which previously rode a `claude
  // --print` process exit). The Stop-hook delivers REVIEWER_READY to the
  // synthesis agent when the reviewer finishes its turn with a written report;
  // Deacon's REVIEWER_TIMEOUT remains the failure failsafe. We still persist
  // the synthesis/output wiring on state.json so the Stop-hook can read it.
  if (options.reviewSynthesisAgentId) state.reviewSynthesisAgentId = options.reviewSynthesisAgentId;
  if (options.reviewOutputPath) state.reviewOutputPath = options.reviewOutputPath;

  const launcherContent = generateLauncherScriptSync({
    role,
    workingDir: workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    promptFile: shouldDeliverPromptViaTmux ? undefined : promptFile,
    promptFileMode: undefined,
    panopticonEnv: { agentId, issueId, sessionType: options.subRole ? `${role}.${options.subRole}` : role },
    extraEnvExports: flywheelEnvExports(flywheelEnv),
    baseCommand: await getRoleRuntimeBaseCommand(selectedModel, agentId, role, resolvedHarness, options.subRole, options.effort),
    appendSystemPromptFiles: await claudeSystemPromptFiles(workspace, resolvedHarness),
    sessionId,
    resumeSessionId: options.resumeSessionId,
    reviewSignal: undefined,
    trapHup: undefined,
    ...piLauncherFields,
    ...codexLauncherFields,
  });

  const launcherScript = join(getAgentDir(agentId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, launcherContent);
  const claudeCmd = `bash ${launcherScript}`;
  console.log(`[claude-invoke] purpose=role-run | role=${role} | model=${state.model} | source=agents.ts:spawnRun | session=${agentId} | command="${claudeCmd}"`);

  try {
    const { preTrustDirectory } = await import('./workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(workspace);
  } catch { /* non-fatal */ }

  // PAN-1594: clear any stale ready.json before launch so waitForReadySignal()
  // only observes the session-start signal from THIS launch.
  clearReadySignal(agentId);

  await Effect.runPromise(createSession(agentId, workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV,
      TERM: 'xterm-256color',
      PANOPTICON_AGENT_ID: agentId,
      PANOPTICON_ISSUE_ID: issueId,
      PANOPTICON_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      GIT_SEQUENCE_EDITOR: 'false',
      ...flywheelEnv,
      ...providerEnv,
    },
  }));
  await Effect.runPromise(setOption(agentId, 'destroy-unattached', 'off'));
  await Effect.runPromise(setOption(agentId, 'remain-on-exit', 'on'));

  // PAN-1574: codex specialists are headless one-shot processes. After the session
  // starts, poll for the rollout JSONL to capture the real thread-id, then write it
  // to both codex-thread-id and session.id so getLatestSessionIdSync returns the
  // correct value for later resumes (spawnRun wrote a placeholder UUID to session.id
  // at conversation-register time; we overwrite it here with the real thread-id).
  if (resolvedHarness === 'codex') {
    const { waitForCodexRollout, extractThreadIdFromRollout, writeThreadId: writeCodexThreadId } =
      await import('./runtimes/codex.js');
    const codexHomeForAgent = join(homedir(), '.panopticon', 'agents', agentId, 'codex-home');
    const rolloutPath = await waitForCodexRollout(codexHomeForAgent, 30000);
    if (rolloutPath) {
      const threadId = extractThreadIdFromRollout(rolloutPath);
      if (threadId) {
        writeCodexThreadId(agentId, threadId);
        try {
          await writeFile(join(getAgentDir(agentId), 'session.id'), threadId, 'utf-8');
        } catch (err) {
          console.warn(`[spawnRun] Failed to update session.id with codex thread-id for ${agentId}:`, err instanceof Error ? err.message : String(err));
        }
      }
    } else {
      console.warn(`[spawnRun] Codex specialist ${agentId}: rollout did not appear within 30s — thread-id not captured`);
    }
  }

  if (prompt) {
    if (shouldDeliverPromptViaPi) {
      try {
        await writePiAgentPrompt(agentId, prompt);
      } catch (err) {
        console.error(`[${agentId}] Pi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      }
    } else if (shouldDeliverPromptViaTmux) {
      // PAN-1594: wait for the hook-written ready.json (session-start hook),
      // not a tmux pane-scrape. No dependency on permission-mode footer text.
      const ready = await waitForReadySignal(agentId, 30);
      if (ready) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        await deliverAgentMessage(agentId, prompt, 'spawnRun:initial-prompt');
      } else {
        console.error(`[${agentId}] Claude did not become ready within 30s`);
      }
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

  await Effect.runPromise(saveAgentState(state));

  // PAN-1556: the review role emits a single dedicated "Review role spawned"
  // event from spawnReviewRoleForIssue. Suppress the generic per-spawn
  // "role started" for review so the orchestrator + 4 convoy sub-reviewers
  // don't each spam the session feed and bury conversations.
  if (role !== 'review') {
    emitActivityEntrySync({
      source: role,
      level: 'info',
      message: `${role} role started for ${issueId}`,
      issueId,
    });
  }

  return state;
}

export async function spawnAgent(options: SpawnOptions): Promise<AgentState> {
  const role: 'work' | 'strike' = options.role ?? 'work';
  const sessionPrefix = role === 'strike' ? 'strike' : 'agent';
  // PAN-1517: slot-suffixed agent ids removed alongside the swarm runtime;
  // there is one work agent per issue, period.
  const agentId = `${sessionPrefix}-${options.issueId.toLowerCase()}`;

  // Check if already running (scoped to the exact session name, including slot suffix)
  if (await Effect.runPromise(sessionExists(agentId))) {
    throw new Error(`Agent ${agentId} already running. Use 'pan tell' to message it.`);
  }

  await assertWorkspaceStackHealthyForSpawn(options.issueId, role, options.allowHost, options.workspace);

  // Initialize hook for this agent (FPP support)
  initHookSync(agentId);

  // Strike agents bypass the normal pipeline (no plan/beads/review/test) —
  // see roles/strike.md. The beads gate is the only thing we skip; everything
  // else (workspace health, supervisor wiring, launcher) is identical.
  if (role !== 'strike') {
    await Effect.runPromise(assertIssueHasBeads(options.workspace, options.issueId));
  }

  // Determine model based on role configuration
  const selectedModel = determineModel({ model: options.model, role });
  console.log(`[DEBUG] Selected model: ${selectedModel}`);

  // When routing a GPT agent through ChatGPT subscription auth, the local
  // CLIProxyAPI sidecar MUST already be running. We only check — never
  // install/start from here, because spawnAgent is reachable from dashboard
  // route handlers where blocking on curl/tar would freeze the event loop
  // (see PAN-70 / PAN-446 — no blocking I/O in server code).
  if (
    getProviderForModelSync(selectedModel).name === 'openai'
    && (await getProviderAuthMode(selectedModel)) === 'subscription'
  ) {
    const { isCliproxyRunning } = await import('./cliproxy.js');
    if (!(await Effect.runPromise(isCliproxyRunning()))) {
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
  const requestedHarness: RuntimeName = options.harness
    ?? loadYamlConfig().config.roles?.[role]?.harness
    ?? 'claude-code';
  const resolvedHarness: RuntimeName = await resolveEffectiveHarness(requestedHarness, selectedModel);

  // Create state
  const existingState = getAgentStateSync(agentId);
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

  const supervisorLaunch = await prepareSupervisorForFreshLaunch(agentId, options, state);

  saveAgentStateSync(state);

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

  // PAN-1215: One-shot cleanup of tracked workspace-only .pan/ artifacts.
  // These files are gitignored but may still be tracked on older branches.
  // If tracked, checkpoint commits and rebases can drop them, breaking the
  // verification gate. Remove them from the index when the workspace is clean.
  if (role === 'work') {
    try {
      const workspace = options.workspace;
      const { stdout: trackedFiles } = await execAsync(
        'git ls-files .pan/continue.json .pan/spec.vbrief.json',
        { cwd: workspace },
      );
      if (trackedFiles.trim()) {
        const { stdout: porcelain } = await execAsync(
          'git status --porcelain -- .pan/',
          { cwd: workspace },
        );
        if (!porcelain.trim()) {
          await execAsync(
            'git rm --cached --ignore-unmatch .pan/continue.json .pan/spec.vbrief.json',
            { cwd: workspace },
          );
          await execAsync(
            'git commit -m "chore: untrack workspace .pan/ artifacts (PAN-1215)"',
            { cwd: workspace },
          );
          console.log(`[agents] Untracked workspace .pan/ artifacts for ${options.issueId}`);
        } else {
          console.warn(`[agents] Skipping .pan/ untrack for ${options.issueId} — .pan/ paths have uncommitted changes`);
        }
      }
    } catch (err: any) {
      console.warn(`[agents] .pan/ untrack cleanup failed for ${options.issueId}: ${err.message}`);
    }
  }

  // Build prompt with FPP work if available
  let prompt = options.prompt || '';

  // FPP: Check for pending work on hook
  const { hasWork, items } = checkHookSync(agentId);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPromptSync(agentId);
    if (fixedPointPrompt) {
      prompt = fixedPointPrompt + '\n\n---\n\n' + prompt;
    }
  }

  if (prompt) {
    prompt = await withSpawnTimeMemoryContext({
      prompt,
      issueId: options.issueId,
      workspace: options.workspace,
      agentId,
      role,
      harness: resolvedHarness,
    });
  }

  // Write prompt to file for complex prompts (avoids shell escaping issues)
  const promptFile = join(getAgentDir(agentId), 'initial-prompt.md');
  if (prompt) {
    await writeFileAsync(promptFile, prompt);
    if (role === 'work') {
      state.kickoffDelivered = false;
      saveAgentStateSync(state);
    }
  }

  // Auto-setup hooks if not configured
  checkAndSetupHooks();

  // Ensure TLDR daemon is running for the workspace (non-blocking, non-fatal).
  // Gated by the operator TLDR toggle: when disabled, the daemon is not started
  // and the agent (whose prompt reports TLDR_AVAILABLE=false) degrades to direct
  // file reads.
  try {
    const venvPath = join(options.workspace, '.venv');
    if (isTldrEnabledSync() && existsSync(venvPath)) {
      const { getTldrDaemonServiceSync } = await import('./tldr-daemon.js');
      const tldrService = getTldrDaemonServiceSync(options.workspace, venvPath);
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

  // Channels MCP gate: only the explicit legacy override writes a per-agent
  // .mcp.json, bridge token, and channelsEnabled state for new spawns. The PTY
  // supervisor remains the default delivery transport.
  const channelsDecision = decideChannelsForWorkAgent(agentId, options, state);
  let channelsBridgeMcpConfig: string | undefined;
  if (channelsDecision.eligible) {
    channelsBridgeMcpConfig = join(options.workspace, '.pan', 'agent-mcp.json');
    writeBridgeTokenSync(agentId);
    await writeChannelsBridgeMcpConfig(channelsBridgeMcpConfig, agentId);
    state.channelsEnabled = true;
    saveAgentStateSync(state);
  }

  const flywheelEnv = resolveFlywheelSpawnEnv(role, options.flywheelRunId);
  const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
    agentId,
    model: selectedModel,
    workspace: options.workspace,
    role,
    isPlanning: false,
    channelsBridgeMcpConfig,
    useSupervisor: supervisorLaunch.useSupervisor,
    supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
    harness: state.harness ?? 'claude-code',
    extraEnvExports: flywheelEnvExports(flywheelEnv),
    effort: options.effort,
    // PAN-1574: codex work agents are headless one-shot processes; embed the
    // initial prompt inline in `codex exec <prompt>` via the launcher generator.
    // Claude-code and Pi receive their prompts via tmux/FIFO after session start.
    ...(state.harness === 'codex' && prompt ? { promptInline: prompt } : {}),
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
      const { findProjectByPathSync } = await import('./projects.js');
      const project = findProjectByPathSync(resolve(options.workspace, '..', '..'));
      const ghRepo = project?.github_repo;
      if (ghRepo) {
        const [owner, repo] = ghRepo.split('/');
        const { token } = await Effect.runPromise(generateInstallationToken());
        await configureWorkspaceForBot(options.workspace, owner, repo, token);
        console.log(`[${agentId}] Configured workspace for bot push (panopticon-agent[bot])`);
      }
    }
  } catch (err: any) {
    console.warn(`[${agentId}] GitHub App config failed (falling back to SSH): ${err.message}`);
  }

  clearReadySignal(agentId);

  await Effect.runPromise(createSession(agentId, options.workspace, claudeCmd, {
    env: {
      ...BLANKED_PROVIDER_ENV, // Blank stale provider vars inherited by tmux server
      TERM: 'xterm-256color',
      PANOPTICON_AGENT_ID: agentId,
      PANOPTICON_ISSUE_ID: options.issueId,
      PANOPTICON_SESSION_TYPE: role,
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false', // Disable suggested prompts for autonomous agents (PAN-251)
      GIT_SEQUENCE_EDITOR: 'false', // Block interactive rebase / squash (agents forbidden from rewriting history)
      ...flywheelEnv,
      ...providerEnv, // Set correct provider env vars (BASE_URL, AUTH_TOKEN, etc.)
    }
  }));

  // PAN-1574: codex agents are headless one-shot processes — the initial prompt
  // is already embedded inline in the launcher's `codex exec <prompt>` command.
  // After the session starts, poll for the rollout JSONL to capture the thread-id
  // so getLatestSessionIdSync / getSessionPath / sendMessage can find the session.
  if (resolvedHarness === 'codex') {
    const { waitForCodexRollout, extractThreadIdFromRollout, writeThreadId: writeCodexThreadId } =
      await import('./runtimes/codex.js');
    const codexHomeForAgent = join(homedir(), '.panopticon', 'agents', agentId, 'codex-home');
    const rolloutPath = await waitForCodexRollout(codexHomeForAgent, 30000);
    if (rolloutPath) {
      const threadId = extractThreadIdFromRollout(rolloutPath);
      if (threadId) {
        writeCodexThreadId(agentId, threadId);
      }
    } else {
      console.warn(`[${agentId}] Codex: rollout did not appear within 30s — thread-id not captured`);
    }
    if (prompt && role === 'work') {
      state.kickoffDelivered = true;
      saveAgentStateSync(state);
    }
  }

  // Channels: start dismissing the dev-channels confirmation dialog as soon as
  // the tmux session exists, but only block on completion when we are about to
  // deliver an initial prompt. Spawn-only callers should not sit in a 20s poll
  // loop waiting for a dialog they may never need.
  const dismissChannelsDialogPromise = channelsBridgeMcpConfig
    ? dismissDevChannelsDialog(agentId).catch(() => undefined)
    : null;

  // Send the initial prompt after Claude's interactive prompt is ready.
  // Codex agents skip this — the prompt is embedded inline in the launch command.
  // Wait for the session to be ready by polling tmux output for Claude's prompt.
  if (prompt && resolvedHarness === 'pi') {
    try {
      await writePiAgentPrompt(agentId, prompt);
      if (role === 'work') {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } catch (err) {
      console.error(`[${agentId}] Pi prompt delivery failed:`, err instanceof Error ? err.message : String(err));
      if (role === 'work') {
        await recordKickoffDeliveryFailure(state, options.issueId, role);
        return state;
      }
    }
  } else if (prompt && resolvedHarness !== 'codex') {
    if (dismissChannelsDialogPromise) {
      await dismissChannelsDialogPromise;
    }
    const delivery = await deliverInitialPromptWithRetry(agentId, prompt, 'spawnAgent:initial-prompt', state.deliveryMethod);
    if (delivery.ok) {
      if (role === 'work') {
        state.kickoffDelivered = true;
        saveAgentStateSync(state);
      }
    } else if (role === 'work') {
      await recordKickoffDeliveryFailure(state, options.issueId, role);
      return state;
    }
  }

  // Update status
  markAgentRunning(state);
  saveAgentStateSync(state);

  // Track work in CV
  startWorkSync(agentId, options.issueId);

  // Emit activity + TTS so the user knows an agent has started
  emitActivityEntrySync({
    source: role,
    level: 'info',
    message: `Work agent started for ${options.issueId}`,
    issueId: options.issueId,
  });
  emitActivityTtsSync({
    utterance: `Work agent started for ${options.issueId}`,
    priority: 2,
    issueId: options.issueId,
    source: 'work-agent',
    eventType: 'workAgent.started',
  });

  return state;
}

export function listRunningAgentsSync(): (AgentState & { tmuxActive: boolean })[] {
  // Match liveness against ALL panopticon-socket sessions, not just `agent-*`.
  // Agent state dirs are named by role prefix (planning-/agent-/conv-/strike-);
  // getAgentSessions only returns `agent-*`, so planning/conv/strike sessions
  // would always read tmuxActive:false and get dropped by the enrichment poller.
  const tmuxSessions = listSessionsSync();
  const tmuxNames = new Set(tmuxSessions.map(s => s.name));

  const agents: (AgentState & { tmuxActive: boolean })[] = [];

  // Read all agent states
  if (!existsSync(AGENTS_DIR)) return agents;

  const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const state = getAgentStateSync(dir.name);
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


export const listRunningAgents = (): Effect.Effect<(AgentState & { tmuxActive: boolean })[], FsError | TmuxError> =>
  Effect.gen(function* () {
    // TRAP — `tmuxActive` reflects whether THIS process can see the agent's tmux
    // session on the `panopticon` socket. Run this from a one-off `tsx -e`/CLI
    // process that lacks access to that socket and `listSessions()` returns
    // empty, so EVERY agent comes back `tmuxActive: false` — including ones that
    // are genuinely running. Do not conclude "the agent isn't running" / "the
    // enrichment poller skips it" from an out-of-server-process reading. Trust
    // the live dashboard server's view (it owns the socket) or check the tmux
    // session directly with `tmux -L panopticon list-sessions`.
    //
    // Use the UNFILTERED session list (not getAgentSessions, which is `agent-*`
    // only): agent state dirs carry role prefixes (planning-/agent-/conv-/strike-),
    // and planning/conv/strike sessions must read tmuxActive:true so the
    // enrichment poller scans them for AskUserQuestion / pending input (PAN-1395).
    const tmuxSessions = yield* listSessions();
    const tmuxNames = new Set(tmuxSessions.map(s => s.name));

    if (!existsSync(AGENTS_DIR)) return [];

    const entries = yield* Effect.tryPromise({
      try: () => readdir(AGENTS_DIR),
      catch: (cause) => toAgentFsError('readdir', AGENTS_DIR, cause),
    }).pipe(Effect.orElseSucceed(() => [] as string[]));

    const states = yield* Effect.forEach(
      entries,
      (entry) => getAgentState(entry).pipe(
        Effect.map((state) => {
          if (!state) return null;
          const normalizedId = normalizeAgentId(state.id || entry);
          return {
            ...state,
            id: normalizedId,
            tmuxActive: tmuxNames.has(normalizedId),
          };
        }),
      ),
      { concurrency: 'unbounded' },
    );

    return states.filter((state): state is AgentState & { tmuxActive: boolean } => state !== null);
  });

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

      try { await Effect.runPromise(killSession(agentId)); } catch { /* best effort */ }
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
      const state = await Effect.runPromise(getAgentState(entry));
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

/**
 * Find and kill any running `launcher.sh` process for the given agent.
 *
 * PAN-1527: `tmux kill-session` only signals tmux-managed children. Planning
 * agents (and any agent whose launcher escapes its tmux session) leave
 * orphan launcher.sh processes alive — state.json says stopped, but bash is
 * still burning CPU and tokens hours later. This locates them by command
 * line and walks SIGTERM → grace → SIGKILL.
 *
 * Sync version: callable from CLI (`pan kill`) and from the existing
 * `stopAgentSync`. Uses execSync only via `pgrep`, which is fast and
 * non-blocking in practice. Acceptable per CLAUDE.md because this path is
 * sync-by-nature already and is only called from CLI contexts and existing
 * sync internals.
 */
function killLauncherProcessSync(agentId: string): void {
  const launcherPath = join(AGENTS_DIR, agentId, 'launcher.sh');
  let pidsOut: string;
  try {
    pidsOut = execSync(
      `pgrep -f ${JSON.stringify(launcherPath)}`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return; // pgrep exits 1 when there are no matches — nothing to kill
  }

  const pids = pidsOut
    .split('\n')
    .map(s => Number.parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid);
  if (pids.length === 0) return;

  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }

  // ~500ms grace period for orderly shutdown. Sync spawn of `sleep` is
  // acceptable in CLI context; this function is never reached from the
  // dashboard server (which uses the async `stopAgent` Effect below).
  try {
    execSync('sleep 0.5', { stdio: 'ignore' });
  } catch { /* ignore */ }

  const survivors: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      survivors.push(pid);
    } catch {
      /* already dead */
    }
  }
  for (const pid of survivors) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  }
}

async function killLauncherProcessAsync(agentId: string): Promise<void> {
  const launcherPath = join(AGENTS_DIR, agentId, 'launcher.sh');
  let pidsOut: string;
  try {
    const { stdout } = await execAsync(`pgrep -f ${JSON.stringify(launcherPath)}`);
    pidsOut = stdout.trim();
  } catch {
    return; // pgrep exits 1 when there are no matches
  }

  const pids = pidsOut
    .split('\n')
    .map(s => Number.parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid);
  if (pids.length === 0) return;

  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }

  await new Promise<void>(resolve => setTimeout(resolve, 500));

  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    } catch {
      /* already dead */
    }
  }
}

export function stopAgentSync(agentId: string): void {
  const normalizedId = normalizeAgentId(agentId);

  if (sessionExistsSync(normalizedId)) {
    // Capture tmux output before killing so logs remain viewable after stop
    try {
      const output = capturePaneSync(normalizedId, 5000);
      if (output) {
        const agentDir = getAgentDir(normalizedId);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, 'output.log'), output);
      }
    } catch {
      // Non-fatal — best effort log capture
    }

    killSessionSync(normalizedId);
  }

  // PAN-1527: kill orphan launcher.sh processes that escape tmux (planning
  // agents, dashboard-spawned launchers, anything that survived tmux
  // kill-session). Runs even when no tmux session existed in the first place.
  killLauncherProcessSync(normalizedId);

  const state = getAgentStateSync(normalizedId);
  if (state) {
    // Ensure id is set — runtime state files may lack it (PAN-150)
    if (!state.id) state.id = normalizedId;

    markAgentStoppedState(state);
    saveAgentStateSync(state);
  }

  // Also mark runtime.json as stopped so Cloister/Deacon won't auto-restart.
  // state.json and runtime.json are separate files — both must agree the agent
  // was intentionally stopped to prevent race conditions with health check polls.
  console.log(`[agents] Stopping ${normalizedId}: tmux=${sessionExistsSync(normalizedId)} stateStatus=${state?.status ?? 'none'}`);
  saveAgentRuntimeState(normalizedId, {
    state: 'stopped',
    lastActivity: new Date().toISOString(),
  });
}


export const stopAgent = (agentId: string): Effect.Effect<void, FsError | TmuxError> => {
  const normalizedId = normalizeAgentId(agentId);

  return Effect.gen(function* () {
    if (yield* sessionExists(normalizedId)) {
      yield* Effect.gen(function* () {
        const output = yield* capturePane(normalizedId, 5000);
        if (!output) return;

        const agentDir = getAgentDir(normalizedId);
        const outputFile = join(agentDir, 'output.log');
        yield* Effect.tryPromise({
          try: () => mkdirAsync(agentDir, { recursive: true }),
          catch: (cause) => toAgentFsError('mkdir', agentDir, cause),
        });
        yield* Effect.tryPromise({
          try: () => writeFileAsync(outputFile, output),
          catch: (cause) => toAgentFsError('write', outputFile, cause),
        });
      }).pipe(Effect.catch(() => Effect.void));

      yield* killSession(normalizedId);
    }

    // PAN-1527: same orphan-launcher kill as stopAgentSync. Runs after
    // killSession so tmux gets the first chance to take everything down
    // cleanly; falls through and kills any survivor by command-line match.
    yield* Effect.tryPromise({
      try: () => killLauncherProcessAsync(normalizedId),
      catch: (cause): never => { throw cause; },
    }).pipe(Effect.catch(() => Effect.void));

    const state = yield* getAgentState(normalizedId);
    if (state) {
      if (!state.id) state.id = normalizedId;

      markAgentStoppedState(state);
      yield* saveAgentState(state);
    }

    const tmuxActive = yield* sessionExists(normalizedId);
    console.log(`[agents] Stopping ${normalizedId} (async): tmux=${tmuxActive} stateStatus=${state?.status ?? 'none'}`);
    yield* Effect.forkDetach(emitAgentEvent(normalizedId, {
      kind: 'activity',
      activity: 'stopped',
    }));
  });
};

function queueAgentMail(agentId: string, message: string): void {
  const mailDir = join(getAgentDir(agentId), 'mail');
  mkdirSync(mailDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(mailDir, `${timestamp}.md`),
    `# Message\n\n${message}\n`
  );
}

const USER_MESSAGE_INTERVENTION_SOURCES = new Set(['pan-tell', 'dashboard:user-message']);

async function appendTellInterventionForUserSource(normalizedId: string, caller: string): Promise<void> {
  if (!USER_MESSAGE_INTERVENTION_SOURCES.has(caller)) return;

  const agentState = getAgentStateSync(normalizedId);
  if (!agentState?.issueId) {
    console.debug(`[agents] Skipping tell intervention for ${normalizedId}; state.json has no issueId`);
    return;
  }

  await appendOperatorInterventionEvent({
    issueId: agentState.issueId,
    kind: 'tell',
    source: caller,
  });
}

export async function messageAgent(agentId: string, message: string, caller = 'internal'): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);
  const agentState = getAgentStateSync(normalizedId);
  const gateBlockReason = agentState ? getAgentResumeGateBlockReason(agentState) : undefined;
  if (gateBlockReason) {
    queueAgentMail(normalizedId, message);
    logAgentLifecycleSync(normalizedId, `messageAgent queued mail without resume: ${gateBlockReason}`);
    console.log(`[agents] Queued message for ${normalizedId}; ${gateBlockReason}`);
    return;
  }

  // Check if agent is suspended - auto-resume if so (PAN-80)
  const runtimeState = getAgentRuntimeStateSync(normalizedId);
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
    await appendTellInterventionForUserSource(normalizedId, caller);
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
  if (agentState && agentState.status === 'stopped') {
    console.log(`[agents] Auto-resuming stopped agent ${normalizedId} to deliver feedback (session exists: ${await Effect.runPromise(sessionExists(normalizedId))})`);

    const resumeResult = await resumeAgent(normalizedId, message);

    // Save to mail queue regardless so the agent can re-read feedback if needed
    queueAgentMail(normalizedId, message);

    if (resumeResult.success && resumeResult.messageDelivered !== false) {
      await appendTellInterventionForUserSource(normalizedId, caller);
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
      const provider = getProviderForModelSync(agentState.model as ModelId);
      if (provider.authType === 'credential-file') {
        setupCredentialFileAuthSync(provider, agentState.workspace);
      } else {
        clearCredentialFileAuthSync(agentState.workspace);
      }
    }

    clearReadySignal(normalizedId);
    if (await Effect.runPromise(sessionExists(normalizedId))) {
      try { await Effect.runPromise(killSession(normalizedId)); } catch { /* ignore */ }
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
    const fallbackCodexFields = fallbackHarness === 'codex'
      ? getCodexLauncherFields(normalizedId, resumeModel)
      : {};
    const fallbackSupervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, resumeModel, fallbackHarness);
    saveAgentStateSync(agentState);
    const fallbackContent = generateLauncherScriptSync({
      role: resumeRole,
      workingDir: agentState.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      baseCommand: await getRoleRuntimeBaseCommand(
        resumeModel,
        normalizedId,
        resumeRole,
        fallbackHarness,
      ),
      appendSystemPromptFiles: await claudeSystemPromptFiles(agentState.workspace, fallbackHarness),
      useSupervisor: fallbackSupervisorLaunch.useSupervisor,
      supervisorScriptPath: fallbackSupervisorLaunch.supervisorScriptPath,
      ...fallbackPiFields,
      ...fallbackCodexFields,
    });
    writeFileSync(fallbackLauncher, fallbackContent, { mode: 0o755 });
    await Effect.runPromise(createSession(normalizedId, agentState.workspace, `bash ${fallbackLauncher}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    }));

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    const ready = await waitForReadySignal(normalizedId, 30);
    const fallbackResumePrompt = `You are resuming work on ${agentState.issueId}. Check .pan/feedback/ for specialist feedback that arrived while you were stopped, then continue working.\n\n${message}`;
    const resumeMessage = await buildResumeMessageForAgent(agentState, fallbackResumePrompt, message);
    if (resumeMessage.error) {
      console.error(`[agents] Fallback-restarted ${normalizedId} but ${resumeMessage.error}`);
      emitActivityEntrySync({
        source: 'work-agent',
        level: 'error',
        message: `${normalizedId}: ${resumeMessage.error}`,
        issueId: agentState.issueId,
      });
    } else if (ready && resumeMessage.message) {
      const delivery = await deliverAgentMessage(normalizedId, resumeMessage.message, 'resumeAgent:resume-prompt', agentState.deliveryMethod);
      if (delivery.ok && resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
      await appendTellInterventionForUserSource(normalizedId, caller);
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
    queueAgentMail(normalizedId, message);
    await appendTellInterventionForUserSource(normalizedId, caller);
    return;
  }

  if (!(await Effect.runPromise(sessionExists(normalizedId)))) {
    throw new Error(`Agent ${normalizedId} not running`);
  }

  // Guard: if tmux session exists but Claude Code has exited, resume instead
  // of typing the message into a bare bash shell.
  //
  // Launchers differ: specialists `exec claude` so pane_pid IS claude, but
  // work-agent launchers run `bash launcher.sh` so pane_pid is bash and claude
  // runs as a descendant. Walk the pane's process subtree and treat the pane
  // as live if any descendant is the expected runtime for the saved harness.
  const panePids = await Effect.runPromise(listPaneValues(normalizedId, '#{pane_pid}'));
  const expectedHarness = agentState?.harness ?? 'claude-code';
  if (panePids.length > 0 && !(await hasAgentRuntimeInSubtree(panePids[0], expectedHarness))) {
    console.warn(`[agents] ${normalizedId} tmux session is a zombie (no ${expectedHarness} runtime) — attempting resume`);
    const resumeResult = await resumeAgent(normalizedId, message);
    if (resumeResult.success) {
      if (resumeResult.messageDelivered !== false) {
        await appendTellInterventionForUserSource(normalizedId, caller);
      }
      return;
    }
    throw new Error(`Agent ${normalizedId} session is dead and resume failed: ${resumeResult.error}`);
  }

  // Wait for the agent to be idle at the prompt before sending — reduces dropped
  // Enter when Claude Code is still rendering. PAN-1594: hook-driven (runtime
  // mirror 'idle' via Stop/SessionStart hook), not a tmux pane-scrape.
  const promptReady = await waitForAgentIdle(normalizedId, 5000);
  if (!promptReady) {
    console.warn(`[agents] ${normalizedId} not at idle prompt after 5s — sending message anyway`);
  }

  const deliveryMethod = agentState?.deliveryMethod;
  await deliverAgentMessage(normalizedId, message, `messageAgent:${caller}`, deliveryMethod);

  // Also save to mail queue
  queueAgentMail(normalizedId, message);
  await appendTellInterventionForUserSource(normalizedId, caller);
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
/**
 * PAN-1675: Out-of-band Panopticon-side compaction of a work agent's JSONL
 * session — recovers a context-wedged agent without the harness `/compact`
 * deadlock (which needs a live, responsive Claude process to run). Resolves the
 * SAME session file the harness resumes from and rewrites it in place via
 * native compaction.
 *
 * Never throws: every failure path returns `{ compacted:false, error }` so
 * callers (resumeAgent's `--compact` path, the deacon's fresh-overflow tier)
 * can fail safely and fall through to the `/clear` fallback. A missing
 * sessionId or workspace short-circuits to `{ compacted:false }` with no
 * compaction call.
 */
export async function compactAgentSession(agentId: string): Promise<{ compacted: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const agentState = getAgentStateSync(normalizedId);
  const sessionId = getLatestSessionIdSync(normalizedId);
  if (!agentState?.workspace || !sessionId) {
    return { compacted: false };
  }
  try {
    const sessionFile = sessionFilePath(agentState.workspace, sessionId);
    // Dynamic import: keep conversation-compaction out of agents.ts's top-level
    // import graph (it pulls in dashboard server services).
    const { compactConversationNative } = await import(
      '../dashboard/server/services/conversation-compaction.js'
    );
    await compactConversationNative(sessionFile);
    return { compacted: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logAgentLifecycleSync(normalizedId, `compactAgentSession failed: ${error}`);
    return { compacted: false, error };
  }
}

export async function resumeAgent(agentId: string, message?: string, opts?: { model?: string; harness?: RuntimeName; allowHost?: boolean; compact?: boolean }): Promise<{ success: boolean; messageDelivered?: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const requestedModel = normalizeModelOverrideSync(opts?.model);
  logAgentLifecycleSync(normalizedId, `resumeAgent called (message=${message ? 'yes' : 'no'}, harness=${opts?.harness || 'unchanged'})`);

  // Check runtime state — allow both suspended (auto-suspend) and stopped/idle (manual stop, crash)
  const runtimeState = getAgentRuntimeStateSync(normalizedId);
  const agentState = getAgentStateSync(normalizedId);
  const gateBlockReason = agentState ? getAgentResumeGateBlockReason(agentState) : undefined;
  if (gateBlockReason) {
    const reason = `Cannot resume ${normalizedId}: ${gateBlockReason}. Clear the gate before resuming.`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }
  const hasWorkspace = !!agentState?.workspace && existsSync(agentState.workspace);
  const isPlaceholder = !!agentState && agentState.status === 'starting' && typeof agentState.model === 'string' && agentState.model.startsWith('pending-');
  const allowedRuntimeStates = ['suspended', 'idle'];
  const allowedAgentStatuses = ['stopped', 'completed'];

  // Also allow resuming a "running" agent with no live tmux session — this happens after
  // a system crash where tmux was killed but state.json was never updated to 'stopped'.
  const isCrashed = agentState?.status === 'running' && !(await Effect.runPromise(sessionExists(normalizedId)));

  // PAN-1675 (keystone): a `compact` resume exists specifically to recover a
  // context-wedged agent, which is typically status='running' with a LIVE (but
  // stuck) tmux session sitting at an overflow/idle prompt. The normal canResume
  // gate rejects running+live-session agents — which would make
  // resumeAgent({compact:true}) (the deacon's overflow recovery tiers AND
  // `pan resume --compact`) a silent no-op for exactly the agents it targets.
  // So a compact-resume of a running agent is allowed: the flow below compacts
  // the JSONL out-of-band and then kills the wedged session before relaunch.
  // This is safe because the only callers of {compact:true} act on agents they
  // have already determined to be context-overflow-wedged.
  const isCompactRecovery = opts?.compact === true && agentState?.status === 'running';

  const canResume = (runtimeState && allowedRuntimeStates.includes(runtimeState.state))
    || (agentState && allowedAgentStatuses.includes(agentState.status))
    || isCrashed
    || isCompactRecovery;

  if (!canResume) {
    const reason = `Cannot resume agent in state: runtime=${runtimeState?.state || 'unknown'}, status=${agentState?.status || 'unknown'}`;
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  // Get saved session ID from any available source
  const sessionId = getLatestSessionIdSync(normalizedId);
  if (!sessionId) {
    const reason = 'No saved session ID found — this agent is not resumable. Start a fresh agent instead.';
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  if (!agentState || !hasWorkspace || isPlaceholder) {
    const reason = 'Saved Claude session is orphaned because the backing workspace/agent state is missing or placeholder-only. Start a fresh agent instead.';
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return {
      success: false,
      error: reason
    };
  }

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      opts?.allowHost === true || agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

  // PAN-1675: Optionally compact the wedged session's JSONL out-of-band BEFORE
  // killing the live tmux session, so the fresh resume reads a compacted history
  // instead of immediately re-overflowing. Fail-safe: if compaction fails, do
  // NOT kill the session or build a launcher — leave the wedged session live so
  // the caller (e.g. the deacon) can fall through to the /clear tier against it.
  if (opts?.compact) {
    const compactResult = await compactAgentSession(normalizedId);
    if (!compactResult.compacted) {
      const reason = `Pre-resume compaction failed: ${compactResult.error ?? 'unknown error'}`;
      logAgentLifecycleSync(normalizedId, `resumeAgent BLOCKED: ${reason}`);
      return { success: false, error: reason };
    }
  }

  // Kill any zombie tmux session (crashed agent left behind)
  if (await Effect.runPromise(sessionExists(normalizedId))) {
    try {
      await Effect.runPromise(killSession(normalizedId));
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
      const resolved = resolveProjectFromIssueSync(issueId);
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

    const model = requestedModel || requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6');
    if (requestedModel && requestedModel !== agentState.model) {
      agentState.model = requestedModel;
      saveAgentStateSync(agentState);
    }
    const effectiveHarness = await resolveEffectiveHarness(opts?.harness ?? agentState.harness, model);
    agentState.harness = effectiveHarness;
    const supervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, model, effectiveHarness);
    saveAgentStateSync(agentState);

    // Compute the effective message before building the launcher so codex can
    // embed it as the inline prompt in `codex exec resume <threadId> <message>`.
    const issueId = agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase();
    const defaultResumeMessage = `You are resuming work on ${issueId}. Read .pan/continue.json for context and pick up where you left off — do not wait for further instructions.`;
    const resumeMessage = await buildResumeMessageForAgent(agentState, defaultResumeMessage, message);
    if (resumeMessage.error) {
      console.error(`[resumeAgent] ${resumeMessage.error}`);
      emitActivityEntrySync({
        source: 'work-agent',
        level: 'error',
        message: `${normalizedId}: ${resumeMessage.error}`,
        issueId,
      });
      return { success: false, error: resumeMessage.error };
    }
    const effectiveMessage = resumeMessage.message ?? defaultResumeMessage;

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
      spawnMode: 'resume',
      resumeSessionId: sessionId,
      harness: effectiveHarness,
      useSupervisor: supervisorLaunch.useSupervisor,
      supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
      // PAN-1574: codex resume embeds the message inline so `codex exec resume
      // <threadId> <message>` delivers it in one shot without a separate send.
      ...(effectiveHarness === 'codex' ? { promptInline: effectiveMessage } : {}),
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    const claudeCmd = `bash ${launcherScript}`;

    await Effect.runPromise(createSession(normalizedId, agentState.workspace, claudeCmd, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: agentState.issueId || '',
        PANOPTICON_SESSION_TYPE: agentState.role,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...providerEnv
      }
    }));

    // Always wake the resumed agent with a continue prompt — without it, the
    // re-attached session sits silently at its last state, and the user (or
    // deacon nudge loop) ends up sending one manually anyway. Default matches
    // restartAgent's wording so behaviour is consistent across both entry points.
    // Caller-supplied message wins.

    let messageDelivered = false;
    if (effectiveHarness === 'pi') {
      // Pi does not fire the Claude SessionStart hook; wait for ready.json and
      // deliver the auto-continue prompt through the FIFO JSONL protocol.
      try {
        await writePiAgentPrompt(normalizedId, effectiveMessage);
        messageDelivered = true;
        if (resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[resumeAgent] Pi prompt delivery failed: ${msg}`);
      }
    } else if (effectiveHarness === 'codex') {
      // Codex is one-shot: message is already embedded in `codex exec resume
      // <threadId> <message>` via buildCodexCommand. No SessionStart hook fires.
      messageDelivered = true;
      if (resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
    } else {
      // Wait for SessionStart hook to signal ready (PAN-87: reliable message delivery)
      const ready = await waitForReadySignal(normalizedId, 30);
      if (ready) {
        const delivery = await deliverAgentMessage(normalizedId, effectiveMessage, 'resumeAgent:auto-continue', agentState.deliveryMethod);
        messageDelivered = delivery.ok;
        if (delivery.ok && resumeMessage.redeliveringKickoff) markKickoffRedelivered(agentState);
      } else {
        console.error('Claude SessionStart hook did not fire during resume, continue prompt not sent');
      }
    }

    const resumedAt = new Date().toISOString();
    console.log(`[agents] Resumed ${normalizedId} with Claude session ${sessionId}`);
    logAgentLifecycleSync(normalizedId, `resumeAgent SUCCESS: sessionId=${sessionId}, messageDelivered=${messageDelivered}`);
    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: resumedAt,
    });

    // Update agent state
    if (agentState) {
      markAgentRunning(agentState);
      saveAgentStateSync(agentState);
    }

    // PAN-1675: a successful compaction-resume genuinely recovers a
    // context-overflow-wedged agent — so clear a context_overflow `stuck` flag
    // here (set by markWorkspaceStuck once the old /compact+/clear ladder
    // exhausted). Without this the agent would stay flagged stuck forever and
    // the deacon's overflowBlocked gate would keep skipping its recovery, even
    // though the agent is now healthy. Only clear when the stuck reason is
    // context_overflow (don't clobber an unrelated stuck state).
    if (opts?.compact && agentState?.issueId) {
      try {
        const { getReviewStatusSync } = await import('./review-status.js');
        const rs = getReviewStatusSync(agentState.issueId);
        if (rs?.stuck && rs.stuckReason === 'context_overflow') {
          const { clearWorkspaceStuck } = await import('./database/review-status-db.js');
          clearWorkspaceStuck(agentState.issueId);
          logAgentLifecycleSync(normalizedId, `cleared context_overflow stuck flag after compaction-resume for ${agentState.issueId}`);
        }
      } catch (clearErr) {
        console.warn(`[agents] Could not clear stuck flag after compaction-resume for ${normalizedId}:`, clearErr);
      }
    }

    return { success: true, messageDelivered };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `resumeAgent FAILED: ${msg}`);
    return {
      success: false,
      error: `Failed to resume agent: ${msg}`
    };
  }
}

export interface RestartAgentOptions {
  model?: string;
  harness?: RuntimeName;
  graceful?: boolean;
  message?: string;
}

export async function restartAgent(
  agentId: string,
  opts: RestartAgentOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const normalizedId = normalizeAgentId(agentId);
  const { graceful = true, model: rawNewModel, harness: newHarness, message } = opts;
  const newModel = normalizeModelOverrideSync(rawNewModel);

  const agentState = getAgentStateSync(normalizedId);
  if (!agentState) {
    return { success: false, error: `Agent ${normalizedId} not found` };
  }
  const gateBlockReason = getAgentResumeGateBlockReason(agentState);
  if (gateBlockReason) {
    const reason = `Cannot restart ${normalizedId}: ${gateBlockReason}. Clear the gate before restarting.`;
    logAgentLifecycleSync(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }
  if (!agentState.workspace || !existsSync(agentState.workspace)) {
    return { success: false, error: `Agent workspace missing: ${agentState.workspace}` };
  }

  logAgentLifecycleSync(normalizedId, `restartAgent called (graceful=${graceful}, model=${newModel || 'unchanged'}, harness=${newHarness || 'unchanged'})`);

  try {
    await assertWorkspaceStackHealthyForSpawn(
      agentState.issueId || normalizedId.replace(/^agent-/, '').toUpperCase(),
      agentState.role ?? 'work',
      agentState.hostOverride === true,
      agentState.workspace,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `restartAgent BLOCKED: ${reason}`);
    return { success: false, error: reason };
  }

  if (graceful && await Effect.runPromise(sessionExists(normalizedId))) {
    const warning = 'Restarting in 30s. Update .pan/continue.json now with all progress, decisions, hazards, and resume point.';
    try {
      await Effect.runPromise(sendKeys(normalizedId, warning));
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

  await Effect.runPromise(stopAgent(normalizedId));

  const effectiveModel = newModel || requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6');
  const requestedHarness = newHarness ?? agentState.harness;
  const effectiveHarness = await resolveEffectiveHarness(requestedHarness, effectiveModel);
  if (newModel && newModel !== agentState.model) {
    agentState.model = newModel;
  }
  agentState.harness = effectiveHarness;
  agentState.status = 'starting';
  saveAgentStateSync(agentState);

  try {
    clearReadySignal(normalizedId);
    const supervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, agentState, effectiveModel, effectiveHarness);
    saveAgentStateSync(agentState);

    const { launcherContent, providerEnv } = await buildAgentLaunchConfig({
      agentId: normalizedId,
      model: effectiveModel,
      workspace: agentState.workspace,
      role: agentState.role,
      isPlanning: agentState.role === 'plan',
      harness: effectiveHarness,
      useSupervisor: supervisorLaunch.useSupervisor,
      supervisorScriptPath: supervisorLaunch.supervisorScriptPath,
    });

    const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
    await writeLauncherScriptAtomic(launcherScript, launcherContent);
    const claudeCmd = `bash ${launcherScript}`;

    await Effect.runPromise(createSession(normalizedId, agentState.workspace, claudeCmd, {
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
    }));

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
        await Effect.runPromise(sendKeys(normalizedId, prompt));
      } else {
        console.error(`[restartAgent] Claude did not become ready within 30s for ${normalizedId}`);
      }
    }

    markAgentRunning(agentState);
    saveAgentStateSync(agentState);

    await saveAgentRuntimeState(normalizedId, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });

    logAgentLifecycleSync(normalizedId, `restartAgent SUCCESS: model=${effectiveModel}`);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logAgentLifecycleSync(normalizedId, `restartAgent FAILED: ${msg}`);
    return { success: false, error: `Failed to restart agent: ${msg}` };
  }
}

/**
 * Check whether a tmux session has an active agent runtime.
 * A session may exist with only a bare bash shell after Claude exits.
 */
async function hasAgentRuntimeInSession(sessionName: string, harness: RuntimeName): Promise<boolean> {
  try {
    const panePids = await Effect.runPromise(listPaneValues(sessionName, '#{pane_pid}'));
    if (panePids.length === 0) return false;
    return hasAgentRuntimeInSubtree(panePids[0]!, harness);
  } catch {
    return false;
  }
}

/**
 * Detect crashed agents (state shows running but tmux session is gone)
 */
export function detectCrashedAgents(): AgentState[] {
  const agents = listRunningAgentsSync();
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
  logAgentLifecycleSync(normalizedId, 'recoverAgent called');
  const state = getAgentStateSync(normalizedId);

  if (!state) {
    logAgentLifecycleSync(normalizedId, 'recoverAgent BLOCKED: no state.json');
    return null;
  }

  // Runtime state files may lack required fields (PAN-150)
  if (!state.id) state.id = normalizedId;
  const gateBlockReason = getAgentResumeGateBlockReason(state);
  if (gateBlockReason) {
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: Cannot recover ${normalizedId}: ${gateBlockReason}. Clear the gate before recovering.`);
    return null;
  }
  const modelOverride = normalizeModelOverrideSync(opts.modelOverride);
  if (modelOverride) {
    state.model = modelOverride;
    logAgentLifecycleSync(normalizedId, `recoverAgent: model overridden → ${modelOverride}`);
  }
  if (!state.workspace || !state.model) {
    const reason = `[agents] Cannot recover ${normalizedId}: state.json missing workspace or model`;
    console.error(reason);
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: ${reason}`);
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
    logAgentLifecycleSync(normalizedId, `recoverAgent BLOCKED: ${reason}`);
    return null;
  }

  // Check if already running — session may exist with only a bare shell
  // after Claude exited (zombie session). Kill it and recover.
  if (sessionExistsSync(normalizedId)) {
    const recoveryHarness: RuntimeName = (state.harness === 'pi' || state.harness === 'claude-code' || state.harness === 'codex')
      ? state.harness
      : 'claude-code';
    if (await hasAgentRuntimeInSession(normalizedId, recoveryHarness)) {
      return state;
    }
    console.log(`[agents] ${normalizedId} tmux session is a zombie (no ${recoveryHarness} runtime) — killing and recovering`);
    try { killSessionSync(normalizedId); } catch { /* ignore */ }
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
    const provider = getProviderForModelSync(state.model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuthSync(provider, state.workspace);
    } else {
      clearCredentialFileAuthSync(state.workspace);
    }
  }

  // Restart the agent with recovery context. PAN-1048 C4: derive the role from
  // the saved AgentState (or the session-id heuristic for legacy planning-* IDs)
  // and route through getRoleRuntimeBaseCommand so review/test/ship don't get
  // resurrected as work agents.
  const recoveryHarness: RuntimeName = (state.harness === 'pi' || state.harness === 'claude-code' || state.harness === 'codex')
    ? state.harness
    : 'claude-code';
  const recoverySupervisorLaunch = await prepareSupervisorForRelaunch(normalizedId, state, state.model, recoveryHarness);
  saveAgentStateSync(state);

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
    await Effect.runPromise(createSession(normalizedId, state.workspace, `bash ${launcherScript}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        PANOPTICON_AGENT_ID: normalizedId,
        PANOPTICON_ISSUE_ID: state.issueId || '',
        PANOPTICON_SESSION_TYPE: recoveryRole,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
        ...piProviderEnv,
      },
    }));
    try {
      await writePiAgentPrompt(normalizedId, recoveryPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[recoverAgent] Pi recovery prompt delivery failed for ${normalizedId}: ${msg}`);
    }
    markAgentRunning(state);
    saveAgentStateSync(state);
    logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount} (pi)`);
    return state;
  }

  const recoveryCodexFields = recoveryHarness === 'codex'
    ? getCodexLauncherFields(normalizedId, state.model)
    : {};
  const recoveryLauncherContent = generateLauncherScriptSync({
    role: recoveryRole,
    workingDir: state.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports: (await getProviderExportsForModel(state.model)).trimEnd(),
    baseCommand: await getRoleRuntimeBaseCommand(state.model, normalizedId, recoveryRole, recoveryHarness),
    appendSystemPromptFiles: await claudeSystemPromptFiles(state.workspace, recoveryHarness),
    promptInline: recoveryPrompt,
    useSupervisor: recoverySupervisorLaunch.useSupervisor,
    supervisorScriptPath: recoverySupervisorLaunch.supervisorScriptPath,
    ...recoveryCodexFields,
  });
  const launcherScript = join(getAgentDir(normalizedId), 'launcher.sh');
  await writeLauncherScriptAtomic(launcherScript, recoveryLauncherContent);
  createSessionSync(normalizedId, state.workspace, `bash ${launcherScript}`, {
    env: {
      ...BLANKED_PROVIDER_ENV,
      PANOPTICON_AGENT_ID: normalizedId,
      PANOPTICON_ISSUE_ID: state.issueId || '',
      PANOPTICON_SESSION_TYPE: state.role ?? (normalizedId.startsWith('planning-') ? 'plan' : 'work'),
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      ...providerEnv
    }
  });

  // Update state
  markAgentRunning(state);
  saveAgentStateSync(state);

  logAgentLifecycleSync(normalizedId, `recoverAgent SUCCESS: recoveryCount=${health.recoveryCount}`);
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
  const { hasWork } = checkHookSync(state.id);
  if (hasWork) {
    const fixedPointPrompt = generateFixedPointPromptSync(state.id);
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

