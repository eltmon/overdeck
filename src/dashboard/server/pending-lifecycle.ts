/**
 * Pending post-merge lifecycle handler (PAN-444).
 *
 * After a merge-triggered rebuild+restart, the old server writes a pending file
 * before dying. The fresh process calls processPendingLifecycle() on startup —
 * dynamic imports resolve to new chunk hashes, so no ERR_MODULE_NOT_FOUND.
 */

import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const PENDING_FILE = join(homedir(), '.panopticon', 'pending-post-merge.json');
export const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
export const LIFECYCLE_DELAY_MS = 3000; // 3s — let server become ready first

export interface PendingLifecycleData {
  issueId: string;
  projectPath: string;
  sourceBranch: string;
  timestamp: number;
}

export type LifecycleRunner = (pending: PendingLifecycleData) => Promise<void>;

/**
 * Default lifecycle runner: dynamically imports merge-agent so the fresh process
 * loads new content-hashed chunk filenames (no ERR_MODULE_NOT_FOUND after rebuild).
 */
async function defaultLifecycleRunner(pending: PendingLifecycleData): Promise<void> {
  const { postMergeLifecycle, notifyTldrDaemon } = await import('../../lib/cloister/merge-agent.js');
  await postMergeLifecycle(pending.issueId, pending.projectPath, pending.sourceBranch);
  if (pending.sourceBranch) {
    await notifyTldrDaemon(pending.projectPath, pending.sourceBranch);
  }
}

/**
 * Check for and process a pending post-merge lifecycle file.
 * Reads, validates, deletes the file, then schedules lifecycle execution.
 * Safe to call unconditionally on server startup — no-op if file absent.
 */
export async function processPendingLifecycle(options?: {
  pendingFile?: string;
  staleThresholdMs?: number;
  lifecycleDelayMs?: number;
  now?: number;
  /** Injectable runner for testing */
  _runner?: LifecycleRunner;
}): Promise<void> {
  const pendingFile = options?.pendingFile ?? PENDING_FILE;
  const staleThresholdMs = options?.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const lifecycleDelayMs = options?.lifecycleDelayMs ?? LIFECYCLE_DELAY_MS;
  const runner = options?._runner ?? defaultLifecycleRunner;

  if (!existsSync(pendingFile)) {
    return;
  }

  try {
    const raw = await readFile(pendingFile, 'utf-8');
    await unlink(pendingFile);

    const pending = JSON.parse(raw) as PendingLifecycleData;
    const now = options?.now ?? Date.now();
    const age = now - (pending.timestamp ?? 0);

    if (age > staleThresholdMs) {
      console.warn(
        `[panopticon] Ignoring stale pending-post-merge.json (age: ${Math.round(age / 60000)}min) for ${pending.issueId}`
      );
      return;
    }

    console.log(
      `[panopticon] Found pending post-merge lifecycle for ${pending.issueId} — scheduling in ${lifecycleDelayMs}ms`
    );

    setTimeout(async () => {
      try {
        await runner(pending);
      } catch (err: any) {
        console.error(`[panopticon] Post-merge lifecycle failed for ${pending.issueId}: ${err.message}`);
      }
    }, lifecycleDelayMs);
  } catch (err: any) {
    console.warn(`[panopticon] Failed to process pending-post-merge.json: ${err.message}`);
  }
}
