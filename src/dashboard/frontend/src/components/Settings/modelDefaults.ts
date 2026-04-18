import { ModelId, WorkTypeId } from './types';

export const FALLBACK_DEFAULT_MODEL: ModelId = 'gpt-5.4-mini';

export const DEFAULT_MODELS_BY_WORK_TYPE: Partial<Record<WorkTypeId, ModelId>> = {
  // Planning & high-stakes review — GPT-5.4 (best non-Anthropic reasoning)
  'planning-agent': 'gpt-5.4',
  'specialist-review-agent': 'gpt-5.4',
  'convoy:security-reviewer': 'gpt-5.4',

  // Exploration & mid-complexity — Kimi K2.6
  'issue-agent:exploration': 'K2.6-code-preview',
  'issue-agent:testing': 'K2.6-code-preview',
  'issue-agent:documentation': 'K2.6-code-preview',
  'convoy:requirements-reviewer': 'K2.6-code-preview',
  'convoy:performance-reviewer': 'K2.6-code-preview',
  'specialist-uat-agent': 'K2.6-code-preview',
  'subagent:general-purpose': 'K2.6-code-preview',

  // Heavy implementation & agentic coding — GLM-5.1 (SWE-Bench Pro #1)
  'issue-agent:implementation': 'glm-5.1',
  'issue-agent:review-response': 'glm-5.1',
  'convoy:correctness-reviewer': 'glm-5.1',

  // Procedural specialists — MiniMax M2.7 (97% skill adherence)
  'specialist-test-agent': 'minimax-m2.7',
  'specialist-merge-agent': 'minimax-m2.7',
  'convoy:synthesis-agent': 'minimax-m2.7',
  'specialist-inspect-agent': 'minimax-m2.7-highspeed',

  // Fast subagents & CLI — GPT-5.4 Nano (fastest, cheapest, strong tool use)
  'subagent:explore': 'gpt-5.4-nano',
  'subagent:bash': 'gpt-5.4-nano',
  'subagent:plan': 'gpt-5.4-nano',
  'status-review': 'gpt-5.4-nano',
  'cli:quick-command': 'gpt-5.4-nano',

  // Interactive CLI — GPT-5.4 Mini (speed + reasoning balance)
  'cli:interactive': 'gpt-5.4-mini',
};

export function getEffectiveModelId(
  workType: WorkTypeId,
  overrides: Partial<Record<WorkTypeId, ModelId>>,
): ModelId {
  return (overrides[workType] || DEFAULT_MODELS_BY_WORK_TYPE[workType] || FALLBACK_DEFAULT_MODEL) as ModelId;
}
