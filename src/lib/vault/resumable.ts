/**
 * Harnesses whose saved conversation Continue here can resume (PAN-4650 D-4650-9).
 *
 * Moved unchanged from `vault-continue.ts` so `src/lib` (the shared conversation
 * list's `pullable` flag) can use it without importing dashboard server code.
 */
export function isResumableHarness(harness: string): harness is 'claude-code' | 'codex' {
  return harness === 'claude-code' || harness === 'codex';
}
