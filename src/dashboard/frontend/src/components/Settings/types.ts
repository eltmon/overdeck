// Settings data types matching the new config.yaml structure
// Now uses smart (capability-based) model selection instead of static presets

export type Provider = 'anthropic' | 'openai' | 'google' | 'zai' | 'kimi' | 'minimax' | 'mimo' | 'openrouter' | 'nous' | 'dashscope';

export type ModelId = string;
export type Harness = 'claude-code' | 'ohmypi' | 'codex';
export type HarnessOverride = Harness | '';

export interface ProvidersConfig {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
  zai: boolean;
  kimi: boolean;
  minimax: boolean;
  mimo: boolean;
  openrouter: boolean;
  nous: boolean;
  dashscope: boolean;
}

export type WorkhorseSlot = 'expensive' | 'mid' | 'cheap';
export type RoleId = 'plan' | 'work' | 'review' | 'test' | 'ship';
export type ModelRef = string;

export interface RoleSubConfig {
  model?: ModelRef;
}

export interface RoleConfig {
  model?: ModelRef;
  sub?: Record<string, RoleSubConfig>;
}

export type WorkhorsesConfig = Partial<Record<WorkhorseSlot, ModelRef>>;
export type RolesConfig = Partial<Record<RoleId, RoleConfig>>;

export interface ModelsConfig {
  providers: ProvidersConfig;
  /** Legacy model-route overrides are accepted only to preserve form round-trips. */
  overrides: Partial<Record<string, ModelId>>;
  provider_harnesses?: Partial<Record<Provider, HarnessOverride>>;
  provider_default_harnesses?: Record<Provider, Harness>;
  gemini_thinking_level?: number; // 1-4 (Minimal, Low, Medium, High)
  default_conversation_model?: ModelId;
}

export interface ApiKeysConfig {
  openai?: string;
  google?: string;
  zai?: string;
  kimi?: string;
  minimax?: string;
  mimo?: string;
  openrouter?: string;
  nous?: string;
  dashscope?: string;
}

export interface TrackerKeysConfig {
  linear?: string;
  github?: string;
  gitlab?: string;
  rally?: string;
}

export interface DeprecationWarning {
  workType: string;
  from: string;
  to: string;
}

export interface TtsConfig {
  enabled?: boolean;
  voice?: string;
  statusVoice?: string;
  volume?: number;
  rate?: number;
  maxChars?: number;
  dropInfoWhenFull?: boolean;
  voiceMap?: Record<string, string>;
  mutedSources?: string[];
  utteranceTemplates?: Record<string, string>;
  mutedIssues?: string[];
}

export interface VoiceSettings {
  stt: {
    provider: 'moonshine' | 'google-cloud';
    moonshine: { model: string };
    googleCloud: { apiKey: string; model: string };
  };
  autopreso: {
    provider: 'openai' | 'codex' | 'ollama';
    model: string;
  };
}

export interface MemorySettingsConfig {
  provider?: 'anthropic' | 'cliproxy';
  model?: string;
  per_day_cost_cap_usd?: number;
  fallback_provider?: 'anthropic' | 'cliproxy' | '';
  fallback_model?: string;
  fallback_chain?: Array<{ provider: 'anthropic' | 'cliproxy'; model: string }>;
  observations_enabled?: boolean;
  prompt_time_injection_enabled?: boolean;
  rollup_pending_threshold?: number;
  sidebar_refresh_interval_ms?: number;
  worker_concurrency?: number;
}

/** Background AI feature keys (mirrors src/lib/background-ai/registry.ts). */
export type BackgroundAiFeature =
  | 'conversationTitles'
  | 'titleRefinement'
  | 'memoryExtraction'
  | 'memoryQueryExpansion'
  | 'conversationEnrichment'
  | 'sessionEmbeddings'
  | 'summaryFork'
  | 'ttsSummarizer';

export interface BackgroundAiConfig {
  cheap_mode?: boolean;
  features?: Partial<Record<BackgroundAiFeature, boolean>>;
}

/** UI metadata for each background AI feature toggle. */
export const BACKGROUND_AI_FEATURE_META: ReadonlyArray<{
  key: BackgroundAiFeature;
  label: string;
  description: string;
}> = [
  { key: 'conversationTitles', label: 'Conversation titles', description: 'Generate a title for a new conversation from its first message.' },
  { key: 'titleRefinement', label: 'Title refinement', description: 'Refine a conversation title once the first assistant reply arrives.' },
  { key: 'memoryExtraction', label: 'Memory extraction', description: 'Extract structured observations from running agent transcripts.' },
  { key: 'memoryQueryExpansion', label: 'Memory query expansion', description: 'Expand memory search queries into related terms for better recall.' },
  { key: 'conversationEnrichment', label: 'Conversation enrichment', description: 'Summarize and tag discovered sessions for search and display.' },
  { key: 'sessionEmbeddings', label: 'Session embeddings', description: 'Build embedding vectors for semantic conversation search.' },
  { key: 'summaryFork', label: 'Summary fork / compaction', description: 'Summarize a transcript on compaction or handoff fallback.' },
  { key: 'ttsSummarizer', label: 'TTS activity narration', description: 'Summarize recent activity into spoken narration utterances.' },
];

export interface ConversationSearchConfig {
  enabled?: boolean;
  provider?: 'openai';
  model?: string;
  apiKeyRef?: string;
  dbPath?: string;
}

export interface SettingsConfig {
  workhorses?: WorkhorsesConfig;
  roles?: RolesConfig;
  models: ModelsConfig;
  api_keys: ApiKeysConfig;
  agents?: {
    rtk?: {
      enabled?: boolean;
    };
    tldr?: {
      enabled?: boolean;
    };
  };
  memory?: MemorySettingsConfig;
  background_ai?: BackgroundAiConfig;
  tts_summarizer?: {
    model?: ModelId;
    enabled?: boolean;
  };
  openrouter?: {
    favorites?: string[];
  };
  tracker_keys?: TrackerKeysConfig;
  conversationSearch?: ConversationSearchConfig;
  tts?: TtsConfig;
  deprecation_warnings?: DeprecationWarning[];
  tmux?: {
    config_mode?: 'managed' | 'inherit-user';
  };
  conversations?: {
    compaction_model?: ModelId;
    manual_compact_mode?: 'claude-code' | 'overdeck-native';
    rich_compaction?: boolean;
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
  };
  experimental?: {
    /** Show experimental dashboard surfaces in navigation and direct routes. */
    experimentalFeatures?: boolean;
    /** Use Claude Code Channels delivery for conversations/messages. */
    claudeCodeChannels?: boolean;
    /** Enable legacy Claude Code Channels MCP wiring for new eligible work agents. */
    claudeCodeChannelsMcp?: boolean;
    /** Render dashboard chat markdown with Streamdown instead of ReactMarkdown. */
    streamdownRenderer?: boolean;
    /** Show explicit harness/model permutations in dashboard model pickers. */
    showHarnessModelPermutations?: boolean;
  };
  /**
   * Permission mode for spawned Claude Code agents.
   *
   * 'auto' (default) — Claude Code's classifier blocks destructive ops while running autonomously
   * 'bypass'         — pass --dangerously-skip-permissions (legacy behavior)
   */
  claude?: {
    permissionMode?: 'auto' | 'bypass';
  };
  /**
   * Permission mode for Codex TUI conversation sessions.
   *
   * 'read-only'   — asks before any write or command (approval_policy=on-request + sandbox=read-only)
   * 'workspace'   — works freely inside cwd, asks before going outside (default)
   * 'auto-review' — a sub-agent auto-reviews approval requests (approval_policy=on-request + approvals_reviewer=auto_review)
   * 'full-access' — no prompts, full filesystem + network access
   */
  codex?: {
    permissionMode?: 'read-only' | 'workspace' | 'auto-review' | 'full-access';
  };
  remote?: {
    resiliency_tier?: 'ephemeral' | 'durable';
    max_concurrent_agents?: number;
  };
}
