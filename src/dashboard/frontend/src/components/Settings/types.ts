// Settings data types matching the new config.yaml structure
// Now uses smart (capability-based) model selection instead of static presets

export type Provider = 'anthropic' | 'openai' | 'google' | 'zai' | 'kimi' | 'minimax' | 'mimo' | 'openrouter';

export type ModelId = string;

export interface ProvidersConfig {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
  zai: boolean;
  kimi: boolean;
  minimax: boolean;
  mimo: boolean;
  openrouter: boolean;
}

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

export interface SettingsConfig {
  models: ModelsConfig;
  api_keys: ApiKeysConfig;
  openrouter?: {
    favorites?: string[];
  };
  tracker_keys?: TrackerKeysConfig;
  deprecation_warnings?: DeprecationWarning[];
  tmux?: {
    config_mode?: 'managed' | 'inherit-user';
  };
  conversations?: {
    compaction_model?: ModelId;
    manual_compact_mode?: 'claude-code' | 'panopticon-native';
    rich_compaction?: boolean;
    title_model?: ModelId;
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

