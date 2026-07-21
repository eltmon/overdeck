import {
  buildKimiAcpSpawnInput,
  makeKimiAcpRuntime,
  resolveKimiAuthMethodId,
} from "./kimi.js";

export const ACP_PROVIDER_SUPPORT = {
  kimi: {
    buildSpawnInput: buildKimiAcpSpawnInput,
    resolveAuthMethodId: resolveKimiAuthMethodId,
    makeRuntime: makeKimiAcpRuntime,
  },
} as const;

export type AcpProviderName = keyof typeof ACP_PROVIDER_SUPPORT;
export type AcpProviderSupport = (typeof ACP_PROVIDER_SUPPORT)[AcpProviderName];

export function resolveAcpProviderSupport(provider: string): AcpProviderSupport {
  if (provider in ACP_PROVIDER_SUPPORT) {
    return ACP_PROVIDER_SUPPORT[provider as AcpProviderName];
  }

  const supportedProviders = Object.keys(ACP_PROVIDER_SUPPORT).join(", ");
  throw new Error(
    `Unknown ACP provider "${provider}". Supported providers: ${supportedProviders}.`,
  );
}
