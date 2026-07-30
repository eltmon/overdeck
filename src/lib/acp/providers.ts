import {
  buildKimiAcpSpawnInput,
  makeKimiAcpRuntime,
  resolveKimiAuthMethodId,
  translateKimiAcpModelId,
} from "./kimi.js";

export const ACP_PROVIDER_SUPPORT = {
  kimi: {
    buildSpawnInput: buildKimiAcpSpawnInput,
    resolveAuthMethodId: resolveKimiAuthMethodId,
    makeRuntime: makeKimiAcpRuntime,
    translateModelId: translateKimiAcpModelId,
  },
} as const;

export type AcpProviderName = keyof typeof ACP_PROVIDER_SUPPORT;
export type AcpProviderSupport = (typeof ACP_PROVIDER_SUPPORT)[AcpProviderName];

/**
 * Translate an Overdeck model id to the ACP agent's model config value for
 * the given provider. Providers without a translation (and unknown providers)
 * pass the id through unchanged.
 */
export function resolveAcpModelId(provider: string, modelId: string): string {
  if (provider in ACP_PROVIDER_SUPPORT) {
    return ACP_PROVIDER_SUPPORT[provider as AcpProviderName].translateModelId(modelId);
  }
  return modelId;
}

export function resolveAcpProviderSupport(provider: string): AcpProviderSupport {
  if (provider in ACP_PROVIDER_SUPPORT) {
    return ACP_PROVIDER_SUPPORT[provider as AcpProviderName];
  }

  const supportedProviders = Object.keys(ACP_PROVIDER_SUPPORT).join(", ");
  throw new Error(
    `Unknown ACP provider "${provider}". Supported providers: ${supportedProviders}.`,
  );
}
