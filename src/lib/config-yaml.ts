/**
 * YAML Configuration Loader
 *
 * Loads and merges configuration from:
 * 1. Global config: ~/.overdeck/config.yaml
 * 2. Per-project config: .pan.yaml (project root, falls back to .overdeck.yaml with deprecation warning)
 *
 * Uses smart (capability-based) model selection - no legacy presets.
 */

import { readFileSync, existsSync, writeFileSync, copyFileSync, statSync, chmodSync } from 'fs';
import { readFile as readFileAsync, writeFile as writeFileAsync, stat as statAsync, mkdir as mkdirAsync, chmod as chmodAsync } from 'fs/promises';
import { Effect } from 'effect';
import { ConfigError, ConfigParseError } from './errors.js';
import { dirname, join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { parseDocument } from 'yaml';
import { ModelId } from './settings.js';
import { ModelProvider } from './model-fallback.js';
import { MODEL_DEPRECATIONS, resolveModelIdSync, getModelEffortLevelsSync, type EffortLevel } from './model-capabilities.js';
import type { SubscriptionPlan, AuthMode } from './subscription-types.js';
import type { Role } from './agents.js';
import type { RuntimeName } from './runtimes/types.js';
import {
  BACKGROUND_AI_FEATURES,
  defaultBackgroundAiFeatures,
  type BackgroundAiFeature,
} from './background-ai/registry.js';
export type { SubscriptionPlan, AuthMode };

/**
 * Provider configuration (enable/disable + API keys)
 */
export interface ProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** API key (optional, can use env var) */
  api_key?: string;
  /** Default harness for this provider's models. Role/request harnesses override this. */
  harness?: RuntimeName;
  /** Authentication mode: api-key (default) or subscription (OAuth) */
  auth?: AuthMode;
  /** Subscription plan tier (only used when auth is 'subscription') */
  plan?: SubscriptionPlan;
}

/**
 * Shadow mode configuration
 */
export interface ShadowConfig {
  /** Global shadow mode default */
  enabled?: boolean;

  /** Per-tracker overrides */
  trackers?: {
    linear?: boolean;
    github?: boolean;
    gitlab?: boolean;
    rally?: boolean;
  };
}

export type TmuxConfigMode = 'managed' | 'inherit-user';

export interface TmuxConfig {
  /** Whether Overdeck uses its own tmux server/config or inherits the user's tmux config */
  config_mode?: TmuxConfigMode;
}

export interface MemoryConfig {
  extraction?: {
    provider?: 'anthropic' | 'cliproxy';
    model?: string;
    per_day_cost_cap_usd?: number;
    fallback_chain?: Array<{ provider: 'anthropic' | 'cliproxy'; model: string }>;
  };
  features?: {
    observations?: boolean;
    prompt_time_injection?: boolean;
  };
  rollup_pending_threshold?: number;
  sidebar_refresh_interval_ms?: number;
  worker_concurrency?: number;
}

/**
 * Background AI configuration (PAN-1583).
 *
 * `cheap_mode` is the high-level low-cost master switch: when true, every
 * optional background AI feature is disabled in one click, regardless of its
 * individual `features.<key>` toggle. Individual toggles let the user enable or
 * disable each background AI feature independently when cheap mode is off.
 *
 * `cheap_mode` defaults ON (PAN-1589): background AI is off until the user
 * opts in. While it is on, the dashboard status bar shows a "Low-cost mode"
 * pill linking to this config section.
 */
export interface BackgroundAiConfig {
  cheap_mode?: boolean;
  features?: Partial<Record<BackgroundAiFeature, boolean>>;
}

export const COMPLIANCE_MODES = ['off', 'advisory', 'enforcing'] as const;
export type ComplianceMode = typeof COMPLIANCE_MODES[number];

export interface ComplianceConfig {
  mode?: ComplianceMode;
}

export interface NormalizedComplianceConfig {
  mode: ComplianceMode;
}

export type ResiliencyTier = 'ephemeral' | 'durable';

export interface RemoteConfig {
  /** Durability/resiliency tier for remote work agents. */
  resiliency_tier?: ResiliencyTier;
  /** Maximum concurrent remote work agents (0 = unlimited). */
  max_concurrent_agents?: number;
}

export interface NormalizedRemoteConfig {
  resiliencyTier: ResiliencyTier;
  maxConcurrentAgents: number;
}

export interface FeatureRegistryClassificationConfig {
  enabled?: boolean;
  provider?: 'anthropic' | 'cliproxy';
  model?: string;
  per_day_cost_cap_usd?: number;
}

export interface FeatureRegistryConfig {
  classification?: FeatureRegistryClassificationConfig;
}

export interface NormalizedFeatureRegistryConfig {
  classification: {
    enabled: boolean;
    provider: 'anthropic' | 'cliproxy';
    model: string;
    perDayCostCapUsd: number;
  };
}

function isComplianceMode(value: unknown): value is ComplianceMode {
  return typeof value === 'string' && (COMPLIANCE_MODES as readonly string[]).includes(value);
}

function isFeatureRegistryClassificationProvider(value: unknown): value is NormalizedFeatureRegistryConfig['classification']['provider'] {
  return value === 'anthropic' || value === 'cliproxy';
}

const VALID_RESILIENCY_TIERS: readonly ResiliencyTier[] = ['ephemeral', 'durable'] as const;

function isResiliencyTier(value: unknown): value is ResiliencyTier {
  return typeof value === 'string' && (VALID_RESILIENCY_TIERS as readonly string[]).includes(value);
}

/**
 * Merge remote work-agent provisioning settings from a single config source.
 */
function mergeRemoteConfig(result: NormalizedConfig, config: YamlConfig | null): void {
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

export type ManualCompactMode = 'claude-code' | 'overdeck-native';

export interface ConversationsConfig {
  /** Model used for Overdeck-native conversation compaction */
  compaction_model?: ModelId;
  /** How typed /compact in the conversation composer is handled */
  manual_compact_mode?: ManualCompactMode;
  /** Whether to use the richer 9-section summary format (more tokens, less efficient incremental updates) */
  rich_compaction?: boolean;
  /** Model used for AI-generated conversation titles (default: claude-haiku-4-5) */
  title_model?: ModelId;
  watch_dirs?: string[];
  scan_max_parallel?: number | null;
  embeddings?: boolean;
  embedding_provider?: 'openai' | 'voyage' | 'ollama';
  embedding_model?: string;
  embedding_auto_on_deep?: boolean;
  enrichment?: {
    quick_model?: string | null;
    deep_model?: string | null;
    max_parallel?: number;
    cost_confirm_threshold?: number;
  };
}

export type ConversationSearchProvider = 'openai';

export interface ConversationSearchConfig {
  /** Whether conversation semantic search is enabled. Default: false. */
  enabled?: boolean;
  /** Embedding provider. Default: 'openai'. */
  provider?: ConversationSearchProvider;
  /** Embedding model. Default: 'text-embedding-3-small'. */
  model?: string;
  /** Name of an env var or config key holding the API key. Default: provider's standard env var. */
  apiKeyRef?: string;
  /** Path to the sidecar embeddings DB. Default: ~/.overdeck/conversations/embeddings.db. */
  dbPath?: string;
}

export interface NormalizedConversationSearchConfig {
  enabled: boolean;
  provider: ConversationSearchProvider;
  model: string;
  apiKeyRef: string | undefined;
  dbPath: string;
}

export type DocsEmbeddingProvider = 'local' | 'openai';
export type DocsClassifierProvider = 'anthropic' | 'cliproxy';
export type DocsPrdStatus = 'active' | 'planned' | 'completed';

export interface DocsConfig {
  enabled?: boolean;
  prompt_injection?: boolean;
  cli?: boolean;
  trigger?: {
    regexes?: string[];
    case_sensitive?: boolean;
  };
  corpus?: {
    docs?: boolean;
    skills?: boolean;
    rules?: boolean;
    claude_md?: boolean;
    prds?: boolean;
    prd_statuses?: DocsPrdStatus[];
    max_chunk_tokens?: number;
  };
  budget?: {
    injection_rate?: number;
    turn_window?: number;
    max_tokens_per_injection?: number;
    max_chunks_per_injection?: number;
    bypass_classifier_threshold?: number;
  };
  embedding?: {
    provider?: DocsEmbeddingProvider;
    model?: string;
    dimensions?: number;
  };
  classifier?: {
    enabled?: boolean;
    provider?: DocsClassifierProvider;
    model?: string;
    threshold?: number;
    timeout_ms?: number;
  };
}

export interface NormalizedDocsConfig {
  enabled: boolean;
  promptInjectionEnabled: boolean;
  cliEnabled: boolean;
  trigger: {
    regexes: string[];
    caseSensitive: boolean;
  };
  corpus: {
    docs: boolean;
    skills: boolean;
    rules: boolean;
    claudeMd: boolean;
    prds: boolean;
    prdStatuses: DocsPrdStatus[];
    maxChunkTokens: number;
  };
  budget: {
    injectionRate: number;
    turnWindow: number;
    maxTokensPerInjection: number;
    maxChunksPerInjection: number;
    bypassClassifierThreshold: number;
  };
  embedding: {
    provider: DocsEmbeddingProvider;
    model: string;
    dimensions: number;
  };
  classifier: {
    enabled: boolean;
    provider: DocsClassifierProvider;
    model: string;
    threshold: number;
    timeoutMs: number;
  };
}

/**
 * TTS summarizer configuration
 */
export interface TtsSummarizerConfig {
  /** Whether the TTS summarizer is active */
  enabled?: boolean;
  /** Model ID to use for summarization (default: gpt-5.4-mini) */
  model?: ModelId;
  /** Seconds to batch activity before summarizing (default: 15) */
  batch_window_seconds?: number;
}

export interface TtsDaemonConfig {
  enabled?: boolean;
  /** Announce planning/work agent lifecycle (start + finish) via TTS. Default true. */
  lifecycle?: boolean;
  voice?: string;
  statusVoice?: string;
  volume?: number;
  rate?: number;
  maxChars?: number;
  dropInfoWhenFull?: boolean;
  daemonPort?: number;
  daemonHost?: string;
  daemon?: {
    autoStart?: boolean;
  };
  voiceMap?: Record<string, string>;
  mutedSources?: string[];
  utteranceTemplates?: Record<string, string>;
  mutedIssues?: string[];
}

export interface NormalizedTtsDaemonConfig {
  enabled: boolean;
  /**
   * Announce planning/work agent lifecycle events (start + finish) via TTS.
   * Default true. Set false to mute the substrate-breathing announcements
   * without disabling TTS overall.
   */
  lifecycle: boolean;
  voice: string;
  statusVoice?: string;
  volume: number;
  rate: number;
  maxChars: number;
  dropInfoWhenFull: boolean;
  daemonPort: number;
  daemonHost: string;
  daemonAutoStart: boolean;
  voiceMap: Record<string, string>;
  mutedSources: string[];
  utteranceTemplates: Record<string, string>;
  mutedIssues: string[];
}

export type WorkhorseSlot = 'expensive' | 'mid' | 'cheap';
export type ModelRef = string;
export const PARENT_MODEL_REF = 'parent';

export interface WeightedModelRef {
  model: ModelRef;
  weight: number;
}

/** Top-level role model: either a scalar model string or a weighted distribution list. */
export type RoleModelRef = ModelRef | WeightedModelRef[];

/** 32-bit FNV-1a hash — deterministic, no Math.random / Date.now. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * MurmurHash3 32-bit finalizer — an avalanche/bit-mixing step.
 *
 * WHY this exists (PAN-2055): raw `fnv1a32(key) / 2^32` distributes terribly for
 * structured, common-prefix keys like `work:PAN-1901`, `work:PAN-1919`, … — FNV's
 * HIGH-order bits (which dominate the /2^32 normalization) barely avalanche between
 * near-identical inputs, so sequential issue keys cluster into the same weight band.
 * Measured over 161 sequential `work:PAN-19xx` keys against a 1/1/1 distribution the
 * raw hash gave kimi 68% / glm 30% / gpt 2% — i.e. the load-spreading was broken.
 * Running the FNV output through this finalizer first restores ~uniform spread
 * (≈33/33/33). Deterministic; pure bit ops.
 */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministically map a spawn key to a well-distributed value in [0, 1). FNV-1a
 * for the per-character mixing, then a MurmurHash3 finalizer (`fmix32`) so the high
 * bits avalanche — see `fmix32` for why the finalizer is required.
 */
export function hashKeyToUnitInterval(key: string): number {
  return fmix32(fnv1a32(key)) / 0x100000000;
}

/** One entry of a weighted pick, with the half-open hash band [lo, hi) it owns. */
export interface WeightedBand {
  /** The entry's model ref (NOT dereffed — may be a `workhorse:*` ref). */
  model: ModelRef;
  weight: number;
  /** Band start in [0, 1). */
  lo: number;
  /** Band end in (0, 1]. A spawn key whose hash01 falls in [lo, hi) selects this entry. */
  hi: number;
  /** True for the single entry the spawn key selected. */
  chosen: boolean;
}

/** The full, inspectable result of a weighted pick — what selected the model and why. */
export interface WeightedPick {
  /** The selected model ref (same value `pickWeightedModelRef` returns). */
  chosen: ModelRef;
  /** `fnv1a32(spawnKey) / 2^32`, normalized to [0, 1). */
  hash01: number;
  /** Every entry, in declaration order, with its band and the chosen flag. */
  bands: WeightedBand[];
}

/**
 * Deterministically pick a model from a weighted distribution AND return the full
 * derivation (hash, per-entry bands, winner) so it can be shown read-only in the UI.
 *
 * This is the single source of truth for the weighted-pick math: `pickWeightedModelRef`
 * delegates to it, so the band a key falls into here is exactly the model that gets
 * spawned. Weights are relative (need not sum to 100). Throws if no entry has weight > 0.
 */
export function deriveWeightedPick(entries: WeightedModelRef[], spawnKey: string): WeightedPick {
  let totalWeight = 0;
  for (const e of entries) {
    if (e.weight > 0) totalWeight += e.weight;
  }
  if (totalWeight <= 0) {
    throw new Error('deriveWeightedPick: all entries have weight <= 0');
  }
  // Map the key to a well-distributed [0, 1) value (FNV-1a + fmix32 avalanche).
  // The finalizer is essential: raw fnv1a32/2^32 clusters common-prefix issue keys
  // into one band and breaks load-spreading (PAN-2055). Proportional weight sets
  // still give identical picks (7/10 and 70/100 are the same double → same bands).
  const hash01 = hashKeyToUnitInterval(spawnKey);
  const bands: WeightedBand[] = [];
  let cumFraction = 0;
  let chosenIdx = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.weight <= 0) {
      // Zero-weight entries occupy an empty band; they can never be selected.
      bands.push({ model: e.model, weight: e.weight, lo: cumFraction, hi: cumFraction, chosen: false });
      continue;
    }
    const lo = cumFraction;
    cumFraction += e.weight / totalWeight;
    const hi = cumFraction;
    const isChosen = chosenIdx === -1 && hash01 < hi;
    if (isChosen) chosenIdx = i;
    bands.push({ model: e.model, weight: e.weight, lo, hi, chosen: isChosen });
  }
  if (chosenIdx === -1) {
    // Floating-point accumulation may leave the final band slightly below 1.0; fall
    // through to the last entry — matches the original pickWeightedModelRef semantics.
    chosenIdx = entries.length - 1;
    bands[chosenIdx].chosen = true;
  }
  return { chosen: entries[chosenIdx].model, hash01, bands };
}

/**
 * Pick a model from a weighted distribution using a deterministic spawn key.
 * Weights are relative (need not sum to 100). {a:7, b:3} and {a:70, b:30} produce
 * identical per-key picks. Throws if no entry has weight > 0.
 *
 * Thin wrapper over `deriveWeightedPick` so selection and its explanation can never drift.
 */
export function pickWeightedModelRef(entries: WeightedModelRef[], spawnKey: string): ModelRef {
  return deriveWeightedPick(entries, spawnKey).chosen;
}

/** Return the model with the highest weight; first entry wins on a tie. */
export function representativeModelRef(entries: WeightedModelRef[]): ModelRef {
  let best = entries[0];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].weight > best.weight) best = entries[i];
  }
  return best.model;
}

/**
 * Canonical workhorse slot list. Anything outside this set is rejected by
 * config-load validation (PAN-1048 review feedback 003 / REQ-18).
 */
export const WORKHORSE_SLOTS: readonly WorkhorseSlot[] = ['expensive', 'mid', 'cheap'] as const;

export type WorkhorsesConfig = Partial<Record<WorkhorseSlot, ModelRef>>;

export interface RoleSubConfig {
  model: ModelRef;
}

export type RoleEffort = EffortLevel;
export const ROLE_EFFORTS: readonly RoleEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type FlywheelScope = 'pan-only' | 'all-tracked-projects';

export interface RoleConfig {
  model: RoleModelRef;
  harness?: 'claude-code' | 'ohmypi' | 'codex';
  effort?: RoleEffort;
  /**
   * Target minimum concurrent agents the role should keep launched. The
   * orchestrator MUST be aggressive about reaching this number — if the active
   * count is below `minAgents`, launching new agents is the tick's primary
   * action, not optional. For the flywheel role only.
   */
  minAgents?: number;
  /**
   * Hard ceiling on concurrent agents. The orchestrator never spawns past
   * this number, even if more work is queued.
   */
  maxAgents?: number;
  scope?: FlywheelScope;
  sub?: Record<string, RoleSubConfig>;
}

export type RolesConfig = Partial<Record<Role, RoleConfig>>;

export const DEFAULT_MODEL_REFS: Record<Role, ModelRef> = {
  plan: 'workhorse:expensive',
  work: 'workhorse:mid',
  review: 'workhorse:expensive',
  test: 'workhorse:mid',
  ship: 'workhorse:mid',
  flywheel: 'claude-opus-4-8',
  // Strike merges directly to main — precision matters, so default to the
  // expensive workhorse slot (same as plan/review).
  strike: 'workhorse:expensive',
  sequencer: 'workhorse:expensive',
};

export const DEFAULT_WORKHORSES: Required<WorkhorsesConfig> = {
  expensive: 'claude-opus-4-8',
  mid: 'claude-sonnet-4-6',
  cheap: 'claude-haiku-4-5',
};

export const DEFAULT_ROLES: Record<Role, RoleConfig> = {
  plan: { model: 'workhorse:expensive' },
  work: {
    model: 'workhorse:mid',
    sub: {
      inspect: { model: 'workhorse:cheap' },
      'inspect-deep': { model: 'workhorse:mid' },
    },
  },
  review: {
    model: 'workhorse:expensive',
    sub: {
      security: { model: 'workhorse:expensive' },
      correctness: { model: 'workhorse:mid' },
      performance: { model: 'workhorse:mid' },
      requirements: { model: 'workhorse:mid' },
      synthesis: { model: 'workhorse:expensive' },
    },
  },
  test: { model: 'workhorse:mid' },
  ship: { model: 'workhorse:mid' },
  // Strike (precision-merge-to-main role) — defaults to the expensive workhorse
  // slot because strike skips the normal review pipeline and lands directly.
  strike: { model: 'workhorse:expensive' },
  sequencer: { model: 'workhorse:expensive' },
  flywheel: {
    model: 'claude-opus-4-8',
    effort: 'high',
    minAgents: 20,
    maxAgents: 30,
    scope: 'pan-only',
  },
};

function cloneRoles(roles: RolesConfig): RolesConfig {
  const cloned: RolesConfig = {};
  for (const [role, roleConfig] of Object.entries(roles) as Array<[Role, RoleConfig]>) {
    cloned[role] = {
      ...roleConfig,
      // Shallow-clone the distribution array so later mutations can't alias the cloned config.
      model: Array.isArray(roleConfig.model) ? [...roleConfig.model] : roleConfig.model,
      sub: roleConfig.sub ? { ...roleConfig.sub } : undefined,
    };
  }
  return cloned;
}

export interface ResourcesConfig {
  /** Available RAM threshold that triggers a warning state/guardrail (GiB) */
  memory_warn_gb?: number;
  /** Available RAM threshold that blocks spawns / marks critical state (GiB) */
  memory_block_gb?: number;
  /** Work-agent count threshold that triggers a warning */
  agent_warn_count?: number;
  /** Work-agent count threshold that blocks new spawns */
  agent_block_count?: number;
}

/**
 * Complete configuration structure (YAML schema)
 */
export interface YamlConfig {
  /** Model configuration */
  models?: {
    /** Provider enable/disable and API keys */
    providers?: {
      anthropic?: ProviderConfig | boolean;
      openai?: ProviderConfig | boolean;
      google?: ProviderConfig | boolean;
      minimax?: ProviderConfig | boolean;
      zai?: ProviderConfig | boolean;
      kimi?: ProviderConfig | boolean;
      mimo?: ProviderConfig | boolean;
      openrouter?: ProviderConfig | boolean;
      nous?: ProviderConfig | boolean;
      dashscope?: ProviderConfig | boolean;
    };

    /** Per-work-type overrides (explicit model for specific tasks) */
    overrides?: Partial<Record<string, ModelId>>;

    /** Gemini thinking level (1-4) */
    gemini_thinking_level?: 1 | 2 | 3 | 4;

    /** Persisted default conversation model (overrides dynamic provider-based selection) */
    default_conversation_model?: ModelId;
  };

  /** OpenRouter-specific configuration */
  openrouter?: {
    /** Favorite model IDs to show in ModelPicker */
    favorites?: string[];
  };

  /** Legacy API keys (for backward compatibility) */
  api_keys?: {
    openai?: string;
    voyage?: string;
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
    openrouter?: string;
    nous?: string;
    dashscope?: string;
  };

  /** Tracker API keys (override environment variables) */
  tracker_keys?: {
    linear?: string;
    github?: string;
    gitlab?: string;
    rally?: string;
  };

  /** Shadow mode configuration */
  shadow?: ShadowConfig;

  /** tmux runtime configuration */
  tmux?: TmuxConfig;

  /** Conversation-specific configuration */
  conversations?: ConversationsConfig;

  /** Overdeck docs RAG configuration */
  docs?: DocsConfig;

  /** Semantic conversation search configuration (Phase 2 palette) */
  conversationSearch?: ConversationSearchConfig;

  /** Durable memory extraction and retrieval configuration */
  memory?: MemoryConfig;

  /** Background AI feature toggles + low-cost master switch (PAN-1583) */
  background_ai?: BackgroundAiConfig;

  /** Memory-first compliance audit configuration */
  compliance?: ComplianceConfig;

  /** Knowledge registry population configuration */
  registry?: FeatureRegistryConfig;

  /** Multi-tool sync configuration */
  tools?: {
    /**
     * Additional AI tools to sync skills to.
     * Supported: 'cursor' | 'codex' | 'windsurf' | 'cline' | 'copilot' | 'aider'
     * Per-project .pan.yaml values merge additively with global config.
     */
    also_sync?: string[];
  };

  /** Agent behavior configuration */
  agents?: {
    /** Caveman compressed output mode configuration */
    caveman?: CavemanConfig;
    /** RTK Bash output compression configuration */
    rtk?: RtkConfig;
    /** TLDR token-efficient code-analysis configuration */
    tldr?: TldrConfig;
  };

  /** TTS configuration */
  tts?: TtsDaemonConfig & {
    summarizer?: TtsSummarizerConfig;
  };

  /** Workhorse model slots for role model indirection. */
  workhorses?: WorkhorsesConfig;

  /** Role-specific model and harness configuration. */
  roles?: RolesConfig;

  /** Resource thresholds for dashboard health + spawn guardrails */
  resources?: ResourcesConfig;

  /** Experimental, opt-in features. Each flag is research-preview and may be removed. */
  experimental?: ExperimentalConfig;

  /**
   * Claude Code spawn behavior.
   *
   * `permissionMode: 'auto'` (default) emits `--permission-mode auto`; the classifier
   * blocks destructive ops while still running fully autonomously. `'bypass'` emits
   * `--permission-mode bypassPermissions` (the standalone `--dangerously-skip-permissions`
   * flag was removed). Override per-invocation with `--yolo` / `--no-yolo` / `PAN_YOLO`.
   */
  claude?: {
    permissionMode?: 'auto' | 'bypass';
  };

  /**
   * Codex spawn behavior for conversation sessions (TUI mode).
   *
   * 'read-only'   — approval_policy=on-request + sandbox_mode=read-only:
   *                 Codex can browse files but asks before any write or command.
   * 'workspace'   — approval_policy=on-request + sandbox_mode=workspace-write (default):
   *                 Codex works freely inside the cwd, asks before going outside or using the network.
   * 'auto-review' — approval_policy=on-request + approvals_reviewer=auto_review + sandbox_mode=workspace-write:
   *                 A sub-agent reviews and auto-answers approval requests instead of prompting the user.
   * 'full-access' — approval_policy=never + sandbox_mode=danger-full-access:
   *                 No approval prompts; full filesystem and network access.
   */
  codex?: {
    permissionMode?: 'read-only' | 'workspace' | 'auto-review' | 'full-access';
  };

  /** Remote work-agent provisioning settings (dashboard-editable subset). */
  remote?: RemoteConfig;
}

/**
 * Experimental, opt-in feature flags. All default to false.
 *
 * Flags here gate research-preview features that may break or be removed in future
 * releases. Code paths gated by these flags must always degrade silently to the
 * existing default behaviour when the flag is off.
 */
export interface ExperimentalConfig {
  /** Show experimental dashboard surfaces in navigation and direct routes. */
  experimentalFeatures?: boolean;
  /**
   * Use Claude Code Channels (research-preview MCP capability) for prompt delivery
   * to eligible work agents. When enabled, eligible agents receive prompts via a
   * per-agent MCP bridge over a Unix socket; ineligible agents and all non-work
   * delivery sites continue to use tmux send-keys. Default: false.
   */
  claudeCodeChannels?: boolean;
  claudeCodeChannelsMcp?: boolean;
  /** Render dashboard chat markdown with Streamdown instead of ReactMarkdown. */
  streamdownRenderer?: boolean;
  /**
   * Show the advanced harness selector and all explicit harness/model choices in
   * dashboard model pickers. Default false: pickers use each provider's default
   * harness and hide the permutation matrix.
   */
  showHarnessModelPermutations?: boolean;
}

/**
 * Valid caveman intensity modes for agents.
 * Maps to CAVEMAN_DEFAULT_MODE env var values recognised by caveman-config.js.
 */
export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra' | 'review' | 'disabled';

/**
 * Caveman hook configuration.
 *
 * Controls whether autonomous agents use the caveman compressed-output hooks to
 * reduce output tokens ~65-75% without losing technical accuracy.
 *
 * Example (~/.overdeck/config.yaml):
 *   agents:
 *     caveman:
 *       enabled: true
 *       ab_test: false
 *       work: full
 *       review: review
 *       test: full
 *       merge: full
 */
export interface CavemanConfig {
  /** Master switch — set to false to disable caveman globally with zero workspace changes */
  enabled?: boolean;
  /**
   * A/B testing mode — randomly assigns new workspaces to enabled/disabled at creation.
   * The variant is stored in workspace metadata and propagated to cost events.
   */
  ab_test?: boolean;
  /** Intensity for work agents (default: 'full') */
  work?: CavemanMode;
  /** Intensity for review agents (default: 'review') */
  review?: CavemanMode;
  /** Intensity for test agents (default: 'full') */
  test?: CavemanMode;
  /** Intensity for merge agents (default: 'full') */
  merge?: CavemanMode;
}

export interface RtkConfig {
  enabled?: boolean;
}

/**
 * TLDR (token-efficient code analysis) configuration.
 *
 * When enabled, work/planning agents whose workspace has a TLDR `.venv` get the
 * TLDR MCP tools wired in and their prompt advertises TLDR as available; the
 * per-workspace TLDR daemon is started at spawn. When disabled, agents fall back
 * to direct file reads regardless of whether a `.venv` is present. Default ON to
 * preserve historical behaviour (TLDR was implicitly on whenever a `.venv`
 * existed). Changing this only affects sessions launched/resumed AFTER the
 * change — running agents must be resumed to pick it up.
 */
export interface TldrConfig {
  enabled?: boolean;
}

/**
 * Normalized shadow configuration
 */
export interface NormalizedShadowConfig {
  /** Global shadow mode enabled */
  enabled: boolean;

  /** Per-tracker overrides */
  trackers: {
    linear: boolean;
    github: boolean;
    gitlab: boolean;
    rally: boolean;
  };
}

/**
 * Normalized configuration (after loading and merging)
 */
export interface NormalizedConfig {
  /** tmux runtime configuration */
  tmux: {
    configMode: TmuxConfigMode;
  };

  /** Enabled providers */
  enabledProviders: Set<ModelProvider>;

  /** API keys by provider */
  apiKeys: {
    openai?: string;
    voyage?: string;
    google?: string;
    minimax?: string;
    zai?: string;
    kimi?: string;
    mimo?: string;
    openrouter?: string;
    nous?: string;
    dashscope?: string;
  };

  /** Provider auth mode (subscription vs api-key) by provider */
  providerAuth: Partial<Record<ModelProvider, AuthMode>>;

  /** Provider subscription plan by provider */
  providerPlan: Partial<Record<ModelProvider, SubscriptionPlan>>;

  /** Default harness by provider. Role/request harnesses override these defaults. */
  providerHarnesses: Partial<Record<ModelProvider, RuntimeName>>;

  /** OpenRouter favorite model IDs (shown in ModelPicker) */
  openrouterFavorites: string[];

  /** Optional workhorse model slots used by role model references. */
  workhorses?: WorkhorsesConfig;

  /** Optional role model/harness configuration. */
  roles?: RolesConfig;

  /** Per-work-type overrides */
  overrides: Partial<Record<string, ModelId>>;

  /** Gemini thinking level */
  geminiThinkingLevel: 1 | 2 | 3 | 4;

  /** Persisted default conversation model (overrides dynamic provider-based selection) */
  defaultConversationModel?: ModelId;

  /** Tracker API keys */
  trackerKeys: {
    linear?: string;
    github?: string;
    gitlab?: string;
    rally?: string;
  };

  /** Conversation-specific behavior */
  conversations: {
    compactionModel: ModelId;
    manualCompactMode: ManualCompactMode;
    richCompaction: boolean;
    titleModel: ModelId;
    watchDirs: string[];
    scanMaxParallel: number | null;
    embeddings: boolean;
    embeddingProvider: 'openai' | 'voyage' | 'ollama';
    embeddingModel: string;
    embeddingAutoOnDeep: boolean;
    enrichment: {
      quickModel: string | null;
      deepModel: string | null;
      maxParallel: number;
      costConfirmThreshold: number;
    };
  };

  /** Overdeck docs RAG behavior */
  docs: NormalizedDocsConfig;

  /** Semantic conversation search configuration (Phase 2 palette) */
  conversationSearch: NormalizedConversationSearchConfig;

  /** Durable memory extraction and retrieval configuration */
  memory: {
    extraction: {
      provider?: 'anthropic' | 'cliproxy';
      model?: string;
      perDayCostCapUsd?: number;
      fallbackChain: Array<{ provider: 'anthropic' | 'cliproxy'; model: string }>;
    };
    observationsEnabled: boolean;
    promptTimeInjectionEnabled: boolean;
    rollupPendingThreshold: number;
    sidebarRefreshIntervalMs: number;
    workerConcurrency: number;
  };

  /** Background AI feature toggles + low-cost master switch (PAN-1583) */
  backgroundAi: {
    /** Low-cost master switch: when true, all optional background AI is off. */
    cheapMode: boolean;
    /** Per-feature enablement, consulted by `isBackgroundFeatureEnabled`. */
    features: Record<BackgroundAiFeature, boolean>;
  };

  /** Memory-first compliance audit configuration */
  compliance: NormalizedComplianceConfig;

  /** Knowledge registry population configuration */
  registry: NormalizedFeatureRegistryConfig;

  /** Shadow mode configuration */
  shadow: NormalizedShadowConfig;

  /** Caveman compressed output configuration (normalised, never undefined) */
  caveman: NormalizedCavemanConfig;

  /** RTK Bash output compression configuration (normalised, never undefined) */
  rtk: NormalizedRtkConfig;

  /** TLDR token-efficient code-analysis configuration (normalised, never undefined) */
  tldr: NormalizedTldrConfig;

  /** TTS daemon configuration (normalised, never undefined) */
  tts: NormalizedTtsDaemonConfig;

  /** TTS summarizer configuration (normalised, never undefined) */
  ttsSummarizer: {
    enabled: boolean;
    model: ModelId;
    batchWindowSeconds: number;
  };

  /** Resource thresholds (normalised, never undefined) */
  resources: {
    memoryWarnGb: number;
    memoryBlockGb: number;
    agentWarnCount: number;
    agentBlockCount: number;
  };

  /** Experimental flag values, normalised (always defined, never undefined). */
  experimental: NormalizedExperimentalConfig;

  /** Permission-mode for spawned Claude Code agents. Always defined; defaults to 'auto'. */
  claude: {
    permissionMode: 'auto' | 'bypass';
  };

  /** Permission-mode for Codex TUI conversation sessions. Always defined; defaults to 'workspace'. */
  codex: {
    permissionMode: 'read-only' | 'workspace' | 'auto-review' | 'full-access';
  };

  /** Remote work-agent provisioning settings surfaced by the dashboard. */
  remote?: NormalizedRemoteConfig;
}

/**
 * Normalized experimental flags — every flag has a concrete boolean value.
 */
export interface NormalizedExperimentalConfig {
  /** Whether experimental dashboard surfaces are visible. */
  experimentalFeatures: boolean;
  /** Whether Claude Code Channels prompt delivery is enabled for eligible work agents. */
  claudeCodeChannels: boolean;
  /** Whether legacy Claude Code Channels MCP wiring is enabled for new spawns. */
  claudeCodeChannelsMcp: boolean;
  /** Whether dashboard chat markdown renders through Streamdown. */
  streamdownRenderer: boolean;
  /** Whether model pickers expose explicit harness/model permutations. */
  showHarnessModelPermutations: boolean;
}

/**
 * Normalized caveman configuration — all fields resolved to their effective values.
 */
export interface NormalizedCavemanConfig {
  /** Whether caveman hooks are active for new workspaces */
  enabled: boolean;
  /** A/B testing mode active */
  abTest: boolean;
  /** Per-agent-type intensity (already resolved, never undefined) */
  modes: {
    work: CavemanMode;
    review: CavemanMode;
    test: CavemanMode;
    merge: CavemanMode;
  };
}

export interface NormalizedRtkConfig {
  enabled: boolean;
}

/** Normalized TLDR configuration (never undefined). */
export interface NormalizedTldrConfig {
  enabled: boolean;
}

/**
 * Model ID migration result
 *
 * Returned when deprecated model IDs are automatically migrated
 * during config load.
 */
export type RuntimeConversationsConfig = NormalizedConfig['conversations'] & {
  apiKeys?: NormalizedConfig['apiKeys'];
  enabledProviders?: NormalizedConfig['enabledProviders'];
};

export function resolveConversationWatchDirs(config: RuntimeConversationsConfig): RuntimeConversationsConfig {
  return {
    ...config,
    watchDirs: config.watchDirs.map((dir) =>
      dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir,
    ),
  };
}

export function getConversationsConfigSync(): RuntimeConversationsConfig {
  const { config } = loadConfigSync();
  return resolveConversationWatchDirs({
    ...config.conversations,
    apiKeys: config.apiKeys,
    enabledProviders: config.enabledProviders,
  });
}



export function getConversationSearchConfigSync(): NormalizedConversationSearchConfig {
  const { config } = loadConfigSync();
  return config.conversationSearch;
}

export interface MigrationResult {
  /** List of migrated model IDs */
  migrated: Array<{
    /** Work type that was migrated */
    workType: string;
    /** Old (deprecated) model ID */
    from: string;
    /** New (current) model ID */
    to: string;
  }>;
  /** Whether config.yaml was backed up before migration */
  backedUp: boolean;
}

/**
 * Config load result (config + optional migration info)
 */
export interface ConfigLoadResult {
  /** Normalized configuration */
  config: NormalizedConfig;
  /** Migration result (if any deprecated models were migrated) */
  migration?: MigrationResult;
}

/**
 * Default configuration (used when no config files exist)
 */
const DEFAULT_DOCS_TRIGGER_REGEXES = [
  'pan',
  'overdeck',
  'cloister',
  'deacon',
  'workspace',
  'specialist',
  'harness',
  'bd',
  'beads',
  'vbrief',
  'workhorse',
];

const DEFAULT_CONFIG: NormalizedConfig = {
  tmux: {
    configMode: 'managed',
  },
  enabledProviders: new Set(['anthropic']), // Only Anthropic by default
  apiKeys: {},
  providerAuth: {},
  providerPlan: {},
  providerHarnesses: {},
  openrouterFavorites: [],
  workhorses: { ...DEFAULT_WORKHORSES },
  roles: cloneRoles(DEFAULT_ROLES),
  overrides: {},
  geminiThinkingLevel: 3,
  trackerKeys: {},
  conversations: {
    compactionModel: 'claude-haiku-4-5',
    manualCompactMode: 'claude-code',
    richCompaction: true,
    titleModel: 'claude-haiku-4-5',
    watchDirs: ['~/Projects'],
    scanMaxParallel: null,
    embeddings: false,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingAutoOnDeep: true,
    enrichment: {
      quickModel: null,
      deepModel: null,
      maxParallel: 4,
      costConfirmThreshold: 1.00,
    },
  },
  docs: {
    enabled: true,
    promptInjectionEnabled: true,
    cliEnabled: true,
    trigger: {
      regexes: DEFAULT_DOCS_TRIGGER_REGEXES,
      caseSensitive: false,
    },
    corpus: {
      docs: true,
      skills: true,
      rules: true,
      claudeMd: true,
      prds: false,
      prdStatuses: ['active', 'planned'],
      maxChunkTokens: 500,
    },
    budget: {
      injectionRate: 1,
      turnWindow: 10,
      maxTokensPerInjection: 3000,
      maxChunksPerInjection: 5,
      bypassClassifierThreshold: 0.85,
    },
    embedding: {
      provider: 'local',
      model: 'gte-small',
      dimensions: 384,
    },
    classifier: {
      enabled: false,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      threshold: 0.85,
      timeoutMs: 1500,
    },
  },
  conversationSearch: {
    enabled: false,
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKeyRef: undefined,
    dbPath: join(homedir(), '.overdeck', 'conversations', 'embeddings.db'),
  },
  memory: {
    extraction: {
      fallbackChain: [],
    },
    observationsEnabled: true,
    promptTimeInjectionEnabled: true,
    rollupPendingThreshold: 4,
    sidebarRefreshIntervalMs: 10_000,
    workerConcurrency: 4,
  },
  backgroundAi: {
    // PAN-1589: off by default — background AI stays gated until the user opts in.
    cheapMode: true,
    features: defaultBackgroundAiFeatures(),
  },
  compliance: {
    mode: 'advisory',
  },
  registry: {
    classification: {
      enabled: true,
      provider: 'cliproxy',
      model: 'gpt-4.1-nano',
      perDayCostCapUsd: 1,
    },
  },
  shadow: {
    enabled: false,
    trackers: {
      linear: false,
      github: false,
      gitlab: false,
      rally: false,
    },
  },
  caveman: {
    enabled: false,
    abTest: false,
    modes: {
      work: 'full',
      review: 'review',
      test: 'full',
      merge: 'full',
    },
  },
  rtk: {
    enabled: false,
  },
  tldr: {
    // Default ON: TLDR was historically active whenever a workspace `.venv`
    // existed. The toggle lets operators turn it off (e.g. to reclaim the disk
    // the per-workspace .venv consumes — PAN-1674).
    enabled: true,
  },
  tts: {
    enabled: false,
    lifecycle: true,
    voice: '',
    volume: 1,
    rate: 1,
    maxChars: 140,
    dropInfoWhenFull: true,
    daemonPort: 8787,
    daemonHost: '127.0.0.1',
    daemonAutoStart: false,
    voiceMap: {},
    mutedSources: [],
    utteranceTemplates: {},
    mutedIssues: [],
  },
  ttsSummarizer: {
    enabled: false,
    model: 'gpt-5.4-mini',
    batchWindowSeconds: 15,
  },
  resources: {
    memoryWarnGb: 4,
    memoryBlockGb: 2,
    agentWarnCount: 8,
    agentBlockCount: 10,
  },
  experimental: {
    experimentalFeatures: false,
    claudeCodeChannels: false,
    claudeCodeChannelsMcp: false,
    streamdownRenderer: false,
    showHarnessModelPermutations: false,
  },
  claude: {
    permissionMode: 'auto',
  },
  codex: {
    permissionMode: 'auto-review',
  },
};

/**
 * Path to global config file
 */
const GLOBAL_CONFIG_PATH = join(homedir(), '.overdeck', 'config.yaml');

/**
 * Normalize a provider config (handle both boolean and object forms)
 */
function normalizeProviderConfig(
  providerConfig: ProviderConfig | boolean | undefined,
  fallbackKey?: string
): { enabled: boolean; api_key?: string; auth?: AuthMode; plan?: SubscriptionPlan; harness?: RuntimeName } {
  if (providerConfig === undefined) {
    return { enabled: false };
  }

  if (typeof providerConfig === 'boolean') {
    return { enabled: providerConfig, api_key: fallbackKey };
  }

  return {
    enabled: providerConfig.enabled,
    api_key: providerConfig.api_key || fallbackKey,
    harness: providerConfig.harness,
    auth: providerConfig.auth,
    plan: providerConfig.plan,
  };
}

function validateProviderHarness(provider: ModelProvider, harness: RuntimeName | undefined): void {
  if (harness !== undefined && harness !== 'claude-code' && harness !== 'ohmypi' && harness !== 'codex') {
    throw new Error(`config.yaml: models.providers.${provider}.harness must be claude-code, ohmypi, or codex`);
  }
}

function applyProviderHarness(result: NormalizedConfig, provider: ModelProvider, harness: RuntimeName | undefined): void {
  validateProviderHarness(provider, harness);
  if (harness !== undefined) {
    result.providerHarnesses[provider] = harness;
  }
}

/**
 * Resolve environment variables in config values.
 * If the env var is not set, returns the original reference (e.g., "$OPENAI_API_KEY")
 * so the UI can show that it's configured via env var but not resolved.
 */
function resolveEnvVar(value: string | undefined): string | undefined {
  if (!value) return undefined;

  // Replace $VAR_NAME or ${VAR_NAME} with environment variable
  // If env var is not set, keep the original reference
  return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (match, varName) => {
    const envValue = process.env[varName];
    return envValue !== undefined ? envValue : match; // Keep $VAR_NAME if not set
  });
}

/**
 * Load and parse a YAML config file
 */
function loadYamlFile(filePath: string): YamlConfig | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as YamlConfig;
    return parsed || {};
  } catch (error) {
    console.error(`Error loading YAML config from ${filePath}:`, error);
    return null;
  }
}

/**
 * Find project root by looking for .git directory
 */
function findProjectRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (true) {
    if (existsSync(join(currentDir, '.git'))) {
      return currentDir;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) return null;
    currentDir = parent;
  }
}

export function stripProjectTtsEndpoint(config: YamlConfig | null): YamlConfig | null {
  if (!config?.tts) return config;
  const { daemonHost: _daemonHost, daemonPort: _daemonPort, ...tts } = config.tts;
  return { ...config, tts };
}

/**
 * Load per-project config (.pan.yaml in project root, with fallback to .overdeck.yaml)
 */
function loadProjectConfig(): YamlConfig | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    return null;
  }

  const newConfigPath = join(projectRoot, '.pan.yaml');
  if (existsSync(newConfigPath)) {
    return stripProjectTtsEndpoint(loadYamlFile(newConfigPath));
  }

  const legacyConfigPath = join(projectRoot, '.overdeck.yaml');
  if (existsSync(legacyConfigPath)) {
    process.stderr.write(
      `[overdeck] Deprecation warning: .overdeck.yaml is deprecated. Rename it to .pan.yaml.\n`
    );
    return stripProjectTtsEndpoint(loadYamlFile(legacyConfigPath));
  }

  return null;
}

/**
 * Load global config (~/.overdeck/config.yaml)
 */
function loadGlobalConfig(): YamlConfig | null {
  return loadYamlFile(GLOBAL_CONFIG_PATH);
}

async function loadYamlFileFromDisk(filePath: string): Promise<YamlConfig | null> {
  try {
    const content = await readFileAsync(filePath, 'utf-8');
    const parsed = yaml.load(content) as YamlConfig;
    return parsed || {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    console.error(`Error loading YAML config from ${filePath}:`, error);
    return null;
  }
}

async function findProjectRootFromDisk(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = startDir;

  while (currentDir !== '/') {
    try {
      await statAsync(join(currentDir, '.git'));
      return currentDir;
    } catch { /* keep walking */ }
    currentDir = join(currentDir, '..');
  }

  return null;
}

async function loadProjectConfigFromDisk(): Promise<YamlConfig | null> {
  const projectRoot = await findProjectRootFromDisk();
  if (!projectRoot) return null;

  const newConfigPath = join(projectRoot, '.pan.yaml');
  if (await pathExistsFromDisk(newConfigPath)) return stripProjectTtsEndpoint(await loadYamlFileFromDisk(newConfigPath));

  const legacyConfigPath = join(projectRoot, '.overdeck.yaml');
  if (await pathExistsFromDisk(legacyConfigPath)) {
    process.stderr.write(
      `[overdeck] Deprecation warning: .overdeck.yaml is deprecated. Rename it to .pan.yaml.\n`
    );
    return stripProjectTtsEndpoint(await loadYamlFileFromDisk(legacyConfigPath));
  }

  return null;
}

async function loadGlobalConfigFromDisk(): Promise<YamlConfig | null> {
  return loadYamlFileFromDisk(GLOBAL_CONFIG_PATH);
}

async function pathExistsFromDisk(filePath: string): Promise<boolean> {
  try {
    await statAsync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge shadow configuration from multiple sources
 */
function mergeShadowConfig(
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
function mergeCavemanConfig(
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

function mergeRtkConfig(result: NormalizedRtkConfig, config: YamlConfig | null): void {
  const rtk = config?.agents?.rtk;
  if (!rtk) return;

  if (rtk.enabled !== undefined) {
    result.enabled = rtk.enabled;
  }
}

function mergeTldrConfig(result: NormalizedTldrConfig, config: YamlConfig | null): void {
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

function cloneDocsConfig(config: NormalizedDocsConfig): NormalizedDocsConfig {
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

function mergeDocsConfig(result: NormalizedDocsConfig, config: YamlConfig | null): void {
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

function mergeTtsConfig(result: NormalizedTtsDaemonConfig, config: YamlConfig | null): void {
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

function isWorkhorseRef(ref: ModelRef): boolean {
  return ref.startsWith('workhorse:');
}

function workhorseSlotFromRef(ref: ModelRef): WorkhorseSlot | string {
  return ref.slice('workhorse:'.length);
}

export function derefWorkhorse(
  ref: ModelRef,
  config: Pick<NormalizedConfig, 'workhorses'>,
  fieldPath = 'model',
): ModelId {
  if (ref === PARENT_MODEL_REF) {
    throw new Error(`config.yaml: ${fieldPath} cannot be ${PARENT_MODEL_REF}; ${PARENT_MODEL_REF} is a resolve-only sub-role sentinel`);
  }
  if (!isWorkhorseRef(ref)) return resolveModelIdSync(ref) as ModelId;

  const slot = workhorseSlotFromRef(ref) as WorkhorseSlot;
  const resolved = config.workhorses?.[slot];
  if (!resolved) {
    throw new Error(`config.yaml: ${fieldPath} references ${ref} but workhorses.${slot} is not defined`);
  }
  if (isWorkhorseRef(resolved)) {
    throw new Error(`config.yaml: workhorses.${slot} cannot reference another workhorse`);
  }
  return resolveModelIdSync(resolved) as ModelId;
}

export function resolveModel(
  role: Role,
  subRole?: string,
  config: Pick<NormalizedConfig, 'roles' | 'workhorses'> = {},
  spawnKey?: string,
): ModelId {
  const roleConfig = config.roles?.[role];
  const rawSubModel = subRole ? roleConfig?.sub?.[subRole]?.model : undefined;
  const subModel = rawSubModel === PARENT_MODEL_REF ? undefined : rawSubModel;
  const roleModel = roleConfig?.model;

  // Sub-role model takes precedence; never sample the parent distribution for a sub-role.
  if (subModel) {
    const fieldPath = `roles.${role}.sub.${subRole}.model`;
    return derefWorkhorse(subModel, config, fieldPath);
  }

  if (Array.isArray(roleModel)) {
    const picked = spawnKey
      ? pickWeightedModelRef(roleModel, spawnKey)
      : representativeModelRef(roleModel);
    return derefWorkhorse(picked, config, `roles.${role}.model`);
  }

  const scalarRef = roleModel ?? DEFAULT_MODEL_REFS[role];
  const fieldPath = roleModel ? `roles.${role}.model` : `defaults.${role}.model`;
  return derefWorkhorse(scalarRef, config, fieldPath);
}

/** One row of a model-origin distribution: a dereffed model with its band and chosen flag. */
export interface ModelOriginEntry {
  /** The actual model id (workhorse refs already dereffed for display). */
  model: ModelId;
  weight: number;
  lo: number;
  hi: number;
  chosen: boolean;
}

/**
 * Read-only explanation of why a weighted-role agent resolved to its model:
 * the spawn key, the FNV-1a hash, and the weight bands. Surfaced in the dashboard
 * right-click MODEL inspector (PAN-2053). `null` for scalar/single-model roles.
 */
export interface ModelOriginData {
  /** The exact spawn key whose hash selected the model (`${role}:${issueId}`). */
  spawnKey: string;
  /** The chosen model id (dereffed) — equals what determineModel produced for this key. */
  resolved: ModelId;
  /** `fnv1a32(spawnKey) / 2^32` in [0, 1). */
  hash01: number;
  /** Every distribution entry, dereffed, with its band and the chosen flag. */
  distribution: ModelOriginEntry[];
}

/**
 * Explain which model a `role` agent drew from its role's WEIGHTED distribution,
 * and why, given the EXACT `spawnKey` the agent spawned with. Returns `null` when
 * the role uses a scalar model (nothing to explain) — the caller should then just
 * show the resolved model with no bars/hash.
 *
 * Faithfulness: `spawnKey` must be the real key persisted on the agent's state at
 * spawn (`AgentState.modelSpawnKey`), not a guess — the FNV-1a hash is sensitive to
 * its exact form (e.g. issue-id casing). Read-only: never mutates anything.
 *
 * The distribution is read from the LIVE config (an operator edit since spawn is
 * reflected); the resolved model still derives from the same key, so the highlighted
 * band stays internally consistent with `resolved`.
 */
export function computeModelOrigin(
  role: Role,
  spawnKey: string,
  config: Pick<NormalizedConfig, 'roles' | 'workhorses'>,
): ModelOriginData | null {
  const roleModel = config.roles?.[role]?.model;
  if (!Array.isArray(roleModel)) return null;

  const pick = deriveWeightedPick(roleModel, spawnKey);
  const fieldPath = `roles.${role}.model`;
  const distribution: ModelOriginEntry[] = pick.bands.map((b) => ({
    model: derefWorkhorse(b.model, config, fieldPath),
    weight: b.weight,
    lo: b.lo,
    hi: b.hi,
    chosen: b.chosen,
  }));
  return {
    spawnKey,
    resolved: derefWorkhorse(pick.chosen, config, fieldPath),
    hash01: pick.hash01,
    distribution,
  };
}

function mergeRoleConfig(result: NormalizedConfig, config: YamlConfig | null): void {
  if (!config?.workhorses && !config?.roles) return;

  if (config.workhorses) {
    // PAN-1048 review feedback 003 (REQ-18): reject any workhorse key outside
    // the canonical three slots (expensive | mid | cheap). The Settings API
    // already gates this on the HTTP path; the config-load path was silently
    // accepting hand-edited config.yaml values like workhorses.tiny: claude-…
    // and propagating them into the merged registry, where derefWorkhorse()
    // would later miss because the role config only references the canonical
    // slots. Failing fast at load time gives a precise field error instead.
    const unknownSlots = Object.keys(config.workhorses).filter(
      (slot): slot is string => !(WORKHORSE_SLOTS as readonly string[]).includes(slot),
    );
    if (unknownSlots.length > 0) {
      throw new Error(
        `config.yaml: unknown workhorse slot${unknownSlots.length > 1 ? 's' : ''} ` +
          unknownSlots.map((s) => `workhorses.${s}`).join(', ') +
          `. Valid slots: ${WORKHORSE_SLOTS.join(', ')}.`,
      );
    }
    result.workhorses = {
      ...(result.workhorses ?? {}),
      ...config.workhorses,
    };
  }

  if (config.roles) {
    result.roles = { ...(result.roles ?? {}) };
    for (const [role, roleConfig] of Object.entries(config.roles) as Array<[Role, RoleConfig]>) {
      const existing = result.roles[role];
      const sub = {
        ...(existing?.sub ?? {}),
        ...(roleConfig.sub ?? {}),
      };
      const mergedRoleConfig = {
        ...existing,
        ...roleConfig,
        sub: Object.keys(sub).length > 0 ? sub : undefined,
      };
      if (
        roleConfig.maxAgents !== undefined &&
        roleConfig.minAgents === undefined &&
        mergedRoleConfig.minAgents !== undefined &&
        mergedRoleConfig.minAgents > roleConfig.maxAgents
      ) {
        mergedRoleConfig.minAgents = roleConfig.maxAgents;
      }
      result.roles[role] = mergedRoleConfig;
    }
  }
}

function validateRoleFields(role: Role, roleConfig: RoleConfig): void {
  if (Array.isArray(roleConfig.model)) {
    if (roleConfig.model.length === 0) {
      throw new Error(`config.yaml: roles.${role}.model distribution must be a non-empty array`);
    }
    for (let i = 0; i < roleConfig.model.length; i++) {
      const entry = roleConfig.model[i];
      if (!entry.model || typeof entry.model !== 'string') {
        throw new Error(`config.yaml: roles.${role}.model[${i}].model must be a non-empty string`);
      }
      if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
        throw new Error(`config.yaml: roles.${role}.model[${i}].weight must be a positive integer`);
      }
    }
  }
  if (roleConfig.harness !== undefined && roleConfig.harness !== 'claude-code' && roleConfig.harness !== 'ohmypi' && roleConfig.harness !== 'codex') {
    throw new Error(`config.yaml: roles.${role}.harness must be claude-code, ohmypi, or codex`);
  }
  if (roleConfig.effort !== undefined && !ROLE_EFFORTS.includes(roleConfig.effort)) {
    throw new Error(`config.yaml: roles.${role}.effort must be one of ${ROLE_EFFORTS.join(', ')}`);
  }
  if (roleConfig.maxAgents !== undefined && (!Number.isInteger(roleConfig.maxAgents) || roleConfig.maxAgents < 1)) {
    throw new Error(`config.yaml: roles.${role}.maxAgents must be a positive integer`);
  }
  if (roleConfig.minAgents !== undefined && (!Number.isInteger(roleConfig.minAgents) || roleConfig.minAgents < 0)) {
    throw new Error(`config.yaml: roles.${role}.minAgents must be a non-negative integer`);
  }
  if (
    roleConfig.minAgents !== undefined &&
    roleConfig.maxAgents !== undefined &&
    roleConfig.minAgents > roleConfig.maxAgents
  ) {
    throw new Error(`config.yaml: roles.${role}.minAgents (${roleConfig.minAgents}) cannot exceed maxAgents (${roleConfig.maxAgents})`);
  }
  if (roleConfig.scope !== undefined && roleConfig.scope !== 'pan-only' && roleConfig.scope !== 'all-tracked-projects') {
    throw new Error(`config.yaml: roles.${role}.scope must be pan-only or all-tracked-projects`);
  }
}

function validateRoleModelRefs(config: NormalizedConfig): void {
  for (const [slot, ref] of Object.entries(config.workhorses ?? {}) as Array<[WorkhorseSlot, ModelRef]>) {
    if (ref === PARENT_MODEL_REF) {
      throw new Error(`config.yaml: workhorses.${slot} cannot be ${PARENT_MODEL_REF}; ${PARENT_MODEL_REF} is valid only for sub-role models`);
    }
    if (isWorkhorseRef(ref)) {
      throw new Error(`config.yaml: workhorses.${slot} cannot reference another workhorse`);
    }
    resolveModelIdSync(ref);
  }

  for (const [role, roleConfig] of Object.entries(config.roles ?? {}) as Array<[Role, RoleConfig]>) {
    validateRoleFields(role, roleConfig);
    if (Array.isArray(roleConfig.model)) {
      // Validate each distribution entry's model ref is resolvable.
      for (let i = 0; i < roleConfig.model.length; i++) {
        derefWorkhorse(roleConfig.model[i].model, config, `roles.${role}.model[${i}].model`);
      }
    } else if (roleConfig.model) {
      const resolvedModel = derefWorkhorse(roleConfig.model, config, `roles.${role}.model`);
      if (roleConfig.effort !== undefined) {
        const supported = getModelEffortLevelsSync(resolvedModel);
        if (supported !== undefined && !supported.includes(roleConfig.effort)) {
          throw new Error(
            `config.yaml: roles.${role}.effort '${roleConfig.effort}' is not supported by ${resolvedModel} (supported: ${supported.join(', ')})`,
          );
        }
      }
    }
    for (const [subRole, subConfig] of Object.entries(roleConfig.sub ?? {})) {
      if (subConfig.model && subConfig.model !== PARENT_MODEL_REF) {
        derefWorkhorse(subConfig.model, config, `roles.${role}.sub.${subRole}.model`);
      }
    }
  }
}

/**
 * Merge multiple configs with precedence: project > global > defaults
 */
export function mergeConfigs(...configs: (YamlConfig | null)[]): { config: NormalizedConfig; explicitlyDisabled: Set<ModelProvider> } {
  const result: NormalizedConfig = {
    ...DEFAULT_CONFIG,
    tmux: {
      ...DEFAULT_CONFIG.tmux,
    },
    enabledProviders: new Set(DEFAULT_CONFIG.enabledProviders),
    providerHarnesses: { ...DEFAULT_CONFIG.providerHarnesses },
    workhorses: { ...DEFAULT_WORKHORSES },
    roles: cloneRoles(DEFAULT_ROLES),
    memory: {
      extraction: {
        ...DEFAULT_CONFIG.memory.extraction,
        fallbackChain: [...DEFAULT_CONFIG.memory.extraction.fallbackChain],
      },
      observationsEnabled: DEFAULT_CONFIG.memory.observationsEnabled,
      promptTimeInjectionEnabled: DEFAULT_CONFIG.memory.promptTimeInjectionEnabled,
      rollupPendingThreshold: DEFAULT_CONFIG.memory.rollupPendingThreshold,
      sidebarRefreshIntervalMs: DEFAULT_CONFIG.memory.sidebarRefreshIntervalMs,
      workerConcurrency: DEFAULT_CONFIG.memory.workerConcurrency,
    },
    backgroundAi: {
      cheapMode: DEFAULT_CONFIG.backgroundAi.cheapMode,
      features: { ...DEFAULT_CONFIG.backgroundAi.features },
    },
    compliance: {
      mode: DEFAULT_CONFIG.compliance.mode,
    },
    registry: {
      classification: { ...DEFAULT_CONFIG.registry.classification },
    },
    shadow: {
      enabled: DEFAULT_CONFIG.shadow.enabled,
      trackers: { ...DEFAULT_CONFIG.shadow.trackers },
    },
    caveman: {
      enabled: DEFAULT_CONFIG.caveman.enabled,
      abTest: DEFAULT_CONFIG.caveman.abTest,
      modes: { ...DEFAULT_CONFIG.caveman.modes },
    },
    rtk: {
      enabled: DEFAULT_CONFIG.rtk.enabled,
    },
    docs: cloneDocsConfig(DEFAULT_CONFIG.docs),
    conversationSearch: { ...DEFAULT_CONFIG.conversationSearch },
    tts: {
      enabled: DEFAULT_CONFIG.tts.enabled,
      lifecycle: DEFAULT_CONFIG.tts.lifecycle,
      voice: DEFAULT_CONFIG.tts.voice,
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
    },
    ttsSummarizer: {
      enabled: DEFAULT_CONFIG.ttsSummarizer.enabled,
      model: DEFAULT_CONFIG.ttsSummarizer.model,
      batchWindowSeconds: DEFAULT_CONFIG.ttsSummarizer.batchWindowSeconds,
    },
    resources: {
      memoryWarnGb: DEFAULT_CONFIG.resources.memoryWarnGb,
      memoryBlockGb: DEFAULT_CONFIG.resources.memoryBlockGb,
      agentWarnCount: DEFAULT_CONFIG.resources.agentWarnCount,
      agentBlockCount: DEFAULT_CONFIG.resources.agentBlockCount,
    },
    experimental: {
      experimentalFeatures: DEFAULT_CONFIG.experimental.experimentalFeatures,
      claudeCodeChannels: DEFAULT_CONFIG.experimental.claudeCodeChannels,
      claudeCodeChannelsMcp: DEFAULT_CONFIG.experimental.claudeCodeChannelsMcp,
      streamdownRenderer: DEFAULT_CONFIG.experimental.streamdownRenderer,
      showHarnessModelPermutations: DEFAULT_CONFIG.experimental.showHarnessModelPermutations,
    },
    claude: {
      permissionMode: DEFAULT_CONFIG.claude.permissionMode,
    },
    codex: {
      permissionMode: DEFAULT_CONFIG.codex.permissionMode,
    },
  };

  // Track providers explicitly disabled in models.providers so that legacy
  // api_keys and env var fallbacks don't re-enable them.
  const explicitlyDisabled = new Set<ModelProvider>();

  // Filter out null configs
  const validConfigs = configs.filter((c): c is YamlConfig => c !== null);

  // Merge in reverse order (lowest precedence first)
  for (const config of validConfigs.reverse()) {
    // Merge providers
    if (config.models?.providers) {
      const providers = config.models.providers;
      const legacyKeys = config.api_keys || {};

      // Anthropic
      const anthropic = normalizeProviderConfig(providers.anthropic, undefined);
      applyProviderHarness(result, 'anthropic', anthropic.harness);
      if (anthropic.enabled) {
        result.enabledProviders.add('anthropic');
      } else if (providers.anthropic !== undefined) {
        explicitlyDisabled.add('anthropic');
        result.enabledProviders.delete('anthropic');
      }

      // OpenAI
      const openai = normalizeProviderConfig(providers.openai, legacyKeys.openai);
      applyProviderHarness(result, 'openai', openai.harness);
      if (openai.enabled) {
        result.enabledProviders.add('openai');
        if (openai.api_key) {
          result.apiKeys.openai = resolveEnvVar(openai.api_key);
        }
        if (openai.auth) result.providerAuth.openai = openai.auth;
        if (openai.plan) result.providerPlan.openai = openai.plan;
      } else if (providers.openai !== undefined) {
        explicitlyDisabled.add('openai');
      }

      // Google
      const google = normalizeProviderConfig(providers.google, legacyKeys.google);
      applyProviderHarness(result, 'google', google.harness);
      if (google.enabled) {
        result.enabledProviders.add('google');
        if (google.api_key) {
          result.apiKeys.google = resolveEnvVar(google.api_key);
        }
        if (google.auth) result.providerAuth.google = google.auth;
        if (google.plan) result.providerPlan.google = google.plan;
      } else if (providers.google !== undefined) {
        explicitlyDisabled.add('google');
      }

      // MiniMax
      const minimax = normalizeProviderConfig(providers.minimax, legacyKeys.minimax);
      applyProviderHarness(result, 'minimax', minimax.harness);
      if (minimax.enabled) {
        result.enabledProviders.add('minimax');
        if (minimax.api_key) {
          result.apiKeys.minimax = resolveEnvVar(minimax.api_key);
        }
      } else if (providers.minimax !== undefined) {
        explicitlyDisabled.add('minimax');
      }

      // Z.AI
      const zai = normalizeProviderConfig(providers.zai, legacyKeys.zai);
      applyProviderHarness(result, 'zai', zai.harness);
      if (zai.enabled) {
        result.enabledProviders.add('zai');
        if (zai.api_key) {
          result.apiKeys.zai = resolveEnvVar(zai.api_key);
        }
      } else if (providers.zai !== undefined) {
        explicitlyDisabled.add('zai');
      }

      // Kimi
      const kimi = normalizeProviderConfig(providers.kimi, legacyKeys.kimi);
      applyProviderHarness(result, 'kimi', kimi.harness);
      if (kimi.enabled) {
        result.enabledProviders.add('kimi');
        if (kimi.api_key) {
          result.apiKeys.kimi = resolveEnvVar(kimi.api_key);
        }
      } else if (providers.kimi !== undefined) {
        explicitlyDisabled.add('kimi');
      }

      // OpenRouter
      const openrouter = normalizeProviderConfig(providers.openrouter, legacyKeys.openrouter);
      applyProviderHarness(result, 'openrouter', openrouter.harness);
      if (openrouter.enabled) {
        result.enabledProviders.add('openrouter');
        if (openrouter.api_key) {
          result.apiKeys.openrouter = resolveEnvVar(openrouter.api_key);
        }
      } else if (providers.openrouter !== undefined) {
        explicitlyDisabled.add('openrouter');
      }

      // MiMo
      const mimo = normalizeProviderConfig(providers.mimo, legacyKeys.mimo);
      applyProviderHarness(result, 'mimo', mimo.harness);
      if (mimo.enabled) {
        result.enabledProviders.add('mimo');
        if (mimo.api_key) {
          result.apiKeys.mimo = resolveEnvVar(mimo.api_key);
        }
      } else if (providers.mimo !== undefined) {
        explicitlyDisabled.add('mimo');
      }

      // Nous Portal
      const nous = normalizeProviderConfig(providers.nous, legacyKeys.nous);
      applyProviderHarness(result, 'nous', nous.harness);
      if (nous.enabled) {
        result.enabledProviders.add('nous');
        if (nous.api_key) {
          result.apiKeys.nous = resolveEnvVar(nous.api_key);
        }
      } else if (providers.nous !== undefined) {
        explicitlyDisabled.add('nous');
      }

      // Alibaba DashScope
      const dashscope = normalizeProviderConfig(providers.dashscope, legacyKeys.dashscope);
      applyProviderHarness(result, 'dashscope', dashscope.harness);
      if (dashscope.enabled) {
        result.enabledProviders.add('dashscope');
        if (dashscope.api_key) {
          result.apiKeys.dashscope = resolveEnvVar(dashscope.api_key);
        }
      } else if (providers.dashscope !== undefined) {
        explicitlyDisabled.add('dashscope');
      }
    }

    // Merge tmux configuration
    if (config.tmux?.config_mode) {
      result.tmux.configMode = config.tmux.config_mode;
    }

    // Merge conversation configuration
    if (config.conversations?.compaction_model) {
      result.conversations.compactionModel = resolveModelIdSync(config.conversations.compaction_model);
    }
    if (config.conversations?.manual_compact_mode) {
      result.conversations.manualCompactMode = config.conversations.manual_compact_mode;
    }
    if (config.conversations?.rich_compaction !== undefined) {
      result.conversations.richCompaction = config.conversations.rich_compaction;
    }
    if (config.conversations?.title_model) {
      result.conversations.titleModel = resolveModelIdSync(config.conversations.title_model);
    }
    if (config.conversations?.watch_dirs) {
      result.conversations.watchDirs = config.conversations.watch_dirs;
    }
    if (config.conversations?.scan_max_parallel !== undefined) {
      result.conversations.scanMaxParallel = config.conversations.scan_max_parallel;
    }
    if (config.conversations?.embeddings !== undefined) {
      result.conversations.embeddings = config.conversations.embeddings;
    }
    if (config.conversations?.embedding_provider) {
      result.conversations.embeddingProvider = config.conversations.embedding_provider;
      if (config.conversations.embedding_provider === 'ollama' && !config.conversations.embedding_model) {
        result.conversations.embeddingModel = 'nomic-embed-text';
      }
    }
    if (config.conversations?.embedding_model) {
      result.conversations.embeddingModel = config.conversations.embedding_model;
    }
    if (config.conversations?.embedding_auto_on_deep !== undefined) {
      result.conversations.embeddingAutoOnDeep = config.conversations.embedding_auto_on_deep;
    }
    if (config.conversations?.enrichment?.quick_model !== undefined) {
      result.conversations.enrichment.quickModel = config.conversations.enrichment.quick_model;
    }
    if (config.conversations?.enrichment?.deep_model !== undefined) {
      result.conversations.enrichment.deepModel = config.conversations.enrichment.deep_model;
    }
    if (config.conversations?.enrichment?.max_parallel !== undefined) {
      result.conversations.enrichment.maxParallel = config.conversations.enrichment.max_parallel;
    }
    if (config.conversations?.enrichment?.cost_confirm_threshold !== undefined) {
      result.conversations.enrichment.costConfirmThreshold = config.conversations.enrichment.cost_confirm_threshold;
    }

    if (config.memory) {
      if (config.memory.extraction) {
        result.memory.extraction = {
          ...result.memory.extraction,
          ...(config.memory.extraction.provider !== undefined ? { provider: config.memory.extraction.provider } : {}),
          ...(config.memory.extraction.model !== undefined ? { model: config.memory.extraction.model } : {}),
          ...(config.memory.extraction.per_day_cost_cap_usd !== undefined ? { perDayCostCapUsd: config.memory.extraction.per_day_cost_cap_usd } : {}),
          ...(config.memory.extraction.fallback_chain !== undefined ? { fallbackChain: config.memory.extraction.fallback_chain } : {}),
        };
      }
      if (config.memory.features?.observations !== undefined) {
        result.memory.observationsEnabled = config.memory.features.observations;
      }
      if (config.memory.features?.prompt_time_injection !== undefined) {
        result.memory.promptTimeInjectionEnabled = config.memory.features.prompt_time_injection;
      }
      if (config.memory.rollup_pending_threshold !== undefined) {
        result.memory.rollupPendingThreshold = config.memory.rollup_pending_threshold;
      }
      if (config.memory.sidebar_refresh_interval_ms !== undefined) {
        result.memory.sidebarRefreshIntervalMs = config.memory.sidebar_refresh_interval_ms;
      }
      if (config.memory.worker_concurrency !== undefined) {
        result.memory.workerConcurrency = config.memory.worker_concurrency;
      }
    }

    if (config.compliance?.mode !== undefined) {
      if (!isComplianceMode(config.compliance.mode)) {
        throw new Error(`config.yaml: compliance.mode must be ${COMPLIANCE_MODES.join(', ')}`);
      }
      result.compliance.mode = config.compliance.mode;
    }

    if (config.registry?.classification) {
      const classification = config.registry.classification;
      if (classification.enabled !== undefined) result.registry.classification.enabled = classification.enabled;
      if (classification.provider !== undefined) {
        if (!isFeatureRegistryClassificationProvider(classification.provider)) {
          throw new Error('config.yaml: registry.classification.provider must be anthropic or cliproxy');
        }
        result.registry.classification.provider = classification.provider;
      }
      if (classification.model !== undefined) result.registry.classification.model = classification.model;
      if (classification.per_day_cost_cap_usd !== undefined) {
        if (typeof classification.per_day_cost_cap_usd !== 'number' || classification.per_day_cost_cap_usd < 0) {
          throw new Error('config.yaml: registry.classification.per_day_cost_cap_usd must be a non-negative number');
        }
        result.registry.classification.perDayCostCapUsd = classification.per_day_cost_cap_usd;
      }
    }

    // Merge OpenRouter favorites
    if (config.openrouter?.favorites) {
      result.openrouterFavorites = config.openrouter.favorites;
    }

    // Merge role/workhorse model configuration
    mergeRoleConfig(result, config);

    // Merge legacy API keys (for backward compatibility)
    // Only enable providers that weren't explicitly disabled in models.providers
    if (config.api_keys) {
      if (config.api_keys.openai) {
        result.apiKeys.openai = resolveEnvVar(config.api_keys.openai);
        if (!explicitlyDisabled.has('openai')) {
          result.enabledProviders.add('openai');
        }
      }
      if (config.api_keys.voyage) {
        result.apiKeys.voyage = resolveEnvVar(config.api_keys.voyage);
      }
      if (config.api_keys.google) {
        result.apiKeys.google = resolveEnvVar(config.api_keys.google);
        if (!explicitlyDisabled.has('google')) {
          result.enabledProviders.add('google');
        }
      }
      if (config.api_keys.minimax) {
        result.apiKeys.minimax = resolveEnvVar(config.api_keys.minimax);
        if (!explicitlyDisabled.has('minimax')) {
          result.enabledProviders.add('minimax');
        }
      }
      if (config.api_keys.zai) {
        result.apiKeys.zai = resolveEnvVar(config.api_keys.zai);
        if (!explicitlyDisabled.has('zai')) {
          result.enabledProviders.add('zai');
        }
      }
      if (config.api_keys.kimi) {
        result.apiKeys.kimi = resolveEnvVar(config.api_keys.kimi);
        if (!explicitlyDisabled.has('kimi')) {
          result.enabledProviders.add('kimi');
        }
      }
      if (config.api_keys.openrouter) {
        result.apiKeys.openrouter = resolveEnvVar(config.api_keys.openrouter);
        if (!explicitlyDisabled.has('openrouter')) {
          result.enabledProviders.add('openrouter');
        }
      }
      if (config.api_keys.mimo) {
        result.apiKeys.mimo = resolveEnvVar(config.api_keys.mimo);
        if (!explicitlyDisabled.has('mimo')) {
          result.enabledProviders.add('mimo');
        }
      }
      if (config.api_keys.nous) {
        result.apiKeys.nous = resolveEnvVar(config.api_keys.nous);
        if (!explicitlyDisabled.has('nous')) {
          result.enabledProviders.add('nous');
        }
      }
      if (config.api_keys.dashscope) {
        result.apiKeys.dashscope = resolveEnvVar(config.api_keys.dashscope);
        if (!explicitlyDisabled.has('dashscope')) {
          result.enabledProviders.add('dashscope');
        }
      }
    }

    // Merge overrides
    if (config.models?.overrides) {
      result.overrides = {
        ...result.overrides,
        ...config.models.overrides,
      };
    }

    // Merge Gemini thinking level
    if (config.models?.gemini_thinking_level) {
      result.geminiThinkingLevel = config.models.gemini_thinking_level;
    }

    // Merge default conversation model
    if (config.models?.default_conversation_model) {
      result.defaultConversationModel = config.models.default_conversation_model;
    }

    // Merge tracker keys
    if (config.tracker_keys) {
      if (config.tracker_keys.linear) {
        result.trackerKeys.linear = resolveEnvVar(config.tracker_keys.linear);
      }
      if (config.tracker_keys.github) {
        result.trackerKeys.github = resolveEnvVar(config.tracker_keys.github);
      }
      if (config.tracker_keys.gitlab) {
        result.trackerKeys.gitlab = resolveEnvVar(config.tracker_keys.gitlab);
      }
      if (config.tracker_keys.rally) {
        result.trackerKeys.rally = resolveEnvVar(config.tracker_keys.rally);
      }
    }

    // Merge shadow configuration
    mergeShadowConfig(result.shadow, config);

    // Merge caveman configuration
    mergeCavemanConfig(result.caveman, config);

    // Merge RTK configuration
    mergeRtkConfig(result.rtk, config);

    // Merge TLDR configuration
    mergeTldrConfig(result.tldr, config);

    // Merge docs RAG configuration
    mergeDocsConfig(result.docs, config);

    // Merge TTS daemon configuration
    mergeTtsConfig(result.tts, config);

    // Merge TTS summarizer configuration
    if (config.tts?.summarizer) {
      const s = config.tts.summarizer;
      if (s.enabled !== undefined) {
        result.ttsSummarizer.enabled = s.enabled;
      }
      if (s.model) {
        result.ttsSummarizer.model = resolveModelIdSync(s.model) as ModelId;
      }
      if (s.batch_window_seconds !== undefined) {
        result.ttsSummarizer.batchWindowSeconds = s.batch_window_seconds;
      }
    }

    // Merge background AI feature toggles + low-cost master switch (PAN-1583)
    if (config.background_ai) {
      if (typeof config.background_ai.cheap_mode === 'boolean') {
        result.backgroundAi.cheapMode = config.background_ai.cheap_mode;
      }
      if (config.background_ai.features) {
        for (const feature of BACKGROUND_AI_FEATURES) {
          const value = config.background_ai.features[feature];
          if (typeof value === 'boolean') {
            result.backgroundAi.features[feature] = value;
          }
        }
      }
    }

    if (config.resources) {
      if (typeof config.resources.memory_warn_gb === 'number') {
        result.resources.memoryWarnGb = config.resources.memory_warn_gb;
      }
      if (typeof config.resources.memory_block_gb === 'number') {
        result.resources.memoryBlockGb = config.resources.memory_block_gb;
      }
      if (typeof config.resources.agent_warn_count === 'number') {
        result.resources.agentWarnCount = config.resources.agent_warn_count;
      }
      if (typeof config.resources.agent_block_count === 'number') {
        result.resources.agentBlockCount = config.resources.agent_block_count;
      }
    }

    if (config.experimental) {
      if (typeof config.experimental.experimentalFeatures === 'boolean') {
        result.experimental.experimentalFeatures = config.experimental.experimentalFeatures;
      }
      if (typeof config.experimental.claudeCodeChannels === 'boolean') {
        result.experimental.claudeCodeChannels = config.experimental.claudeCodeChannels;
      }
      if (typeof config.experimental.claudeCodeChannelsMcp === 'boolean') {
        result.experimental.claudeCodeChannelsMcp = config.experimental.claudeCodeChannelsMcp;
      }
      if (typeof config.experimental.streamdownRenderer === 'boolean') {
        result.experimental.streamdownRenderer = config.experimental.streamdownRenderer;
      }
      if (typeof config.experimental.showHarnessModelPermutations === 'boolean') {
        result.experimental.showHarnessModelPermutations = config.experimental.showHarnessModelPermutations;
      }
    }

    if (config.claude && (config.claude.permissionMode === 'auto' || config.claude.permissionMode === 'bypass')) {
      result.claude.permissionMode = config.claude.permissionMode;
    }

    if (config.codex && (config.codex.permissionMode === 'read-only' || config.codex.permissionMode === 'workspace' || config.codex.permissionMode === 'auto-review' || config.codex.permissionMode === 'full-access')) {
      result.codex.permissionMode = config.codex.permissionMode;
    }

    // Merge remote work-agent provisioning settings
    mergeRemoteConfig(result, config);

    // Merge conversationSearch configuration
    if (config.conversationSearch) {
      const cs = config.conversationSearch;
      if (typeof cs.enabled === 'boolean') {
        result.conversationSearch.enabled = cs.enabled;
      }
      if (cs.provider !== undefined) {
        result.conversationSearch.provider = cs.provider;
      }
      if (cs.model !== undefined) {
        result.conversationSearch.model = cs.model;
      }
      if (cs.apiKeyRef !== undefined) {
        result.conversationSearch.apiKeyRef = cs.apiKeyRef;
      }
      if (cs.dbPath !== undefined) {
        result.conversationSearch.dbPath = cs.dbPath;
      }
    }
  }

  validateRoleModelRefs(result);

  return { config: result, explicitlyDisabled };
}

/**
 * Detect deprecated model IDs in config overrides
 *
 * Returns array of migrations to perform, or empty array if none found.
 */
function detectDeprecatedModels(config: YamlConfig | null): Array<{
  workType: string;
  from: string;
  to: string;
}> {
  if (!config?.models?.overrides) {
    return [];
  }

  const migrations: Array<{ workType: string; from: string; to: string }> = [];

  for (const [workType, modelId] of Object.entries(config.models.overrides)) {
    if (modelId && MODEL_DEPRECATIONS[modelId]) {
      migrations.push({
        workType,
        from: modelId,
        to: MODEL_DEPRECATIONS[modelId],
      });
    }
  }

  return migrations;
}

/**
 * Apply deprecation migrations to a YamlConfig (in-place)
 */
function applyMigrations(
  config: YamlConfig,
  migrations: Array<{ workType: string; from: string; to: string }>
): void {
  if (!config.models) {
    config.models = {};
  }
  if (!config.models.overrides) {
    config.models.overrides = {};
  }

  for (const { workType, to } of migrations) {
    config.models.overrides[workType] = to as ModelId;
  }
}

/**
 * Create backup of global config file
 */
function backupGlobalConfig(): boolean {
  try {
    const backupPath = `${GLOBAL_CONFIG_PATH}.bak`;
    copyFileSync(GLOBAL_CONFIG_PATH, backupPath);
    console.log(`✓ Backed up config.yaml → config.yaml.bak`);
    return true;
  } catch (error) {
    console.error(`Failed to create config backup:`, error);
    return false;
  }
}

/**
 * Write YamlConfig back to global config file
 */
function writeGlobalConfig(config: YamlConfig): void {
  const yamlContent = yaml.dump(config, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
  });

  writeFileSync(GLOBAL_CONFIG_PATH, yamlContent, 'utf-8');
  // config.yaml contains API keys in api_keys.* — must not be world-readable.
  // writeFileSync's `mode` option is only honored on file creation, so chmod
  // explicitly to handle the case where the file already exists with looser
  // permissions (e.g. from an older install).
  chmodSync(GLOBAL_CONFIG_PATH, 0o600);
}

// ─── In-memory config cache (invalidated on file mtime change) ───────────────

interface ConfigCache {
  globalMtime: number;
  projectMtime: number;
  result: ConfigLoadResult;
}

let configCache: ConfigCache | null = null;

/**
 * Explicitly clear the in-memory config cache.
 *
 * The mtime-based cache invalidation in loadConfig() can miss rapid writes
 * (same-millisecond save → spawn) or coarse filesystem mtime resolution.
 * Call this after writing config.yaml to guarantee the next loadConfig()
 * reads from disk rather than returning stale cached data.
 */
export function clearConfigCache(): void {
  configCache = null;
}

function applyEnvironmentFallbacks(config: NormalizedConfig, explicitlyDisabled: Set<ModelProvider>): void {
  if (process.env.OPENAI_API_KEY && !config.apiKeys.openai) {
    config.apiKeys.openai = process.env.OPENAI_API_KEY;
    if (!explicitlyDisabled.has('openai')) config.enabledProviders.add('openai');
  }
  if (process.env.VOYAGE_API_KEY && !config.apiKeys.voyage) {
    config.apiKeys.voyage = process.env.VOYAGE_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY && !config.apiKeys.google) {
    config.apiKeys.google = process.env.GOOGLE_API_KEY;
    if (!explicitlyDisabled.has('google')) config.enabledProviders.add('google');
  }
  if (process.env.MINIMAX_API_KEY && !config.apiKeys.minimax) {
    config.apiKeys.minimax = process.env.MINIMAX_API_KEY;
    if (!explicitlyDisabled.has('minimax')) config.enabledProviders.add('minimax');
  }
  if (process.env.ZAI_API_KEY && !config.apiKeys.zai) {
    config.apiKeys.zai = process.env.ZAI_API_KEY;
    if (!explicitlyDisabled.has('zai')) config.enabledProviders.add('zai');
  }
  const kimiKey = process.env.KIMI_CODING_API_KEY || process.env.KIMI_API_KEY;
  if (kimiKey && !config.apiKeys.kimi) {
    config.apiKeys.kimi = kimiKey;
    if (!explicitlyDisabled.has('kimi')) config.enabledProviders.add('kimi');
  }
  if (process.env.OPENROUTER_API_KEY && !config.apiKeys.openrouter) {
    config.apiKeys.openrouter = process.env.OPENROUTER_API_KEY;
    if (!explicitlyDisabled.has('openrouter')) config.enabledProviders.add('openrouter');
  }
  if (process.env.MIMO_API_KEY && !config.apiKeys.mimo) {
    config.apiKeys.mimo = process.env.MIMO_API_KEY;
    if (!explicitlyDisabled.has('mimo')) config.enabledProviders.add('mimo');
  }
  if (process.env.NOUS_API_KEY && !config.apiKeys.nous) {
    config.apiKeys.nous = process.env.NOUS_API_KEY;
    if (!explicitlyDisabled.has('nous')) config.enabledProviders.add('nous');
  }
  if (process.env.DASHSCOPE_API_KEY && !config.apiKeys.dashscope) {
    config.apiKeys.dashscope = process.env.DASHSCOPE_API_KEY;
    if (!explicitlyDisabled.has('dashscope')) config.enabledProviders.add('dashscope');
  }
  if (process.env.LINEAR_API_KEY && !config.trackerKeys.linear) config.trackerKeys.linear = process.env.LINEAR_API_KEY;
  if (process.env.GITHUB_TOKEN && !config.trackerKeys.github) config.trackerKeys.github = process.env.GITHUB_TOKEN;
  if (process.env.GITLAB_TOKEN && !config.trackerKeys.gitlab) config.trackerKeys.gitlab = process.env.GITLAB_TOKEN;
  if (process.env.RALLY_API_KEY && !config.trackerKeys.rally) config.trackerKeys.rally = process.env.RALLY_API_KEY;
  if (process.env.SHADOW_MODE !== undefined) {
    config.shadow.enabled = ['true', '1', 'yes'].includes(process.env.SHADOW_MODE.toLowerCase());
  }
}

function getConfigMtimes(): { global: number; project: number } {
  let globalMtime = 0;
  let projectMtime = 0;

  try {
    if (existsSync(GLOBAL_CONFIG_PATH)) {
      globalMtime = statSync(GLOBAL_CONFIG_PATH).mtimeMs;
    }
  } catch { /* file may race */ }

  const projectRoot = findProjectRoot();
  if (projectRoot) {
    for (const name of ['.pan.yaml', '.overdeck.yaml']) {
      const path = join(projectRoot, name);
      try {
        if (existsSync(path)) {
          projectMtime = statSync(path).mtimeMs;
          break;
        }
      } catch { /* file may race */ }
    }
  }

  return { global: globalMtime, project: projectMtime };
}

async function getConfigMtimesFromDisk(): Promise<{ global: number; project: number }> {
  const globalMtime = await getMtimeFromDisk(GLOBAL_CONFIG_PATH);
  let projectMtime = 0;

  const projectRoot = await findProjectRootFromDisk();
  if (projectRoot) {
    for (const name of ['.pan.yaml', '.overdeck.yaml']) {
      projectMtime = await getMtimeFromDisk(join(projectRoot, name));
      if (projectMtime > 0) break;
    }
  }

  return { global: globalMtime, project: projectMtime };
}

async function getMtimeFromDisk(filePath: string): Promise<number> {
  try {
    return (await statAsync(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function loadConfigWithoutMigration(): Promise<ConfigLoadResult> {
  const mtimes = await getConfigMtimesFromDisk();
  if (
    configCache &&
    configCache.globalMtime === mtimes.global &&
    configCache.projectMtime === mtimes.project
  ) {
    return configCache.result;
  }

  const [globalConfig, projectConfig] = await Promise.all([
    loadGlobalConfigFromDisk(),
    loadProjectConfigFromDisk(),
  ]);
  const { config, explicitlyDisabled } = mergeConfigs(projectConfig, globalConfig);
  applyEnvironmentFallbacks(config, explicitlyDisabled);

  const result: ConfigLoadResult = { config };
  const freshMtimes = await getConfigMtimesFromDisk();
  configCache = {
    globalMtime: freshMtimes.global,
    projectMtime: freshMtimes.project,
    result,
  };
  return result;
}

/**
 * Load complete configuration (global + project + defaults)
 * Also loads API keys from environment variables as fallback
 *
 * IMPORTANT: This function may modify config.yaml if deprecated model IDs
 * are detected. A backup is created before any modifications.
 *
 * Results are cached in memory and invalidated when the underlying config
 * files change (checked via mtime).
 */
export function loadConfigSync(): ConfigLoadResult {
  const mtimes = getConfigMtimes();
  if (
    configCache &&
    configCache.globalMtime === mtimes.global &&
    configCache.projectMtime === mtimes.project
  ) {
    return configCache.result;
  }

  let globalConfig = loadGlobalConfig();
  const projectConfig = loadProjectConfig();

  // Check for deprecated models in global config
  let migrationResult: MigrationResult | undefined;
  if (globalConfig && hasGlobalConfig()) {
    const migrations = detectDeprecatedModels(globalConfig);

    if (migrations.length > 0) {
      const backedUp = backupGlobalConfig();

      applyMigrations(globalConfig, migrations);
      writeGlobalConfig(globalConfig);

      if (migrations.length > 0) {
        console.log('\n🔄 Model ID Migration:');
        for (const { workType, from, to } of migrations) {
          console.log(`  ${workType}: ${from} → ${to}`);
        }
      }
      console.log('');

      migrationResult = { migrated: migrations, backedUp };
    }
  }

  const { config, explicitlyDisabled } = mergeConfigs(projectConfig, globalConfig);

  applyEnvironmentFallbacks(config, explicitlyDisabled);

  const result: ConfigLoadResult = { config, migration: migrationResult };

  // Update cache with fresh mtimes (migration may have written global config)
  const freshMtimes = getConfigMtimes();
  configCache = {
    globalMtime: freshMtimes.global,
    projectMtime: freshMtimes.project,
    result,
  };

  return result;
}

/**
 * Check if a project-level config exists (.pan.yaml or .overdeck.yaml)
 */
export function hasProjectConfig(): boolean {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return false;
  return existsSync(join(projectRoot, '.pan.yaml')) || existsSync(join(projectRoot, '.overdeck.yaml'));
}

/**
 * Check if global config exists
 */
export function hasGlobalConfig(): boolean {
  return existsSync(GLOBAL_CONFIG_PATH);
}

/**
 * Get path to global config file
 */
export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}

/**
 * Get path to project config file (null if not in a project).
 * Returns .pan.yaml if it exists, falls back to .overdeck.yaml, otherwise returns .pan.yaml as default.
 */
export function getProjectConfigPath(): string | null {
  const projectRoot = findProjectRoot();
  if (!projectRoot) return null;
  if (existsSync(join(projectRoot, '.pan.yaml'))) {
    return join(projectRoot, '.pan.yaml');
  }
  if (existsSync(join(projectRoot, '.overdeck.yaml'))) {
    return join(projectRoot, '.overdeck.yaml');
  }
  return join(projectRoot, '.pan.yaml');
}

/**
 * Returns whether the experimental Claude Code Channels prompt-delivery flag
 * is enabled. Resolves via loadConfig() so the value reflects merged global,
 * project, and env-var sources at the moment of the call.
 */
export function isClaudeCodeChannelsEnabled(): boolean {
  return loadConfigSync().config.experimental.claudeCodeChannels;
}

export function isClaudeCodeChannelsMcpEnabled(): boolean {
  return loadConfigSync().config.experimental.claudeCodeChannelsMcp;
}

/**
 * Whether TLDR (token-efficient code analysis) is enabled. Gates whether agents
 * advertise/use the TLDR MCP tools and whether the per-workspace TLDR daemon is
 * started at spawn. Read at session launch — a change only affects sessions
 * launched/resumed after it. Defaults to true when unset.
 */
export function isTldrEnabledSync(): boolean {
  try {
    return loadConfigSync().config.tldr.enabled;
  } catch {
    return DEFAULT_CONFIG.tldr.enabled;
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native loadConfigWithoutMigration. Reads global + project config,
 * merges with defaults, applies env fallbacks. Fails with ConfigParseError
 * for malformed YAML or ConfigError for other I/O failures.
 */
export const loadConfigNoMigration = (): Effect.Effect<
  ConfigLoadResult,
  ConfigError | ConfigParseError
> =>
  Effect.tryPromise({
    try: () => loadConfigWithoutMigration(),
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const getConversationsConfig = (): Effect.Effect<
  RuntimeConversationsConfig,
  ConfigError | ConfigParseError
> =>
  Effect.gen(function* () {
    const { config } = yield* loadConfigNoMigration();
    return resolveConversationWatchDirs({
      ...config.conversations,
      apiKeys: config.apiKeys,
      enabledProviders: config.enabledProviders,
    });
  });

/**
 * Effect-native loadConfig — sync read, wraps any failure (parse / fs) as
 * ConfigError. Use this from Effect contexts that need merged config without
 * forcing the codebase to migrate every loadConfig call site.
 */
export const loadConfig = (): Effect.Effect<ConfigLoadResult, ConfigError> =>
  Effect.try({
    try: () => loadConfigSync(),
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/**
 * Effect-native updateConversationsConfig. Persists the supplied
 * ConversationsConfig overrides into config.yaml. Fails with ConfigError on
 * write failure.
 */
export const updateConversationsConfig = (
  updates: ConversationsConfig,
): Effect.Effect<void, ConfigError | ConfigParseError> =>
  Effect.tryPromise({
    try: async () => {
      await loadConfigWithoutMigration();
      let existingContent = '{}\n';
      try {
        const content = await readFileAsync(GLOBAL_CONFIG_PATH, 'utf-8');
        existingContent = content.trim().length > 0 ? content : '{}\n';
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw error;
      }

      const doc = parseDocument(existingContent);
      if (doc.contents === null) {
        doc.contents = parseDocument('{}\n').contents;
      }

      for (const [key, value] of Object.entries(updates) as Array<[keyof ConversationsConfig, unknown]>) {
        if (value !== undefined) doc.setIn(['conversations', key], value);
      }

      await mkdirAsync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
      await writeFileAsync(GLOBAL_CONFIG_PATH, doc.toString({ lineWidth: 120 }), 'utf-8');
      // config.yaml contains API keys in api_keys.* — must not be world-readable.
      // writeFile's `mode` option is only honored on file creation, so chmod
      // explicitly to handle the case where the file already exists with looser
      // permissions (e.g. from an older install).
      await chmodAsync(GLOBAL_CONFIG_PATH, 0o600);
      clearConfigCache();
    },
    catch: (cause) =>
      new ConfigError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
