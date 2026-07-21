export interface ReconnectPolicyState {
  attempt: number;
  windowStartedAt: number;
}

export const PATIENT_WINDOW_MS = 5 * 60_000;
export const FLAT_DELAY_MS = 5_000;
export const MAX_RECONNECT_JITTER_MS = 500;

function clampReconnectJitter(jitterMs: number): number {
  if (!Number.isFinite(jitterMs)) return 0;
  return Math.min(MAX_RECONNECT_JITTER_MS, Math.max(0, Math.round(jitterMs)));
}

export function createReconnectJitter(random: () => number = Math.random): number {
  return clampReconnectJitter(random() * MAX_RECONNECT_JITTER_MS);
}

export function nextReconnectDelay(
  state: ReconnectPolicyState,
  now: number,
  jitterMs = 0,
): number | null {
  if (now - state.windowStartedAt >= PATIENT_WINDOW_MS) return null;
  const baseDelay = state.attempt >= 3
    ? FLAT_DELAY_MS
    : 1_000 * 2 ** state.attempt;
  return baseDelay + clampReconnectJitter(jitterMs);
}
