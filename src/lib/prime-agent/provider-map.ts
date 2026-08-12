import type { ModelProvider } from '../model-fallback.js';
import type { AuthMode } from '../subscription-types.js';
import { getProviderForModelSync } from '../providers.js';

export class PrimeAgentProviderMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimeAgentProviderMappingError';
  }
}

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
