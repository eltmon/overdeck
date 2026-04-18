import { ModelId, WorkTypeId } from './types';

export const FALLBACK_DEFAULT_MODEL: ModelId = 'gpt-4o-mini';

export const DEFAULT_MODELS_BY_WORK_TYPE: Partial<Record<WorkTypeId, ModelId>> = {
  'issue-agent:exploration': 'claude-opus-4-6',
  'issue-agent:implementation': 'kimi-k2.5',
  'issue-agent:testing': 'claude-sonnet-4-6',
  'issue-agent:documentation': 'claude-sonnet-4-6',
  'issue-agent:review-response': 'claude-sonnet-4-6',
  'specialist-review-agent': 'claude-opus-4-6',
  'specialist-test-agent': 'claude-sonnet-4-6',
  'specialist-merge-agent': 'claude-sonnet-4-6',
  'specialist-inspect-agent': 'claude-sonnet-4-6',
  'specialist-uat-agent': 'claude-sonnet-4-6',
  'review:security': 'claude-opus-4-6',
  'review:performance': 'claude-sonnet-4-6',
  'review:correctness': 'claude-sonnet-4-6',
  'review:requirements': 'claude-sonnet-4-6',
  'review:synthesis': 'claude-sonnet-4-6',
  'subagent:explore': 'claude-haiku-4-5',
  'subagent:plan': 'claude-haiku-4-5',
  'subagent:bash': 'claude-haiku-4-5',
  'subagent:general-purpose': 'claude-sonnet-4-6',
  'planning-agent': 'claude-opus-4-6',
  'status-review': 'claude-sonnet-4-6',
  'cli:interactive': 'claude-sonnet-4-6',
  'cli:quick-command': 'claude-haiku-4-5',
};

export function getEffectiveModelId(
  workType: WorkTypeId,
  overrides: Partial<Record<WorkTypeId, ModelId>>,
): ModelId {
  return (overrides[workType] || DEFAULT_MODELS_BY_WORK_TYPE[workType] || FALLBACK_DEFAULT_MODEL) as ModelId;
}
