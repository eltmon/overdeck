/**
 * The `reviewMode` field of a review request body, validated. Moved out of
 * review-pipeline.ts (PAN-4622) to keep that route module under the file-size
 * ceiling; it has no dependencies.
 */
export function parseRequestedReviewMode(body: unknown):
  | { ok: true; mode?: 'quick' | 'full' | 'none' }
  | { ok: false; error: string } {
  const reviewMode = typeof body === 'object' && body !== null
    ? (body as { reviewMode?: unknown }).reviewMode
    : undefined;

  if (reviewMode === undefined || reviewMode === null) {
    return { ok: true };
  }
  if (reviewMode === 'quick' || reviewMode === 'full' || reviewMode === 'none') {
    return { ok: true, mode: reviewMode };
  }
  return { ok: false, error: 'reviewMode must be quick, full, or none' };
}
