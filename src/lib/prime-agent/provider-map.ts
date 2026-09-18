import type { ModelProvider } from '../model-fallback.js';
import type { AuthMode } from '../subscription-types.js';
import { getProviderForModelSync } from '../providers.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { loadSettingsSync } from '../settings.js';
import { SETTINGS_FILE } from '../paths.js';

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

/**
 * The credential each api-key provider is launched with, and how an operator
 * supplies it. `provider-map.ac2` requires a missing credential to name the
 * variable or auth file AND the command that configures it, so both halves live
 * here next to the provider they belong to rather than in generic doctor text.
 */
const API_KEY_CREDENTIALS: Partial<Record<ModelProvider, { envVar: string; settingsKey: string }>> = {
  anthropic: { envVar: 'ANTHROPIC_API_KEY', settingsKey: 'anthropic' },
  openai: { envVar: 'OPENAI_API_KEY', settingsKey: 'openai' },
  google: { envVar: 'GEMINI_API_KEY', settingsKey: 'google' },
  kimi: { envVar: 'KIMI_API_KEY', settingsKey: 'kimi' },
  minimax: { envVar: 'MINIMAX_API_KEY', settingsKey: 'minimax' },
  openrouter: { envVar: 'OPENROUTER_API_KEY', settingsKey: 'openrouter' },
  zai: { envVar: 'ZAI_API_KEY', settingsKey: 'zai' },
  mimo: { envVar: 'MIMO_API_KEY', settingsKey: 'mimo' },
  xai: { envVar: 'XAI_API_KEY', settingsKey: 'xai' },
  groq: { envVar: 'GROQ_API_KEY', settingsKey: 'groq' },
  cerebras: { envVar: 'CEREBRAS_API_KEY', settingsKey: 'cerebras' },
  mistral: { envVar: 'MISTRAL_API_KEY', settingsKey: 'mistral' },
};

/**
 * The auth file and login command behind each subscription path, for the same
 * reason. Subscription use is billed as extra usage by the provider — it is not
 * equivalent to using that subscription in the provider's own client.
 */
const SUBSCRIPTION_CREDENTIALS: Partial<Record<ModelProvider, { authFile: string; command: string }>> = {
  anthropic: { authFile: '~/.claude/.credentials.json', command: 'claude /login' },
  openai: { authFile: '~/.codex/auth.json', command: 'pan pi-auth login' },
};

const API_KEY_PROVIDER_IDS: Partial<Record<ModelProvider, string>> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  kimi: 'kimi-coding',
  minimax: 'minimax',
  openrouter: 'openrouter',
  zai: 'zai',
  mimo: 'xiaomi',
  xai: 'xai',
  groq: 'groq',
  cerebras: 'cerebras',
  mistral: 'mistral',
};

const SUBSCRIPTION_PROVIDER_IDS: Partial<Record<ModelProvider, string>> = {
  anthropic: 'anthropic',
  openai: 'openai-codex',
};

export interface PrimeAgentModelRoute {
  provider: string;
  model: string;
}

/** Resolve an Overdeck model without choosing or substituting a fallback model. */
export function resolvePrimeAgentModelRoute(model: string, authMode: AuthMode = 'api-key'): PrimeAgentModelRoute {
  const overdeckProvider = getProviderForModelSync(model).name;
  const provider = (authMode === 'subscription' ? SUBSCRIPTION_PROVIDER_IDS : API_KEY_PROVIDER_IDS)[overdeckProvider];
  if (!provider) {
    throw new PrimeAgentProviderMappingError(
      `Prime Agent does not support Overdeck provider "${overdeckProvider}" with ${authMode} authentication for model "${model}". Configure a verified provider/model mapping; no fallback model was selected.`,
    );
  }
  return { provider, model };
}

/**
 * Refuse a launch whose credential is absent, naming what is missing and how to
 * supply it (`provider-map.ac2`). Both launch paths — work agent and
 * conversation — call this, so the same model gets the same answer regardless of
 * which one asked.
 */
export function assertPrimeAgentCredentialAvailable(model: string, authMode: AuthMode = 'api-key'): void {
  const overdeckProvider = getProviderForModelSync(model).name;
  if (authMode === 'subscription') {
    const subscription = SUBSCRIPTION_CREDENTIALS[overdeckProvider];
    if (!subscription) {
      throw new PrimeAgentCredentialError(
        `Prime Agent has no subscription auth path for Overdeck provider "${overdeckProvider}" (model "${model}"). Configure an API key for it instead.`,
      );
    }
    if (existsSync(subscription.authFile.replace(/^~/, homedir()))) return;
    throw new PrimeAgentCredentialError(
      `Prime Agent cannot launch "${model}" on a ${overdeckProvider} subscription: ${subscription.authFile} is missing. `
      + `Run \`${subscription.command}\` to sign in.`,
    );
  }

  const credential = API_KEY_CREDENTIALS[overdeckProvider];
  if (!credential) {
    throw new PrimeAgentCredentialError(
      `Prime Agent has no credential mapping for Overdeck provider "${overdeckProvider}" (model "${model}").`,
    );
  }
  if (process.env[credential.envVar]) return;
  const configured = (loadSettingsSync().api_keys as Record<string, string | undefined> | undefined)?.[credential.settingsKey];
  if (configured) return;
  throw new PrimeAgentCredentialError(
    `Prime Agent cannot launch "${model}": no credential for Overdeck provider "${overdeckProvider}". `
    + `Export ${credential.envVar}, or set "api_keys.${credential.settingsKey}" in ${SETTINGS_FILE}.`,
  );
}
