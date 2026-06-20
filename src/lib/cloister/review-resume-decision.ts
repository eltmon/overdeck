/**
 * PAN-1862 — the resume-vs-fresh decision for a review agent, as a PURE function so it is locked
 * by tests and shared by both quick review (the parent) and convoy (the sub-reviewers).
 *
 * RESUME (preserve the prior review's context — files read, findings raised — so a re-review
 * checks the fix instead of re-researching the whole diff) when there is a saved, resumable
 * session AND the requested harness/model is unchanged. Fresh-spawn ONLY when the harness or
 * model actually changed (it's a different agent then) or there is no resumable session. A change
 * is detected only when BOTH the requested and saved values are known and differ — an unspecified
 * request (use role default) or an unknown saved value never forces a wipe.
 */
export function reviewResumeDecision(params: {
  requestedModel?: string;
  requestedHarness?: string;
  savedModel?: string;
  savedHarness?: string;
  hasSavedState: boolean;
  hasSavedSession: boolean;
}): boolean {
  const modelChanged =
    !!params.requestedModel && !!params.savedModel && params.requestedModel !== params.savedModel;
  const harnessChanged =
    !!params.requestedHarness && !!params.savedHarness && params.requestedHarness !== params.savedHarness;
  return params.hasSavedState && params.hasSavedSession && !modelChanged && !harnessChanged;
}
