// Settings data types matching the new config.yaml structure
// Now uses smart (capability-based) model selection instead of static presets

export type Provider = 'anthropic' | 'openai' | 'google' | 'zai' | 'kimi' | 'minimax' | 'openrouter';

export type WorkTypeId =
  // Issue agent phases
  | 'issue-agent:exploration'
  | 'issue-agent:implementation'
  | 'issue-agent:testing'
  | 'issue-agent:documentation'
  | 'issue-agent:review-response'
  // Specialist agents
  | 'specialist-review-agent'
  | 'specialist-test-agent'
  | 'specialist-merge-agent'
  | 'specialist-inspect-agent'
  | 'specialist-uat-agent'
  // Subagents
  | 'subagent:explore'
  | 'subagent:plan'
  | 'subagent:bash'
  | 'subagent:general-purpose'
  // Review agents
  | 'review:security'
  | 'review:performance'
  | 'review:correctness'
  | 'review:requirements'
  | 'review:synthesis'
  // Planning
  | 'planning-agent'
  // Workflow
  | 'status-review'
  // CLI contexts
  | 'cli:interactive'
  | 'cli:quick-command';

export type ModelId = string;

export interface ProvidersConfig {
  anthropic: boolean; // Always true (required)
  openai: boolean;
  google: boolean;
  zai: boolean;
  kimi: boolean;
  minimax: boolean;
  openrouter: boolean;
}

export interface ModelsConfig {
  providers: ProvidersConfig;
  overrides: Partial<Record<WorkTypeId, ModelId>>;
  gemini_thinking_level?: number; // 1-4 (Minimal, Low, Medium, High)
  default_conversation_model?: ModelId;
}

export interface ApiKeysConfig {
  openai?: string;
  google?: string;
  zai?: string;
  kimi?: string;
  minimax?: string;
  openrouter?: string;
}

export interface TrackerKeysConfig {
  linear?: string;
  github?: string;
  gitlab?: string;
  rally?: string;
}

export interface DeprecationWarning {
  workType: WorkTypeId;
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
  };
}

export interface AvailableModels {
  anthropic: string[];
  openai: string[];
  google: string[];
  zai: string[];
  kimi: string[];
}

export interface WorkTypeInfo {
  id: WorkTypeId;
  category: WorkTypeCategory;
  displayName: string;
  description?: string;
}

export type WorkTypeCategory =
  | 'issue-agent'
  | 'specialist'
  | 'review'
  | 'subagent'
  | 'cli'
  | 'pre-work'
  | 'workflow';

export const WORK_TYPE_CATEGORIES: Record<WorkTypeCategory, WorkTypeInfo[]> = {
  'issue-agent': [
    { id: 'issue-agent:exploration', category: 'issue-agent', displayName: 'Exploration' },
    { id: 'issue-agent:implementation', category: 'issue-agent', displayName: 'Implementation' },
    { id: 'issue-agent:testing', category: 'issue-agent', displayName: 'Testing' },
    { id: 'issue-agent:documentation', category: 'issue-agent', displayName: 'Documentation' },
    { id: 'issue-agent:review-response', category: 'issue-agent', displayName: 'Review Response' },
  ],
  'specialist': [
    { id: 'specialist-review-agent', category: 'specialist', displayName: 'Review Agent' },
    { id: 'specialist-test-agent', category: 'specialist', displayName: 'Test Agent' },
    { id: 'specialist-merge-agent', category: 'specialist', displayName: 'Merge Agent' },
    { id: 'specialist-inspect-agent', category: 'specialist', displayName: 'Inspect Agent' },
    { id: 'specialist-uat-agent', category: 'specialist', displayName: 'UAT Agent' },
  ],
  'review': [
    { id: 'review:security', category: 'review', displayName: 'Security Reviewer' },
    { id: 'review:performance', category: 'review', displayName: 'Performance Reviewer' },
    { id: 'review:correctness', category: 'review', displayName: 'Correctness Reviewer' },
    { id: 'review:requirements', category: 'review', displayName: 'Requirements Reviewer' },
    { id: 'review:synthesis', category: 'review', displayName: 'Synthesis Agent' },
  ],
  'subagent': [
    { id: 'subagent:explore', category: 'subagent', displayName: 'Explore' },
    { id: 'subagent:plan', category: 'subagent', displayName: 'Plan' },
    { id: 'subagent:bash', category: 'subagent', displayName: 'Bash' },
    { id: 'subagent:general-purpose', category: 'subagent', displayName: 'General Purpose' },
  ],
  'cli': [
    { id: 'cli:interactive', category: 'cli', displayName: 'Interactive' },
    { id: 'cli:quick-command', category: 'cli', displayName: 'Quick Command' },
  ],
  'pre-work': [
    { id: 'planning-agent', category: 'pre-work', displayName: 'Planning Agent' },
  ],
  'workflow': [
    { id: 'status-review', category: 'workflow', displayName: 'Status Review' },
  ],
};

