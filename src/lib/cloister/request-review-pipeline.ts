import { createInFlightGuard } from './in-flight-guard.js';
import type { VerificationRunnerOutcome } from './verification-types.js';

type MaybePromise = void | Promise<void>;

export interface RequestReviewPipelineDeps {
  verify: () => Promise<VerificationRunnerOutcome>;
  pushBranch: () => Promise<void>;
  dispatchReview: () => Promise<void>;
  onVerificationFailed: (outcome: Extract<VerificationRunnerOutcome, { outcome: 'failed' }>) => MaybePromise;
  onVerificationError: (outcome: Extract<VerificationRunnerOutcome, { outcome: 'error' }>) => MaybePromise;
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

        await deps.pushBranch();
        await deps.dispatchReview();
      }, deps.onError);
    },
    isInFlight(issueId) {
      return guard.isInFlight(issueId);
    },
  };
}
