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
  const runId = normalizeFlywheelRunId(
    environment['OVERDECK_FLYWHEEL_RUN_ID'],
  );
  return runId ? `flywheel:${runId}` : defaultOrigin;
}

export function isOperatorStartedBy(startedBy: string): boolean {
  return startedBy.startsWith('operator:') || startedBy === 'dashboard:agent-spawner';
}
