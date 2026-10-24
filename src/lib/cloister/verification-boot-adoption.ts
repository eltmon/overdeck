/**
 * PAN-4532: verification survives a dashboard restart.
 *
 * A verification worker is a detached process, so it outlives the dashboard,
 * but the request-review continuation that waits for its result (push the
 * verified branch, dispatch review) lived in the old process. On boot this
 * re-enters the review-request door for every `request-review` worker that is
 * still running or finished with an unconsumed result. The door's verify step
 * reaches the supervisor, which joins the live worker or adopts its result for
 * the same head (cloister/verification-head.ts) instead of re-running every
 * gate. See docs/PIPELINE-GATES.md.
 */
import { getRequestReviewStarter } from './request-review-pipeline.js';
import { listAdoptableVerificationWorkers } from './verification-worker-supervisor.js';

/** Re-attach review continuations; returns the issues whose pipeline started. */
export async function adoptSurvivingVerificationWorkers(): Promise<string[]> {
  const starter = getRequestReviewStarter();
  if (!starter) return [];
  const adopted: string[] = [];
  for (const worker of listAdoptableVerificationWorkers('request-review')) {
    try {
      const outcome = await starter(worker.issueId, {
        source: 'verification-adoption',
        note: `adopting verification worker ${worker.pid}, which survived a dashboard restart`,
      });
      if (outcome.started) adopted.push(worker.issueId);
      else console.log(`[verification-adoption] ${worker.issueId}: not adopted — ${outcome.reason}`);
    } catch (err) {
      console.warn(`[verification-adoption] ${worker.issueId}: could not adopt verification worker ${worker.pid}:`, err);
    }
  }
  return adopted;
}
