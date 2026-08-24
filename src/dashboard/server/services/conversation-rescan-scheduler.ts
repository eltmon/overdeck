import { scan } from '../../../lib/conversations/scanner.js';

/**
 * Keeps the discovered-sessions FTS index fresh (PAN-3771 layer 2).
 * The Conversations-page search corpus previously only updated when someone
 * clicked Scan or ran `pan conv scan`, so installs that never rescanned had
 * weeks of invisible sessions. The scan is incremental: unchanged files are
 * skipped by size and mtime.
 */

const BOOT_DELAY_MS = 45000;
const RESCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LOG_PREFIX = '[conversation-rescan]';

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let stopped = false;

async function runScanOnce(trigger: string): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    const result = await scan({ mode: 'system' });
    const elapsedMs = Math.round(result.durationMs);
    const summary = `${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`;
    console.log(`${LOG_PREFIX} ${trigger} scan complete: ${summary} (${elapsedMs}ms)`);
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${trigger} scan failed:`, error);
  } finally {
    running = false;
  }
}

export function startConversationRescanScheduler(): void {
  if (bootTimer !== null || intervalTimer !== null) return;
  stopped = false;
  bootTimer = setTimeout(() => {
    void runScanOnce('boot');
  }, BOOT_DELAY_MS);
  if (typeof bootTimer.unref === 'function') bootTimer.unref();
  intervalTimer = setInterval(() => {
    void runScanOnce('interval');
  }, RESCAN_INTERVAL_MS);
  if (typeof intervalTimer.unref === 'function') intervalTimer.unref();
}

export async function stopConversationRescanScheduler(): Promise<void> {
  if (bootTimer !== null) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (intervalTimer !== null) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  stopped = true;
}
