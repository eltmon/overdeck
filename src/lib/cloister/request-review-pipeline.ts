import { createInFlightGuard } from './in-flight-guard.js';
import type { VerificationRunnerOutcome } from './verification-types.js';

type MaybePromise = void | Promise<void>;

export interface RequestReviewPipelineDeps {
  verify: () => Promise<VerificationRunnerOutcome>;
  pushBranch: () => Promise<void>;
  dispatchReview: () => Promise<void>;
  onVerificationFailed: (outcome: Extract<VerificationRunnerOutcome, { outcome: 'failed' }>) => MaybePromise;
  onVerificationError: (outcome: Extract<VerificationRunnerOutcome, { outcome: 'error' }>) => MaybePromise;
  onVerificationDeferred?: (outcome: Extract<VerificationRunnerOutcome, { outcome: 'deferred' }>) => MaybePromise;
  onError?: (error: unknown) => void;
}

export interface RequestReviewPipeline {
  start(issueId: string, deps: RequestReviewPipelineDeps): boolean;
  isInFlight(issueId: string): boolean;
}

/**
 * Owns the verification → push → review continuation outside the initiating
 * HTTP request and coalesces repeated requests for the same issue.
 */
export function createRequestReviewPipeline(): RequestReviewPipeline {
  const guard = createInFlightGuard();

  return {
    start(issueId, deps) {
      return guard.run(issueId, async () => {
        const outcome = await deps.verify();
        if (outcome.outcome === 'failed') {
          await deps.onVerificationFailed(outcome);
          return;
        }
        if (outcome.outcome === 'error') {
          await deps.onVerificationError(outcome);
          return;
        }
        if (outcome.outcome === 'deferred') {
          await deps.onVerificationDeferred?.(outcome);
          return;
        }

        await deps.pushBranch();
        await deps.dispatchReview();
      }, deps.onError);
    },
    isInFlight(issueId) {
      return guard.isInFlight(issueId);
    },
  };
}

/** Shared host-side pipeline so HTTP requests and durable intent recovery coalesce. */
export const requestReviewPipeline = createRequestReviewPipeline();

/** What a review-pipeline start did, for the caller to report. */
export type StartRequestReviewOutcome =
  | { started: true; remoteVmName?: string }
  | { started: false; reason: 'no-workspace' | 'already-running' | 'no-project' }
  | { started: false; reason: 'dirty-workspace'; error: string };

/** Who asked for the review — journalled as the `review.requested` source. */
export type RequestReviewSource = 'pan-done' | 'pan-review-request' | 'webhook' | 'deacon-lite' | 'api';

export type RequestReviewStarter = (
  issueId: string,
  options?: { note?: string; source?: RequestReviewSource; onReviewSpawned?: () => void },
) => Promise<StartRequestReviewOutcome>;

let requestReviewStarter: RequestReviewStarter | null = null;

/**
 * The dashboard's review route owns the workspace resolution, the dirty-tree
 * refusal and the verification continuation, and registers that door here at
 * module load (the same seam shape as `registerLivenessHeartbeatLookup`). The
 * GitHub webhook handler lives in `src/lib/` and must not import a dashboard
 * route — it asks for the registered starter instead, and does nothing when
 * the process it runs in never loaded the routes.
 */
export function registerRequestReviewStarter(starter: RequestReviewStarter | null): void {
  requestReviewStarter = starter;
}

export function getRequestReviewStarter(): RequestReviewStarter | null {
  return requestReviewStarter;
}
