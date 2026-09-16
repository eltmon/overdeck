/**
 * In-memory project-create job store with TTL cleanup.
 *
 * Jobs are tracked in a Map keyed by UUID. When a job settles (done/failed),
 * it is scheduled for deletion after JOB_TTL_MS.
 */

import { randomUUID } from 'node:crypto';
import {
  performProjectCreate,
  type ResolvedProjectIntent,
  type ProjectCreateResult,
} from '../../../lib/projects/create.js';

export const JOB_TTL_MS = 600000; // 10 minutes

export type ProjectCreateJob =
  | { id: string; status: 'running'; phase: string; percent: number | null; startedAt: number }
  | { id: string; status: 'done'; result: ProjectCreateResult; finishedAt: number }
  | { id: string; status: 'failed'; error: string; finishedAt: number };

const jobs = new Map<string, ProjectCreateJob>();
const deleteTimers = new Map<string, NodeJS.Timeout>();

/**
 * Start a project creation job in the background.
 * Returns the job ID immediately; the job runs asynchronously.
 */
export function startProjectCreateJob(intent: ResolvedProjectIntent): string {
  const id = randomUUID();
  const now = Date.now();

  const running: ProjectCreateJob = {
    id,
    status: 'running',
    phase: 'starting',
    percent: null,
    startedAt: now,
  };

  jobs.set(id, running);

  // Run performProjectCreate in the background
  performProjectCreate(intent, {
    onProgress: (progress) => {
      const current = jobs.get(id);
      if (current && current.status === 'running') {
        jobs.set(id, {
          id,
          status: 'running',
          phase: progress.phase,
          percent: progress.percent,
          startedAt: current.startedAt,
        });
      }
    },
  }).then((result) => {
    const finishedAt = Date.now();
    const done: ProjectCreateJob = {
      id,
      status: 'done',
      result,
      finishedAt,
    };
    jobs.set(id, done);
    scheduleJobDeletion(id);
  }).catch((err) => {
    const finishedAt = Date.now();
    const failed: ProjectCreateJob = {
      id,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      finishedAt,
    };
    jobs.set(id, failed);
    scheduleJobDeletion(id);
  });

  return id;
}

/**
 * Get a job by ID, or undefined if not found.
 */
export function getProjectCreateJob(id: string): ProjectCreateJob | undefined {
  return jobs.get(id);
}

/**
 * Schedule deletion of a job after JOB_TTL_MS.
 */
function scheduleJobDeletion(id: string): void {
  // Cancel any existing timer for this job
  const existingTimer = deleteTimers.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    jobs.delete(id);
    deleteTimers.delete(id);
  }, JOB_TTL_MS);

  deleteTimers.set(id, timer);
}

/**
 * Reset the job store for testing.
 */
export function __resetProjectCreateJobsForTests(): void {
  // Clear all pending timers
  deleteTimers.forEach((timer) => clearTimeout(timer));
  deleteTimers.clear();
  jobs.clear();
}
