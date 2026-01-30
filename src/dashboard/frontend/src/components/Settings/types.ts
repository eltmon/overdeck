// Settings data types matching the new config.yaml structure
// Now uses smart (capability-based) model selection instead of static presets

export type Provider = 'anthropic' | 'openai' | 'google' | 'zai' | 'kimi';

export type WorkTypeId =
  // Issue agent phases
  | 'issue-agent:exploration'
  | 'issue-agent:planning'
  | 'issue-agent:implementation'
  | 'issue-agent:testing'
  | 'issue-agent:documentation'
  | 'issue-agent:review-response'
  // Specialist agents
  | 'specialist-review-agent'
  | 'specialist-test-agent'
  | 'specialist-merge-agent'
  // Subagents
  | 'subagent:explore'
  | 'subagent:plan'
  | 'subagent:bash'
  | 'subagent:general-purpose'
  // Convoy members
  | 'convoy:security-reviewer'
  | 'convoy:performance-reviewer'
  | 'convoy:correctness-reviewer'
  | 'convoy:synthesis-agent'
  // Pre-work agents
  | 'prd-agent'
  | 'decomposition-agent'
  | 'triage-agent'
  | 'planning-agent'
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
}

export interface ModelsConfig {
  providers: ProvidersConfig;
  overrides: Partial<Record<WorkTypeId, ModelId>>;
  gemini_thinking_level?: number; // 1-4 (Minimal, Low, Medium, High)
}

export interface ApiKeysConfig {
  openai?: string;
  google?: string;
  zai?: string;
  kimi?: string;
}

export interface SettingsConfig {
  models: ModelsConfig;
  api_keys: ApiKeysConfig;
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
  | 'convoy'
  | 'subagent'
  | 'pre-work'
  | 'cli';

export const WORK_TYPE_CATEGORIES: Record<WorkTypeCategory, WorkTypeInfo[]> = {
  'issue-agent': [
    { id: 'issue-agent:exploration', category: 'issue-agent', displayName: 'Exploration' },
    { id: 'issue-agent:planning', category: 'issue-agent', displayName: 'Planning' },
    { id: 'issue-agent:implementation', category: 'issue-agent', displayName: 'Implementation' },
    { id: 'issue-agent:testing', category: 'issue-agent', displayName: 'Testing' },
    { id: 'issue-agent:documentation', category: 'issue-agent', displayName: 'Documentation' },
    { id: 'issue-agent:review-response', category: 'issue-agent', displayName: 'Review Response' },
  ],
  'specialist': [
    { id: 'specialist-review-agent', category: 'specialist', displayName: 'Review Agent' },
    { id: 'specialist-test-agent', category: 'specialist', displayName: 'Test Agent' },
    { id: 'specialist-merge-agent', category: 'specialist', displayName: 'Merge Agent' },
  ],
  'convoy': [
    { id: 'convoy:security-reviewer', category: 'convoy', displayName: 'Security Reviewer' },
    { id: 'convoy:performance-reviewer', category: 'convoy', displayName: 'Performance Reviewer' },
    { id: 'convoy:correctness-reviewer', category: 'convoy', displayName: 'Correctness Reviewer' },
    { id: 'convoy:synthesis-agent', category: 'convoy', displayName: 'Synthesis Agent' },
  ],
  'subagent': [
    { id: 'subagent:explore', category: 'subagent', displayName: 'Explore' },
    { id: 'subagent:plan', category: 'subagent', displayName: 'Plan' },
    { id: 'subagent:bash', category: 'subagent', displayName: 'Bash' },
    { id: 'subagent:general-purpose', category: 'subagent', displayName: 'General Purpose' },
  ],
  'pre-work': [
    { id: 'prd-agent', category: 'pre-work', displayName: 'PRD Agent' },
    { id: 'decomposition-agent', category: 'pre-work', displayName: 'Decomposition Agent' },
    { id: 'triage-agent', category: 'pre-work', displayName: 'Triage Agent' },
    { id: 'planning-agent', category: 'pre-work', displayName: 'Planning Agent' },
  ],
  'cli': [
    { id: 'cli:interactive', category: 'cli', displayName: 'Interactive' },
    { id: 'cli:quick-command', category: 'cli', displayName: 'Quick Command' },
  ],
};

