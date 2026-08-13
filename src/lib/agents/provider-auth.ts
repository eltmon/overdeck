import { Effect } from 'effect';
import { getClaudeAuthStatus } from '../claude-auth.js';
import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import { getOpenAIAuthStatus } from '../openai-auth.js';
import { getProviderForModelSync } from '../providers.js';
import type { AuthMode } from '../subscription-types.js';

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
