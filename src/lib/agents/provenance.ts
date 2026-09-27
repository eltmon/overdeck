import { FLYWHEEL_CONVERSATION_SESSION } from '../flywheel/constants.js';

export const FLYWHEEL_STARTED_BY = `flywheel:${FLYWHEEL_CONVERSATION_SESSION}`;
export const PLANNING_AUTO_HANDOFF_STARTED_BY = 'planning-auto-handoff';

export function normalizeFlywheelRunId(
  runId: string | null | undefined,
): string | undefined {
  if (!runId) return undefined;
  const trimmed = runId.trim();
  return /^RUN-\d+$/.test(trimmed) ? trimmed : undefined;
}

export function resolveCliStartedBy(
  defaultOrigin: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const inherited = environment['OVERDECK_AGENT_STARTED_BY']?.trim();
  if (inherited) return inherited;
  const conversation = environment['OVERDECK_CONVERSATION']?.trim();
  if (conversation === FLYWHEEL_CONVERSATION_SESSION) return FLYWHEEL_STARTED_BY;
  return defaultOrigin;
}

export function isOperatorStartedBy(startedBy: string): boolean {
  return startedBy.startsWith('operator:') || startedBy === 'dashboard:agent-spawner';
}

export function isFlywheelStartedBy(
  startedBy: string | null | undefined,
): boolean {
  if (!startedBy) return false;
  return startedBy.trim().startsWith('flywheel:');
}

export function planningHandoffStartedBy(
  planningStartedBy: string | null | undefined,
): string {
  return isFlywheelStartedBy(planningStartedBy)
    ? FLYWHEEL_STARTED_BY
    : PLANNING_AUTO_HANDOFF_STARTED_BY;
}
