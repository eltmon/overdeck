export const WORK_LAUNCHER_GRACE_MS = 120_000;

export function isStartingWithinGrace(
  state: { status?: string; startedAt?: string },
  now = Date.now(),
  graceMs = WORK_LAUNCHER_GRACE_MS,
): boolean {
  if (state.status !== 'starting') return false;
  const startedMs = Date.parse(state.startedAt ?? '');
  return Number.isFinite(startedMs) && now - startedMs < graceMs;
}
