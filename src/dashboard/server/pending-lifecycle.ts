/**
 * Pending post-merge lifecycle handler (PAN-444, PAN-520).
 *
 * After a merge-triggered rebuild+restart, the old server writes a pending file
 * before dying. The fresh process reads the pending file on startup and runs the
 * lifecycle steps with correct module chunk references (no ERR_MODULE_NOT_FOUND after rebuild).
 *
 * Lifecycle events (dashboard.lifecycle_started, _completed, _failed) are emitted
 * at startup so the ActivityPanel shows restart progress and App.tsx can show
 * the "restarting" banner.
 */

import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { emitDashboardLifecycleSync } from '../../lib/activity-logger.js';

export const PENDING_FILE = join(homedir(), '.panopticon', 'pending-post-merge.json');
export const RESTART_MARKER = join(homedir(), '.panopticon', 'dashboard-restarting.json');
export const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
export const LIFECYCLE_DELAY_MS = 3000; // 3s — let server become ready first

export interface PendingLifecycleData {
  issueId: string;
  projectPath: string;
  sourceBranch: string;
  timestamp: number;
  reason?: string;
  trigger?: string;
}

export type LifecycleRunner = (pending: PendingLifecycleData) => Promise<void>;

interface RestartMarker {
  reason: string;
  issueId?: string;
  trigger: string;
  timestamp: number;
}

/**
 * Default lifecycle runner: dynamically imports merge-agent so the fresh process
 * loads new content-hashed chunk filenames (no ERR_MODULE_NOT_FOUND after rebuild).
 */
async function defaultLifecycleRunner(pending: PendingLifecycleData): Promise<void> {
  const { postMergeLifecycle, notifyTldrDaemon } = await import('../../lib/cloister/merge-agent.js');
  // skipDeploy: we ARE the fresh rebuilt process — skip step 0 to avoid infinite rebuild loop
  await postMergeLifecycle(pending.issueId, pending.projectPath, pending.sourceBranch, { skipDeploy: true });
  if (pending.sourceBranch) {
    await notifyTldrDaemon(pending.projectPath, pending.sourceBranch);
  }
}

/**
 * Check for and process a pending post-merge lifecycle file.
 * Reads, validates, deletes the file, then schedules lifecycle execution.
 * Safe to call unconditionally on server startup — no-op if file absent.
 *
 * Also checks for a RESTART_MARKER file (written by deploy script before killing
 * the old server) and emits dashboard.lifecycle_started if found.
 */
export async function processPendingLifecycle(options?: {
  pendingFile?: string;
  restartMarker?: string;
  staleThresholdMs?: number;
  lifecycleDelayMs?: number;
  now?: number;
  /** Injectable runner for testing */
  _runner?: LifecycleRunner;
}): Promise<void> {
  const pendingFile = options?.pendingFile ?? PENDING_FILE;
  const restartMarker = options?.restartMarker ?? RESTART_MARKER;
  const staleThresholdMs = options?.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const lifecycleDelayMs = options?.lifecycleDelayMs ?? LIFECYCLE_DELAY_MS;
  const runner = options?._runner ?? defaultLifecycleRunner;

  // Check for restart marker first — indicates a planned restart (not a crash).
  // Emit dashboard.lifecycle_started so the frontend knows this is intentional.
  if (existsSync(restartMarker)) {
    try {
      const raw = await readFile(restartMarker, 'utf-8');
      const marker = JSON.parse(raw) as RestartMarker;
      await unlink(restartMarker);
      const now = options?.now ?? Date.now();
      const age = now - (marker.timestamp ?? 0);

      if (age <= staleThresholdMs) {
        emitDashboardLifecycleSync('started', {
          reason: marker.reason ?? 'post-merge',
          issueId: marker.issueId,
          trigger: marker.trigger ?? 'deploy-script',
        });
        console.log(`[panopticon] Detected planned restart (${marker.reason}) — lifecycle_started event emitted`);
      }
    } catch (err: any) {
      console.warn(`[panopticon] Failed to process restart marker: ${err.message}`);
    }
  }

  if (!existsSync(pendingFile)) {
    return;
  }

  const startTime = Date.now();

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
        emitDashboardLifecycleSync('completed', {
          reason: pending.reason ?? 'post-merge',
          issueId: pending.issueId,
          durationMs: Date.now() - startTime,
        });
      } catch (err: any) {
        console.error(`[panopticon] Post-merge lifecycle failed for ${pending.issueId}: ${err.message}`);
        emitDashboardLifecycleSync('failed', {
          reason: pending.reason ?? 'post-merge',
          issueId: pending.issueId,
          error: err.message,
        });
      }
    }, lifecycleDelayMs);
  } catch (err: any) {
    console.warn(`[panopticon] Failed to process pending-post-merge.json: ${err.message}`);
  }
}
