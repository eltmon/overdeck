import { PROVIDERS, getProviderForModel } from '../providers.js';
import { MODEL_CAPABILITIES } from '../model-capabilities.js';
import { capabilityClassOf } from '../model-capability-class.js';
import { CONFIGURABLE_PROVIDER_SET } from '../configurable-providers.js';
import type { NormalizedConfig } from '../config-yaml/schema.js';
import type { TierFitnessContext } from './tier-fitness.js';

/** Node-side context builder over the real catalog. The frontend never imports
 * this module — it builds its own literal ctx without provider info. */
export function buildTierFitnessContext(config: Pick<NormalizedConfig, 'enabledProviders'>): TierFitnessContext {
  const knownModelIds = new Set<string>(Object.keys(MODEL_CAPABILITIES));
  for (const provider of Object.values(PROVIDERS)) for (const id of provider.models) knownModelIds.add(id);
  return {
    knownModelIds,
    classOf: capabilityClassOf,
    providerOf: (model) => getProviderForModel(model).name,
    enabledProviders: new Set(config.enabledProviders),
    // PAN-3842 F-1: PROVIDERS carries environment-only providers that no
    // config key can enable; only warn about ones Settings can switch on.
    configurableProviders: CONFIGURABLE_PROVIDER_SET,
  };
}
