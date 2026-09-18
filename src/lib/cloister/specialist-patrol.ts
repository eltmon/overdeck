/**
 * specialist-patrol.ts — per-project ephemeral specialist patrol (PAN-300, PAN-375, PAN-919).
 *
 * Extracted from the inline `runBudgetedPatrol('perProjectSpecialistPatrol', …)`
 * closure in `deacon.ts` by PAN-3894 (W3a) so the housekeeping scheduler can run
 * it off the 60 s tick. The patrol returns action strings instead of calling the
 * deacon's private `addLog`; the caller logs them. Warnings are returned with a
 * `[warn] ` prefix so the caller can pick the log level.
 *
 * Every dependency is injectable so the patrol is testable without tmux, git, or
 * the specialist registry. The default deps never import `./deacon.js` (PAN-3894 D7).
 */
import { Effect } from 'effect';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { getAllProjectSpecialistStatuses } from './specialists.js';
import { getAgentRuntimeStateSync, saveAgentRuntimeState } from '../agents.js';
import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';
import { killSession } from '../tmux.js';
import { resolveProjectFromIssueSync } from '../projects.js';

const execAsyncDefault = promisify(exec);

/** A running ephemeral specialist active for longer than this is treated as stuck. */
export const SPECIALIST_STUCK_MS = 15 * 60 * 1000;
/** An idle-but-alive ephemeral specialist older than this is killed (PAN-919). */
export const SPECIALIST_IDLE_LINGER_MS = 5 * 60 * 1000;

export interface SpecialistPatrolDeps {
  getAllProjectSpecialistStatuses: typeof getAllProjectSpecialistStatuses;
  getAgentRuntimeStateSync: typeof getAgentRuntimeStateSync;
  saveAgentRuntimeState: typeof saveAgentRuntimeState;
  getReviewStatusSync: typeof getReviewStatusSync;
  setReviewStatusSync: typeof setReviewStatusSync;
  killSession: (session: string) => Promise<void>;
  execAsync: (command: string, options?: unknown) => Promise<{ stdout: string }>;
  resolveProjectFromIssueSync: typeof resolveProjectFromIssueSync;
  postMergeLifecycle: (issueId: string, projectPath: string) => Promise<unknown>;
  now: () => number;
}

export const defaultSpecialistPatrolDeps: SpecialistPatrolDeps = {
  getAllProjectSpecialistStatuses,
  getAgentRuntimeStateSync,
  saveAgentRuntimeState,
  getReviewStatusSync,
  setReviewStatusSync,
  killSession: (session) => Effect.runPromise(killSession(session)).then(() => undefined),
  execAsync: execAsyncDefault as SpecialistPatrolDeps['execAsync'],
  resolveProjectFromIssueSync,
  postMergeLifecycle: async (issueId, projectPath) =>
    (await import('./merge-agent.js')).postMergeLifecycle(issueId, projectPath),
  now: () => Date.now(),
};

export async function perProjectSpecialistPatrol(
  deps: SpecialistPatrolDeps = defaultSpecialistPatrolDeps,
): Promise<string[]> {
  const collected: string[] = [];
  try {
    const projectSpecialists = await deps.getAllProjectSpecialistStatuses();
    for (const projSpec of projectSpecialists) {
      if (!projSpec.isRunning) {
        // Session is dead — reset any stale active runtime state so the next
        // merge request is not blocked by a phantom busy signal.
        const runtimeState = deps.getAgentRuntimeStateSync(projSpec.tmuxSession);
        if (runtimeState?.state === 'active') {
          deps.saveAgentRuntimeState(projSpec.tmuxSession, { state: 'idle', lastActivity: new Date(deps.now()).toISOString() });
          const msg = `Dead-session reset: per-project ${projSpec.specialistType} (${projSpec.projectKey}) was active but session is gone`;
          collected.push(msg);
          console.log(`[deacon] ${msg}`);

          // PAN-375: If merge specialist died while merging, check if merge actually succeeded
          if (projSpec.specialistType === 'merge-agent' && runtimeState.currentIssue) {
            const issueId = runtimeState.currentIssue;
            try {
              const currentStatus = deps.getReviewStatusSync(issueId);
              if (currentStatus?.mergeStatus === 'merging') {
                const resolved = deps.resolveProjectFromIssueSync(issueId);
                if (resolved) {
                  const branch = `feature/${issueId.toLowerCase()}`;
                  const { stdout } = await deps.execAsync(
                    `git -C "${resolved.projectPath}" log --oneline origin/main --grep="Merge branch '${branch}'" 2>/dev/null | head -1`,
                    { encoding: 'utf-8', timeout: 15_000 },
                  );
                  if (stdout.trim()) {
                    console.log(`[deacon] PAN-375: merge specialist died but ${issueId} IS merged (${stdout.trim()}). Auto-completing.`);
                    deps.setReviewStatusSync(issueId, { mergeStatus: 'merged', readyForMerge: false });
                    deps.postMergeLifecycle(issueId, resolved.projectPath).catch((err) =>
                      console.warn(`[deacon] postMergeLifecycle failed for ${issueId}: ${err}`),
                    );
                    collected.push(`Auto-completed stale merge for ${issueId}`);
                  } else {
                    console.log(`[deacon] Merge specialist died and ${issueId} NOT merged. Resetting to readyForMerge.`);
                    deps.setReviewStatusSync(issueId, { mergeStatus: 'pending' });
                  }
                }
              }
            } catch (err) {
              console.warn(`[deacon] PAN-375 check failed for ${issueId}: ${err}`);
            }
          }
        }
        continue;
      }

      const runtimeState = deps.getAgentRuntimeStateSync(projSpec.tmuxSession);
      // A running ephemeral specialist with no runtime state, or active for more than
      // the max specialist timeout (ephemeral specialist spawn uses 15 min), is considered stuck.
      const isStuck = runtimeState?.state === 'active' && runtimeState.lastActivity
        ? (deps.now() - new Date(runtimeState.lastActivity).getTime()) > SPECIALIST_STUCK_MS
        : false;

      if (isStuck) {
        collected.push(`[warn] Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing`);
        console.log(`[deacon] Per-project ${projSpec.specialistType} (${projSpec.projectKey}) stuck, force-killing ${projSpec.tmuxSession}`);
        try {
          await deps.killSession(projSpec.tmuxSession);
          // Preserve Claude JSONL/session artifacts; only reset Overdeck runtime state.
          deps.saveAgentRuntimeState(projSpec.tmuxSession, { state: 'idle', lastActivity: new Date(deps.now()).toISOString() });
          collected.push(`Force-killed stuck per-project ${projSpec.specialistType} (${projSpec.projectKey})`);
        } catch {
          // Non-fatal — session may have already exited
        }
      }

      // PAN-919: Idle-but-alive specialist — task completed but session lingers
      // (e.g. Claude Code sitting at "Press Ctrl-D again to exit" after one-shot task).
      // Ephemeral specialists have no reason to stay alive once idle.
      if (
        !isStuck &&
        (!runtimeState || runtimeState.state === 'idle') &&
        runtimeState?.lastActivity &&
        deps.now() - new Date(runtimeState.lastActivity).getTime() > SPECIALIST_IDLE_LINGER_MS
      ) {
        const ageMin = Math.round((deps.now() - new Date(runtimeState.lastActivity).getTime()) / 60000);
        const msg = `Killed lingering idle specialist ${projSpec.specialistType} (${projSpec.projectKey}) — idle ${ageMin}min`;
        console.log(`[deacon] ${msg}`);
        try {
          await deps.killSession(projSpec.tmuxSession);
          collected.push(msg);
        } catch {
          // Non-fatal
        }
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error during per-project specialist patrol:', msg);
  }
  return collected;
}
