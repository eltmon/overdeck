/**
 * PAN-2975 · one honest resume path.
 *
 * Every resume affordance reports the ACTUAL outcome. Today resume reopens
 * the saved session with its memory intact — but background timers, monitors,
 * and processes stay dead (#2749, machinery re-arming). Until that lands, the
 * UI says so plainly instead of implying a full resume.
 */
import { toast } from 'sonner';

export const RESUME_WHAT_IT_DOES = 'Reopens the saved session with its memory intact.';

export const RESUME_OUTCOME_NOTE = 'Background timers and monitors stay stopped for now (machinery re-arming is tracked separately).';

export function toastResumeOutcome(agentId: string) {
  toast.success(`${agentId}: session reopened with its memory intact`, {
    description: RESUME_OUTCOME_NOTE,
  });
}
