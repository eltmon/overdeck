// Settings data types matching the new config.yaml structure
// Now uses smart (capability-based) model selection instead of static presets

export type Provider = 'anthropic' | 'openai' | 'google' | 'minimax' | 'zai' | 'kimi' | 'openrouter';

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
  // Convoy members
  | 'convoy:security-reviewer'
  | 'convoy:performance-reviewer'
  | 'convoy:correctness-reviewer'
  | 'convoy:requirements-reviewer'
  | 'convoy:synthesis-agent'
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
  minimax: boolean;
  zai: boolean;
  kimi: boolean;
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
  minimax?: string;
  zai?: string;
  kimi?: string;
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
  tmux?: {
    config_mode?: 'managed' | 'inherit-user';
  };
  conversations?: {
    compaction_model?: ModelId;
    manual_compact_mode?: 'claude-code' | 'panopticon-native';
  };
  tracker_keys?: TrackerKeysConfig;
  deprecation_warnings?: DeprecationWarning[];
}

export interface AvailableModels {
  anthropic: string[];
  openai: string[];
  google: string[];
  minimax: string[];
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
  | 'convoy'
  | 'subagent'
  | 'pre-work'
  | 'workflow'
  | 'cli';

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
  'convoy': [
    { id: 'convoy:security-reviewer', category: 'convoy', displayName: 'Security Reviewer' },
    { id: 'convoy:performance-reviewer', category: 'convoy', displayName: 'Performance Reviewer' },
    { id: 'convoy:correctness-reviewer', category: 'convoy', displayName: 'Correctness Reviewer' },
    { id: 'convoy:requirements-reviewer', category: 'convoy', displayName: 'Requirements Reviewer' },
    { id: 'convoy:synthesis-agent', category: 'convoy', displayName: 'Synthesis Agent' },
  ],
  'subagent': [
    { id: 'subagent:explore', category: 'subagent', displayName: 'Explore' },
    { id: 'subagent:plan', category: 'subagent', displayName: 'Plan' },
    { id: 'subagent:bash', category: 'subagent', displayName: 'Bash' },
    { id: 'subagent:general-purpose', category: 'subagent', displayName: 'General Purpose' },
  ],
  'pre-work': [
    { id: 'planning-agent', category: 'pre-work', displayName: 'Planning Agent' },
  ],
  'workflow': [
    { id: 'status-review', category: 'workflow', displayName: 'Status Review' },
  ],
  'cli': [
    { id: 'cli:interactive', category: 'cli', displayName: 'Interactive' },
    { id: 'cli:quick-command', category: 'cli', displayName: 'Quick Command' },
  ],
};

