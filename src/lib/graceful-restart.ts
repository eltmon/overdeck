import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { sendEscapeKeyAsync, sendKeys } from './tmux.js';
import { getHarnessBehavior } from './runtimes/behavior.js';
import type { RuntimeName } from './runtimes/types.js';

export const GRACEFUL_RESTART_GRACE_MS = 60_000;

export async function sendGracefulRestartWarning(
  agentId: string,
  harness: RuntimeName | undefined,
  workspace: string,
): Promise<void> {
  const warning = 'Restarting in 60s. Update .pan/continue.json now with all progress, decisions, hazards, and resume point.';
  try {
    if (harness && !getHarnessBehavior(harness).usesRpcFifo) {
      await sendEscapeKeyAsync(agentId, 2);
      await new Promise((r) => setTimeout(r, 1_000));
    }
    await Effect.runPromise(sendKeys(agentId, warning));
  } catch { /* non-fatal — session may already be dead */ }

  await new Promise(r => setTimeout(r, GRACEFUL_RESTART_GRACE_MS));

  const continueFile = join(workspace, '.pan', 'continue.json');
  if (existsSync(continueFile)) {
    const mtime = statSync(continueFile).mtimeMs;
    const ageMs = Date.now() - mtime;
    if (ageMs > 5 * 60 * 1000) {
      console.warn(`[restartAgent] continue.json is stale (${Math.round(ageMs / 1000)}s old) — proceeding anyway`);
    }
  }
}
