/**
 * Review run output monitor (PAN-1059 — stall-detection bead)
 *
 * When the synthesis role spawns convoy reviewers as isolated tmux sessions
 * via spawnRun(issueId, 'review', { subRole }), it needs a way to:
 *   1. Know when each reviewer has finished (output file written)
 *   2. Detect stalls (reviewer session died or hasn't written in N minutes)
 *   3. Receive all output paths when every reviewer has settled
 *
 * waitForReviewerOutputs() implements that contract. Synthesis calls it
 * after firing all four spawnRun calls, then reads the resolved output files
 * to synthesize findings.
 */

import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import { Effect, Schedule, Duration } from 'effect';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { sessionExistsAsyncEffect, isPaneDeadAsyncEffect } from '../tmux.js';

export type ReviewSubRole = 'security' | 'correctness' | 'performance' | 'requirements';

export const REVIEW_SUB_ROLES: readonly ReviewSubRole[] = [
  'security',
  'correctness',
  'performance',
  'requirements',
];

export interface ReviewerResult {
  subRole: ReviewSubRole;
  outputPath: string;
  status: 'done' | 'stalled' | 'missing';
}

export interface WaitForReviewerOutputsOpts {
  issueId: string;
  runId: string;
  workspace: string;
  /** Sub-roles to wait on. Defaults to all four. */
  subRoles?: readonly ReviewSubRole[];
  /**
   * How often to poll for output files, in ms. Default 10_000.
   */
  pollIntervalMs?: number;
  /**
   * Total wait budget before a reviewer is declared stalled, in ms.
   * Default 20 minutes (1_200_000).
   */
  timeoutMs?: number;
  /**
   * If a reviewer's output file has not grown for this many ms, it is
   * declared stalled even if it hasn't hit timeoutMs. Default 8 minutes.
   */
  staleAfterMs?: number;
}

interface ReviewerState {
  subRole: ReviewSubRole;
  outputPath: string;
  sessionId: string;
  settled: boolean;
  stalledAt?: number;
  lastModifiedMs: number;
}

/**
 * Poll for reviewer output files until all have settled (written their
 * output file or been declared stalled/missing). Returns one result per
 * sub-role.
 *
 * Callers should await this after firing all spawnRun sub-role spawns.
 */
export async function waitForReviewerOutputs(
  opts: WaitForReviewerOutputsOpts,
): Promise<ReviewerResult[]> {
  const {
    issueId,
    runId,
    workspace,
    subRoles = REVIEW_SUB_ROLES,
    pollIntervalMs = 10_000,
    timeoutMs = 20 * 60 * 1_000,
    staleAfterMs = 8 * 60 * 1_000,
  } = opts;

  const reviewDir = join(workspace, PAN_DIRNAME, 'review', runId);
  const deadline = Date.now() + timeoutMs;

  const states: ReviewerState[] = subRoles.map((subRole) => ({
    subRole,
    outputPath: join(reviewDir, `${subRole}.md`),
    sessionId: `agent-${issueId.toLowerCase()}-review-${subRole}`,
    settled: false,
    lastModifiedMs: 0,
  }));

  while (true) {
    const now = Date.now();

    for (const s of states) {
      if (s.settled) continue;

      if (existsSync(s.outputPath)) {
        try {
          const mtime = (await stat(s.outputPath)).mtimeMs;
          if (mtime === s.lastModifiedMs && now - mtime > staleAfterMs) {
            // File stopped growing — reviewer is done or stuck
            s.settled = true;
            s.stalledAt = undefined;
            continue;
          }
          s.lastModifiedMs = mtime;
        } catch {
          // stat race — try again next poll
        }
      }

      // Check if the tmux session is dead
      try {
        const dead = await Effect.runPromise(isPaneDeadAsyncEffect(s.sessionId));
        if (dead) {
          s.settled = true;
          if (!existsSync(s.outputPath)) {
            s.stalledAt = now; // → missing
          } else if (s.lastModifiedMs > 0 && now - s.lastModifiedMs <= staleAfterMs) {
            s.stalledAt = now; // session died before file settled → stalled
          }
          // else: file exists and mtime settled → done
          continue;
        }
      } catch {
        // Session may not exist
        const exists = await Effect.runPromise(sessionExistsAsyncEffect(s.sessionId));
        if (!exists) {
          s.settled = true;
          if (!existsSync(s.outputPath)) {
            s.stalledAt = now;
          }
        }
      }

      // Hard timeout
      if (now >= deadline) {
        s.settled = true;
        s.stalledAt = now;
      }
    }

    if (states.every((s) => s.settled)) break;

    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return states.map((s) => {
    if (!existsSync(s.outputPath)) {
      return { subRole: s.subRole, outputPath: s.outputPath, status: 'missing' as const };
    }
    if (s.stalledAt !== undefined) {
      return { subRole: s.subRole, outputPath: s.outputPath, status: 'stalled' as const };
    }
    return { subRole: s.subRole, outputPath: s.outputPath, status: 'done' as const };
  });
}

/**
 * Compute the expected output path for a convoy reviewer.
 * Synthesis writes findings here; waitForReviewerOutputs polls it.
 */
export function reviewerOutputPath(
  workspace: string,
  runId: string,
  subRole: ReviewSubRole,
): string {
  return join(workspace, PAN_DIRNAME, 'review', runId, `${subRole}.md`);
}

// ─── Effect variant (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of {@link waitForReviewerOutputs}. Drives the same poll loop
 * via Effect's `Schedule.spaced` and yields after each tick instead of using
 * raw `setTimeout`. Errors thrown by stat / tmux probes are tolerated the same
 * way as the Promise version.
 */
export const waitForReviewerOutputsEffect = (
  opts: WaitForReviewerOutputsOpts,
): Effect.Effect<ReviewerResult[]> =>
  Effect.gen(function* () {
    const {
      issueId,
      runId,
      workspace,
      subRoles = REVIEW_SUB_ROLES,
      pollIntervalMs = 10_000,
      timeoutMs = 20 * 60 * 1_000,
      staleAfterMs = 8 * 60 * 1_000,
    } = opts;

    const reviewDir = join(workspace, PAN_DIRNAME, 'review', runId);
    const deadline = Date.now() + timeoutMs;

    const states: ReviewerState[] = subRoles.map((subRole) => ({
      subRole,
      outputPath: join(reviewDir, `${subRole}.md`),
      sessionId: `agent-${issueId.toLowerCase()}-review-${subRole}`,
      settled: false,
      lastModifiedMs: 0,
    }));

    const tick = Effect.gen(function* () {
      const now = Date.now();

      for (const s of states) {
        if (s.settled) continue;

        if (existsSync(s.outputPath)) {
          const mtime = yield* Effect.tryPromise({
            try: () => stat(s.outputPath).then((st) => st.mtimeMs),
            catch: () => 0,
          }).pipe(Effect.orElseSucceed(() => 0));

          if (mtime) {
            if (mtime === s.lastModifiedMs && now - mtime > staleAfterMs) {
              s.settled = true;
              s.stalledAt = undefined;
              continue;
            }
            s.lastModifiedMs = mtime;
          }
        }

        const dead = yield* isPaneDeadAsyncEffect(s.sessionId).pipe(
          Effect.map((value): boolean | null => value),
          Effect.catch(() => Effect.succeed(null)),
        );

        if (dead === true) {
          s.settled = true;
          if (!existsSync(s.outputPath)) {
            s.stalledAt = now;
          } else if (s.lastModifiedMs > 0 && now - s.lastModifiedMs <= staleAfterMs) {
            s.stalledAt = now;
          }
          continue;
        } else if (dead === null) {
          const exists = yield* sessionExistsAsyncEffect(s.sessionId).pipe(
            Effect.catch(() => Effect.succeed(true)),
          );
          if (!exists) {
            s.settled = true;
            if (!existsSync(s.outputPath)) s.stalledAt = now;
          }
        }

        if (Date.now() >= deadline) {
          s.settled = true;
          s.stalledAt = Date.now();
        }
      }

      return states.every((s) => s.settled);
    });

    yield* tick.pipe(
      Effect.repeat({
        until: (done) => done,
        schedule: Schedule.spaced(Duration.millis(pollIntervalMs)),
      }),
    );

    return states.map((s) => {
      if (!existsSync(s.outputPath)) {
        return { subRole: s.subRole, outputPath: s.outputPath, status: 'missing' as const };
      }
      if (s.stalledAt !== undefined) {
        return { subRole: s.subRole, outputPath: s.outputPath, status: 'stalled' as const };
      }
      return { subRole: s.subRole, outputPath: s.outputPath, status: 'done' as const };
    });
  });
