// Settings data types matching the new config.yaml structure
// Now uses smart (capability-based) model selection instead of static presets

export type Provider = 'anthropic' | 'openai' | 'google' | 'zai' | 'kimi' | 'minimax' | 'mimo' | 'openrouter' | 'nous';

export type ModelId = string;
export type Harness = 'claude-code' | 'pi';

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

export interface SettingsConfig {
  workhorses?: WorkhorsesConfig;
  roles?: RolesConfig;
  models: ModelsConfig;
  api_keys: ApiKeysConfig;
  openrouter?: {
    favorites?: string[];
  };
  tracker_keys?: TrackerKeysConfig;
  tts?: TtsConfig;
  deprecation_warnings?: DeprecationWarning[];
  tmux?: {
    config_mode?: 'managed' | 'inherit-user';
  };
  conversations?: {
    compaction_model?: ModelId;
    manual_compact_mode?: 'claude-code' | 'panopticon-native';
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
    /** Use Claude Code Channels (research-preview) for prompt delivery to eligible work agents. */
    claudeCodeChannels?: boolean;
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
}

