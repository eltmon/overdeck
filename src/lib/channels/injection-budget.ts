/**
 * Payload-size-aware injection budget shared between the PTY supervisor and
 * its delivery client. This is the single timing source for both sides of the
 * protocol; keeping their waits in one leaf module makes
 * mid-injection abandonment structurally impossible: the client always waits
 * strictly longer than the supervisor's worst-case internal path.
 *
 * This module must remain a leaf (it imports nothing from src/lib) so the
 * dashboard build does not gain a new circular-ESM edge.
 */

export const INPUT_ECHO_CONFIRM_INTERVAL_MS = 50;
export const INPUT_ECHO_CONFIRM_ATTEMPTS = 2;
export const INPUT_ECHO_CONFIRM_PREFIX_CHARS = 40;
export const INPUT_PURGE_MAX_CHARS = 262_144;
export const SUPERVISOR_CLIENT_MARGIN_MS = 2_000;
const INJECTION_OVERHEAD_MS = 3_000; // PTY writes, log appends, scheduler slack

/** Echo window for one attempt: 2.5s floor + 100ms per KB, capped at 15s. */
export function echoConfirmTimeoutMs(contentLength: number): number {
  return Math.min(2_500 + Math.ceil(contentLength / 1_024) * 100, 15_000);
}

/** Pause between confirmed echo and the standalone Enter: 300ms floor + 50ms/KB, capped at 2s. */
export function inputSettleMs(contentLength: number): number {
  return Math.min(300 + Math.ceil(contentLength / 1_024) * 50, 2_000);
}

/** Settle after a purge: 150ms floor + 25ms/KB of erased content, capped at 1s. */
export function purgeSettleMs(erasedChars: number): number {
  return Math.min(150 + Math.ceil(erasedChars / 1_024) * 25, 1_000);
}

/** Worst-case wall time injectPtyMessage can spend before responding. */
export function supervisorInjectionBudgetMs(contentLength: number): number {
  const clamped = Math.min(contentLength, INPUT_PURGE_MAX_CHARS);
  return (
    INPUT_ECHO_CONFIRM_ATTEMPTS * echoConfirmTimeoutMs(contentLength) +
    INPUT_ECHO_CONFIRM_ATTEMPTS * purgeSettleMs(clamped) +
    inputSettleMs(contentLength) +
    INJECTION_OVERHEAD_MS
  );
}
