import { Effect } from 'effect';
import type { NormalizedCavemanConfig } from '../config-yaml.js';
import { loadConfigSync as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { readCavemanVariant } from '../caveman/workspace.js';
import { bridgeGeminiAuthToCliproxy, getCliproxyClientEnv } from '../cliproxy.js';
import { normalizeModelOverrideSync, requireModelOverrideSync } from '../model-validation.js';
import { getOpenAIAuthStatus } from '../openai-auth.js';
import { ensureOpenAICompatibleProxyRunning } from '../openai-compatible-proxy.js';
import { validateProviderHealth } from '../provider-health.js';
import { getProviderEnvSync, getProviderForModelSync } from '../providers.js';
import type { Role } from './agent-state.js';

/** Map abstract/future model names to CLIProxy-supported names.
 *  The CLIProxy registry has gpt-5.4 but not gpt-5.4-pro. */
export const CLI_PROXY_MODEL_ALIASES: Record<string, string> = {
  'gpt-5.5-pro': 'gpt-5.5',
  'gpt-5.4-pro': 'gpt-5.4',
};

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
      throw new Error(`Google API key not configured. Add GOOGLE_API_KEY in Settings → Google or ~/.overdeck.env before using model "${model}".`);
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
  // Pi-native provider env vars (bridged from Overdeck settings so Pi can auth)
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

/**
 * Build shell export lines to inject into a work agent's launcher.sh.
 *
 * Sets CAVEMAN_DEFAULT_MODE and OVERDECK_CAVEMAN_VARIANT so the caveman
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
    return `export OVERDECK_CAVEMAN_VARIANT="${variant}"\n`;
  }

  // Work agents use the 'work' intensity mode
  const mode = config.modes.work;
  if (mode === 'off' || mode === 'disabled') return '';

  return `export CAVEMAN_DEFAULT_MODE="${mode}"\nexport OVERDECK_CAVEMAN_VARIANT="${variant}"\n`;
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
 * used to spawn one, even if a project pins them in config. The gate fails
 * loudly for the work role when the model wasn't an explicit per-spawn override.
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

export function determineModel(options: { model?: string; role?: Role; spawnKey?: string } = {}): string {
  const modelOverride = normalizeModelOverrideSync(options.model);
  const resolved = modelOverride
    ? modelOverride
    : requireModelOverrideSync(resolveModel(options.role ?? 'work', undefined, loadYamlConfig().config, options.spawnKey));

  // Work-agent safety net: a config pin (or smart-selection) must not spawn a
  // work agent on a model that is known to wedge for the work role. Fail loudly
  // rather than launch a dead agent or silently substitute another model. Only
  // applies to the work role and only when the model wasn't an explicit,
  // deliberate per-spawn override.
  const role = options.role ?? 'work';
  if (role === 'work' && !modelOverride && WORK_AGENT_BROKEN_MODELS.has(resolved)) {
    throw new Error(
      `Resolved work model "${resolved}" is known-broken for work agents. ` +
      'Set roles.work.model to a working model in config.yaml, or pass an explicit --model override.',
    );
  }

  return resolved;
}
