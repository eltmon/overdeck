import type {
  Harness,
  PipelineStageChangedProperties,
  TelemetryModelFamily,
} from '@overdeck/contracts';
import {
  readPipelineTelemetryAgentState,
  type PipelineTelemetryAgentState,
} from './pipeline-agent-reader.js';
import {
  getAnalyticsClientTypeForProcess,
  getAnalyticsService,
  trackAnalyticsTask,
} from './service.js';
const HARNESSES = new Set<Harness>(['claude-code', 'ohmypi', 'codex', 'acp', 'kimi-code']);

export interface PipelineTelemetryContext {
  harness: Harness;
  model: TelemetryModelFamily;
}

type PipelineMembershipReader = (issueId: string) => Promise<boolean>;

async function readCanonicalPipelineMembership(issueId: string): Promise<boolean> {
  const [membershipModule, gatherModule, recordModule] = await Promise.all([
    import('../pipeline-membership.js'),
    import('../pipeline-membership-gather.js'),
    import('../pan-dir/record.js'),
  ]);
  const project = recordModule.resolveProjectForIssue(issueId);
  if (!project) return false;
  const signals = await gatherModule.gatherProjectLensSignals(project);
  const issueSignals = signals.find(
    (candidate) => candidate.issueId.toUpperCase() === issueId.toUpperCase(),
  );
  return issueSignals
    ? membershipModule.resolvePipelineMembership(issueSignals).inPipeline
    : false;
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

export async function resolvePipelineTelemetryContext(
  issueId: string,
  readAgent: (agentId: string) => PipelineTelemetryAgentState | null = readPipelineTelemetryAgentState,
  readMembership: PipelineMembershipReader = readCanonicalPipelineMembership,
): Promise<PipelineTelemetryContext | null> {
  if (!await readMembership(issueId)) return null;
  const state = readAgent(`agent-${issueId.toLowerCase()}`);
  if (
    !state?.harness ||
    !HARNESSES.has(state.harness) ||
    typeof state.model !== 'string' ||
    state.model.trim().length === 0
  ) return null;
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
  } = getAnalyticsService(getAnalyticsClientTypeForProcess()),
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
): Promise<void> {
  return trackAnalyticsTask((async () => {
    try {
      capturePipelineStage(stage, await resolvePipelineTelemetryContext(issueId));
    } catch {
      // Membership and agent context are best-effort and must not affect the transition.
    }
  })());
}
