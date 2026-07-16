export interface ReconnectPolicyState {
  attempt: number;
  windowStartedAt: number;
}

export const PATIENT_WINDOW_MS = 5 * 60_000;
export const FLAT_DELAY_MS = 5_000;

export function nextReconnectDelay(
  state: ReconnectPolicyState,
  now: number,
): number | null {
  if (now - state.windowStartedAt >= PATIENT_WINDOW_MS) return null;
  if (state.attempt >= 3) return FLAT_DELAY_MS;
  return 1_000 * 2 ** state.attempt;
}
