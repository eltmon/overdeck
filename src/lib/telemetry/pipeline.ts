import type {
  Harness,
  PipelineStageChangedProperties,
  TelemetryModelFamily,
} from '@overdeck/contracts';
import { getAgentStateSync, type AgentState } from '../agents/agent-state.js';
import { normalizeAgentId } from '../agents/identity.js';
import { AnalyticsService } from './service.js';

const serverAnalytics = new AnalyticsService('server');
const HARNESSES = new Set<Harness>(['claude-code', 'ohmypi', 'codex', 'acp']);

export interface PipelineTelemetryContext {
  harness: Harness;
  model: TelemetryModelFamily;
}

export function toTelemetryModelFamily(model: string): TelemetryModelFamily {
  const normalized = model.toLowerCase();
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('gpt') || /^o\d/.test(normalized)) return 'gpt';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('kimi')) return 'kimi';
  if (normalized.includes('minimax')) return 'minimax';
  if (normalized.includes('glm')) return 'glm';
  if (normalized.includes('mimo')) return 'mimo';
  return 'other';
}

export function resolvePipelineTelemetryContext(
  issueId: string,
  readAgent: (agentId: string) => AgentState | null = getAgentStateSync,
): PipelineTelemetryContext | null {
  const state = readAgent(normalizeAgentId(issueId));
  if (!state?.harness || !HARNESSES.has(state.harness)) return null;
  return {
    harness: state.harness,
    model: toTelemetryModelFamily(state.model),
  };
}

export function capturePipelineStage(
  stage: PipelineStageChangedProperties['stage'],
  context: PipelineTelemetryContext | null,
  analytics: {
    capture: (
      event: 'pipeline_stage_changed',
      properties: PipelineStageChangedProperties,
    ) => void;
  } = serverAnalytics,
): void {
  if (!context) return;
  try {
    analytics.capture('pipeline_stage_changed', { stage, ...context });
  } catch {
    // Telemetry must never affect a pipeline transition.
  }
}

export function capturePipelineStageForIssue(
  issueId: string,
  stage: PipelineStageChangedProperties['stage'],
): void {
  try {
    capturePipelineStage(stage, resolvePipelineTelemetryContext(issueId));
  } catch {
    // Agent context is best-effort and must not affect the transition.
  }
}
