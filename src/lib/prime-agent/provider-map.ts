/**
 * Prime Agent provider and credential mapping (PAN-3668 WI-8, FR-13, FR-14, D12).
 *
 * Maps an Overdeck model's provider to the Prime Agent provider id passed to
 * `--provider`, and decides whether a credential exists before any pane is created.
 * A launch is allowed when any of these holds, checked in order:
 *   1. `~/.prime/agent/auth.json` has the Prime provider key (key names are read,
 *      values never);
 *   2. `process.env` has Prime's env var for that provider;
 *   3. Overdeck `config.apiKeys.<provider>` is set.
 * For sources 2 and 3 the key is returned in `envExports`, under Prime's env var
 * name. The launcher passes it in the terminal-backend launch env, never in the
 * launcher script (FR-14): agent panes start with every provider key blanked
 * (BLANKED_PROVIDER_ENV), so an env-var credential would otherwise not reach Prime.
 * The model id passes through unchanged: Prime rejects unknown ids at startup and the
 * host surfaces that as `prime-agent-launch-error`. No fallback model is ever chosen.
 */
import { readFile } from 'node:fs/promises';

import { loadConfigNoMigration } from '../config-yaml.js';
import { getProviderForModel, type ProviderName } from '../providers.js';
import { primeAgentAuthFilePath } from '../runtimes/storage/prime-agent.js';
import type { AuthMode } from '../subscription-types.js';

export class PrimeAgentProviderMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimeAgentProviderMappingError';
  }
}

export class PrimeAgentCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimeAgentCredentialError';
  }
}

interface PrimeApiKeyRoute {
  /** Prime provider id (`--provider`) and its `auth.json` key. */
  provider: string;
  /** Env var Prime reads the API key from. */
  envVar: string;
}

/** Overdeck provider → Prime provider for API-key auth. */
const API_KEY_ROUTES: Partial<Record<ProviderName, PrimeApiKeyRoute>> = {
  anthropic: { provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY' },
  openai: { provider: 'openai', envVar: 'OPENAI_API_KEY' },
  google: { provider: 'google', envVar: 'GEMINI_API_KEY' },
  kimi: { provider: 'kimi-coding', envVar: 'KIMI_API_KEY' },
  minimax: { provider: 'minimax', envVar: 'MINIMAX_API_KEY' },
  openrouter: { provider: 'openrouter', envVar: 'OPENROUTER_API_KEY' },
  zai: { provider: 'zai', envVar: 'ZAI_API_KEY' },
  mimo: { provider: 'xiaomi', envVar: 'XIAOMI_API_KEY' },
  xai: { provider: 'xai', envVar: 'XAI_API_KEY' },
  groq: { provider: 'groq', envVar: 'GROQ_API_KEY' },
  cerebras: { provider: 'cerebras', envVar: 'CEREBRAS_API_KEY' },
  mistral: { provider: 'mistral', envVar: 'MISTRAL_API_KEY' },
};

/**
 * Overdeck provider → Prime provider for subscription auth. The `auth.json` key is the
 * provider id. Anthropic subscription never reaches here: the ToS gate blocks it.
 */
const SUBSCRIPTION_ROUTES: Partial<Record<ProviderName, string>> = {
  openai: 'openai-codex',
};

export interface PrimeAgentCredential {
  /** Prime provider id for `--provider`. */
  provider: string;
  /** Credential env for the host's launch env. Empty when Prime's own auth.json holds the key (source 1). */
  envExports: Record<string, string>;
}

export interface PrimeAgentCredentialDeps {
  /** Path to Prime's `auth.json`. Defaults to `~/.prime/agent/auth.json`. */
  authFile?: string;
  env?: NodeJS.ProcessEnv;
  /** Overdeck API keys by provider. Defaults to the merged config's `apiKeys`. */
  loadApiKeys?: () => Promise<Partial<Record<string, string | undefined>>>;
}

async function readAuthFileKeys(authFile: string): Promise<Set<string>> {
  const raw = await readFile(authFile, 'utf8').catch(() => null);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? new Set(Object.keys(parsed)) : new Set();
  } catch {
    return new Set();
  }
}

async function defaultLoadApiKeys(): Promise<Partial<Record<string, string | undefined>>> {
  const { config } = await loadConfigNoMigration();
  return config.apiKeys;
}

/**
 * Resolve the Prime provider and credential for `model` (D12). Throws
 * PrimeAgentProviderMappingError for an unmapped provider and PrimeAgentCredentialError
 * when no credential source holds a key. Credential values never appear in messages.
 */
export async function resolvePrimeAgentCredential(
  model: string,
  authMode: AuthMode | undefined,
  deps: PrimeAgentCredentialDeps = {},
): Promise<PrimeAgentCredential> {
  const overdeckProvider = getProviderForModel(model).name;
  const authFile = deps.authFile ?? primeAgentAuthFilePath();
  const env = deps.env ?? process.env;

  if (authMode === 'subscription') {
    const provider = SUBSCRIPTION_ROUTES[overdeckProvider];
    if (!provider) {
      throw new PrimeAgentProviderMappingError(
        `Prime Agent has no subscription route for Overdeck provider "${overdeckProvider}" (model "${model}"). ` +
          `Switch ${overdeckProvider} to API-key auth, or pick another harness for this model. No fallback model was selected.`,
      );
    }
    if ((await readAuthFileKeys(authFile)).has(provider)) return { provider, envExports: {} };
    throw new PrimeAgentCredentialError(
      `Prime Agent cannot launch "${model}" on a ${overdeckProvider} subscription: ${authFile} has no "${provider}" sign-in. ` +
        `Run \`prime-agent\`, then \`/login\` and choose ${provider}. No Prime Agent process was started.`,
    );
  }

  const route = API_KEY_ROUTES[overdeckProvider];
  if (!route) {
    throw new PrimeAgentProviderMappingError(
      `Prime Agent does not support Overdeck provider "${overdeckProvider}" (model "${model}"). ` +
        'Pick a model from a supported provider (anthropic, openai, google, kimi, minimax, openrouter, zai, mimo, xai, groq, cerebras, mistral), or another harness. No fallback model was selected.',
    );
  }

  if ((await readAuthFileKeys(authFile)).has(route.provider)) return { provider: route.provider, envExports: {} };
  const envKey = env[route.envVar];
  if (envKey) return { provider: route.provider, envExports: { [route.envVar]: envKey } };

  const settingsKey = (await (deps.loadApiKeys ?? defaultLoadApiKeys)())[overdeckProvider];
  if (settingsKey) return { provider: route.provider, envExports: { [route.envVar]: settingsKey } };

  throw new PrimeAgentCredentialError(
    `Prime Agent cannot launch "${model}": no credential for Prime provider "${route.provider}". ` +
      `Add the "${route.provider}" key to ${authFile} (run \`prime-agent\`, then \`/login\`), export ${route.envVar}, ` +
      `or set the ${overdeckProvider} API key in Overdeck Settings. No Prime Agent process was started.`,
  );
}
