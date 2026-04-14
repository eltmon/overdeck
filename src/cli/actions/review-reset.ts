/**
 * Action handler for `pan review reset <id>`.
 *
 * Extracted from index.ts so it can be unit-tested without loading the
 * full CLI module (which executes commander at import time).
 */

import { resetReviewCommand } from '../commands/reset-review.js';
import { resetSessionCommand } from '../commands/reset-session.js';

export interface ReviewResetOptions {
  session?: boolean;
}

export async function reviewResetAction(
  id: string,
  options: ReviewResetOptions = {}
): Promise<void> {
  // Always reset review cycles. --session is additive: it also clears the
  // saved Claude session after the review reset runs.
  await resetReviewCommand(id);
  if (options.session) {
    await resetSessionCommand(id);
  }
}
