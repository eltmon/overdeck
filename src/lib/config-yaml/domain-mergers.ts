import { DEFAULT_CONFIG } from './defaults.js';
import {
  COMPLIANCE_MODES,
  type ComplianceMode,
  type NormalizedCavemanConfig,
  type NormalizedConfig,
  type NormalizedDocsConfig,
  type NormalizedFeatureRegistryConfig,
  type NormalizedRemoteConfig,
  type NormalizedRtkConfig,
  type NormalizedShadowConfig,
  type NormalizedTldrConfig,
  type NormalizedTtsDaemonConfig,
  type ResiliencyTier,
  type YamlConfig,
} from './schema.js';

export function isComplianceMode(value: unknown): value is ComplianceMode {
  return typeof value === 'string' && (COMPLIANCE_MODES as readonly string[]).includes(value);
}

export function isFeatureRegistryClassificationProvider(value: unknown): value is NormalizedFeatureRegistryConfig['classification']['provider'] {
  return value === 'anthropic' || value === 'cliproxy';
}

const VALID_RESILIENCY_TIERS: readonly ResiliencyTier[] = ['ephemeral', 'durable'] as const;

function isResiliencyTier(value: unknown): value is ResiliencyTier {
  return typeof value === 'string' && (VALID_RESILIENCY_TIERS as readonly string[]).includes(value);
}

/**
 * Merge remote work-agent provisioning settings from a single config source.
 */
export function mergeRemoteConfig(result: NormalizedConfig, config: YamlConfig | null): void {
  const remote = config?.remote;
  if (!remote) return;

  if (remote.resiliency_tier !== undefined) {
    if (!isResiliencyTier(remote.resiliency_tier)) {
      throw new Error(
        `config.yaml: remote.resiliency_tier must be one of ${VALID_RESILIENCY_TIERS.join(', ')}`,
      );
    }
    result.remote = {
      ...(result.remote ?? { maxConcurrentAgents: 0 }),
      resiliencyTier: remote.resiliency_tier,
    };
  }

  if (remote.max_concurrent_agents !== undefined) {
    if (
      typeof remote.max_concurrent_agents !== 'number' ||
      !Number.isInteger(remote.max_concurrent_agents) ||
      remote.max_concurrent_agents < 0
    ) {
      throw new Error(
        'config.yaml: remote.max_concurrent_agents must be a non-negative integer',
      );
    }
    result.remote = {
      ...(result.remote ?? { resiliencyTier: 'ephemeral' }),
      maxConcurrentAgents: remote.max_concurrent_agents,
    };
  }
}

/**
 * Merge shadow configuration from multiple sources
 */
export function mergeShadowConfig(
  result: NormalizedShadowConfig,
  config: YamlConfig | null
): void {
  if (!config?.shadow) return;

  // Merge global enabled flag
  if (config.shadow.enabled !== undefined) {
    result.enabled = config.shadow.enabled;
  }

  // Merge per-tracker overrides
  if (config.shadow.trackers) {
    if (config.shadow.trackers.linear !== undefined) {
      result.trackers.linear = config.shadow.trackers.linear;
    }
    if (config.shadow.trackers.github !== undefined) {
      result.trackers.github = config.shadow.trackers.github;
    }
    if (config.shadow.trackers.gitlab !== undefined) {
      result.trackers.gitlab = config.shadow.trackers.gitlab;
    }
    if (config.shadow.trackers.rally !== undefined) {
      result.trackers.rally = config.shadow.trackers.rally;
    }
  }
}

/**
 * Merge caveman configuration from a single config source into the result.
 */
export function mergeCavemanConfig(
  result: NormalizedCavemanConfig,
  config: YamlConfig | null
): void {
  const caveman = config?.agents?.caveman;
  if (!caveman) return;

  if (caveman.enabled !== undefined) {
    result.enabled = caveman.enabled;
  }
  if (caveman.ab_test !== undefined) {
    result.abTest = caveman.ab_test;
  }
  if (caveman.work !== undefined) {
    result.modes.work = caveman.work;
  }
  if (caveman.review !== undefined) {
    result.modes.review = caveman.review;
  }
  if (caveman.test !== undefined) {
    result.modes.test = caveman.test;
  }
  if (caveman.merge !== undefined) {
    result.modes.merge = caveman.merge;
  }
}

export function mergeRtkConfig(result: NormalizedRtkConfig, config: YamlConfig | null): void {
  const rtk = config?.agents?.rtk;
  if (!rtk) return;

  if (rtk.enabled !== undefined) {
    result.enabled = rtk.enabled;
  }
}

export function mergeTldrConfig(result: NormalizedTldrConfig, config: YamlConfig | null): void {
  const tldr = config?.agents?.tldr;
  if (!tldr) return;

  if (tldr.enabled !== undefined) {
    result.enabled = tldr.enabled;
  }
}

export function getDefaultRtkConfig(): NormalizedRtkConfig {
  return {
    enabled: DEFAULT_CONFIG.rtk.enabled,
  };
}

export function mergeRtkConfigs(...configs: (YamlConfig | null)[]): NormalizedRtkConfig {
  const result = getDefaultRtkConfig();
  for (const config of configs) {
    mergeRtkConfig(result, config);
  }
  return result;
}

export function cloneDocsConfig(config: NormalizedDocsConfig): NormalizedDocsConfig {
  return {
    enabled: config.enabled,
    promptInjectionEnabled: config.promptInjectionEnabled,
    cliEnabled: config.cliEnabled,
    trigger: {
      regexes: [...config.trigger.regexes],
      caseSensitive: config.trigger.caseSensitive,
    },
    corpus: {
      docs: config.corpus.docs,
      skills: config.corpus.skills,
      rules: config.corpus.rules,
      claudeMd: config.corpus.claudeMd,
      prds: config.corpus.prds,
      prdStatuses: [...config.corpus.prdStatuses],
      maxChunkTokens: config.corpus.maxChunkTokens,
    },
    budget: { ...config.budget },
    embedding: { ...config.embedding },
    classifier: { ...config.classifier },
  };
}

export function mergeDocsConfig(result: NormalizedDocsConfig, config: YamlConfig | null): void {
  const docs = config?.docs;
  if (!docs) return;

  if (docs.enabled !== undefined) result.enabled = docs.enabled;
  if (docs.prompt_injection !== undefined) result.promptInjectionEnabled = docs.prompt_injection;
  if (docs.cli !== undefined) result.cliEnabled = docs.cli;

  if (docs.trigger) {
    if (docs.trigger.regexes !== undefined) result.trigger.regexes = [...docs.trigger.regexes];
    if (docs.trigger.case_sensitive !== undefined) result.trigger.caseSensitive = docs.trigger.case_sensitive;
  }

  if (docs.corpus) {
    if (docs.corpus.docs !== undefined) result.corpus.docs = docs.corpus.docs;
    if (docs.corpus.skills !== undefined) result.corpus.skills = docs.corpus.skills;
    if (docs.corpus.rules !== undefined) result.corpus.rules = docs.corpus.rules;
    if (docs.corpus.claude_md !== undefined) result.corpus.claudeMd = docs.corpus.claude_md;
    if (docs.corpus.prds !== undefined) result.corpus.prds = docs.corpus.prds;
    if (docs.corpus.prd_statuses !== undefined) result.corpus.prdStatuses = [...docs.corpus.prd_statuses];
    if (docs.corpus.max_chunk_tokens !== undefined) result.corpus.maxChunkTokens = docs.corpus.max_chunk_tokens;
  }

  if (docs.budget) {
    if (docs.budget.injection_rate !== undefined) result.budget.injectionRate = docs.budget.injection_rate;
    if (docs.budget.turn_window !== undefined) result.budget.turnWindow = docs.budget.turn_window;
    if (docs.budget.max_tokens_per_injection !== undefined) result.budget.maxTokensPerInjection = docs.budget.max_tokens_per_injection;
    if (docs.budget.max_chunks_per_injection !== undefined) result.budget.maxChunksPerInjection = docs.budget.max_chunks_per_injection;
    if (docs.budget.bypass_classifier_threshold !== undefined) result.budget.bypassClassifierThreshold = docs.budget.bypass_classifier_threshold;
  }

  if (docs.embedding) {
    if (docs.embedding.provider !== undefined) result.embedding.provider = docs.embedding.provider;
    if (docs.embedding.model !== undefined) result.embedding.model = docs.embedding.model;
    if (docs.embedding.dimensions !== undefined) result.embedding.dimensions = docs.embedding.dimensions;
  }

  if (docs.classifier) {
    if (docs.classifier.enabled !== undefined) result.classifier.enabled = docs.classifier.enabled;
    if (docs.classifier.provider !== undefined) result.classifier.provider = docs.classifier.provider;
    if (docs.classifier.model !== undefined) result.classifier.model = docs.classifier.model;
    if (docs.classifier.threshold !== undefined) result.classifier.threshold = docs.classifier.threshold;
    if (docs.classifier.timeout_ms !== undefined) result.classifier.timeoutMs = docs.classifier.timeout_ms;
  }
}

export function getDefaultDocsConfig(): NormalizedDocsConfig {
  return cloneDocsConfig(DEFAULT_CONFIG.docs);
}

export function mergeDocsConfigs(...configs: (YamlConfig | null)[]): NormalizedDocsConfig {
  const result = getDefaultDocsConfig();
  for (const config of configs) {
    mergeDocsConfig(result, config);
  }
  return result;
}

export function mergeTtsConfig(result: NormalizedTtsDaemonConfig, config: YamlConfig | null): void {
  const tts = config?.tts;
  if (!tts) return;

  if (tts.enabled !== undefined) result.enabled = tts.enabled;
  if (tts.lifecycle !== undefined) result.lifecycle = tts.lifecycle;
  if (tts.voice !== undefined) result.voice = tts.voice;
  if (tts.statusVoice !== undefined) result.statusVoice = tts.statusVoice;
  if (tts.volume !== undefined) result.volume = tts.volume;
  if (tts.rate !== undefined) result.rate = tts.rate;
  if (tts.maxChars !== undefined) result.maxChars = tts.maxChars;
  if (tts.dropInfoWhenFull !== undefined) result.dropInfoWhenFull = tts.dropInfoWhenFull;
  if (tts.daemonPort !== undefined) result.daemonPort = tts.daemonPort;
  if (tts.daemonHost !== undefined) result.daemonHost = tts.daemonHost;
  if (tts.daemon?.autoStart !== undefined) result.daemonAutoStart = tts.daemon.autoStart;
  if (tts.voiceMap !== undefined) result.voiceMap = { ...tts.voiceMap };
  if (tts.mutedSources !== undefined) result.mutedSources = [...tts.mutedSources];
  if (tts.utteranceTemplates !== undefined) result.utteranceTemplates = { ...tts.utteranceTemplates };
  if (tts.mutedIssues !== undefined) result.mutedIssues = [...tts.mutedIssues];
}

export function getDefaultTtsDaemonConfig(): NormalizedTtsDaemonConfig {
  return {
    enabled: DEFAULT_CONFIG.tts.enabled,
    lifecycle: DEFAULT_CONFIG.tts.lifecycle ?? true,
    voice: DEFAULT_CONFIG.tts.voice,
    statusVoice: DEFAULT_CONFIG.tts.statusVoice,
    volume: DEFAULT_CONFIG.tts.volume,
    rate: DEFAULT_CONFIG.tts.rate,
    maxChars: DEFAULT_CONFIG.tts.maxChars,
    dropInfoWhenFull: DEFAULT_CONFIG.tts.dropInfoWhenFull,
    daemonPort: DEFAULT_CONFIG.tts.daemonPort,
    daemonHost: DEFAULT_CONFIG.tts.daemonHost,
    daemonAutoStart: DEFAULT_CONFIG.tts.daemonAutoStart,
    voiceMap: { ...DEFAULT_CONFIG.tts.voiceMap },
    mutedSources: [...DEFAULT_CONFIG.tts.mutedSources],
    utteranceTemplates: { ...DEFAULT_CONFIG.tts.utteranceTemplates },
    mutedIssues: [...DEFAULT_CONFIG.tts.mutedIssues],
  };
}

export function mergeTtsDaemonConfigs(...configs: (YamlConfig | null)[]): NormalizedTtsDaemonConfig {
  const result = getDefaultTtsDaemonConfig();
  for (const config of configs) {
    mergeTtsConfig(result, config);
  }
  return result;
}
