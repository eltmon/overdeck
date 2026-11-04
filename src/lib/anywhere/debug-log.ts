/**
 * Debug lines for Overdeck Anywhere (PAN-5018 D-3): printed only when OVERDECK_ANYWHERE_DEBUG=1, so
 * routine events (aborted probe channels, ICE candidates) stay out of dashboard.log by default.
 */
export function anywhereDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['OVERDECK_ANYWHERE_DEBUG'] === '1';
}

export function anywhereDebug(message: string, env: NodeJS.ProcessEnv = process.env): void {
  if (anywhereDebugEnabled(env)) console.warn(`[anywhere] ${message}`);
}

/** The first 8 characters of an id, for log lines (NFR-1). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
