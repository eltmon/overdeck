import {
  buildOpenCodeAcpSpawnInput,
  makeOpenCodeAcpRuntime,
  resolveOpenCodeAuthMethodId,
  translateOpenCodeAcpModelId,
} from "./opencode.js";

import {
  buildGrokAcpSpawnInput,
  GROK_EFFORT_CONFIG_ID,
  makeGrokAcpRuntime,
  resolveGrokAuthMethodId,
  translateGrokAcpModelId,
} from "./grok.js";

import {
  buildKimiAcpSpawnInput,
  makeKimiAcpRuntime,
  resolveKimiAuthMethodId,
  translateKimiAcpModelId,
} from "./kimi.js";

const openCodeSupport = {
  buildSpawnInput: buildOpenCodeAcpSpawnInput,
  resolveAuthMethodId: resolveOpenCodeAuthMethodId,
  makeRuntime: makeOpenCodeAcpRuntime,
  translateModelId: translateOpenCodeAcpModelId,
};

const ACP_PROVIDER_SUPPORT = {
  opencode: openCodeSupport,
  "opencode-go": openCodeSupport,
  kimi: {
    buildSpawnInput: buildKimiAcpSpawnInput,
    resolveAuthMethodId: resolveKimiAuthMethodId,
    makeRuntime: makeKimiAcpRuntime,
    translateModelId: translateKimiAcpModelId,
  },
  grok: {
    buildSpawnInput: buildGrokAcpSpawnInput,
    resolveAuthMethodId: resolveGrokAuthMethodId,
    makeRuntime: makeGrokAcpRuntime,
    translateModelId: translateGrokAcpModelId,
    effortConfigId: GROK_EFFORT_CONFIG_ID,
    harness: "grok",
  },
} as const;

/** Optional per-provider settings any ACP_PROVIDER_SUPPORT entry may carry. */
interface AcpProviderSupportOptions {
  /** ACP config option the host sets to the resolved effort right after the model. */
  readonly effortConfigId?: string;
  /** Harness recorded in the session index; absent means "acp". */
  readonly harness?: "acp" | "opencode" | "grok";
}

export type AcpProviderName = keyof typeof ACP_PROVIDER_SUPPORT;
export type AcpProviderSupport = (typeof ACP_PROVIDER_SUPPORT)[AcpProviderName] & AcpProviderSupportOptions;

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
