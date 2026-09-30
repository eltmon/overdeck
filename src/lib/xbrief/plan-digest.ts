/**
 * Plan digest for the plan critic (PAN-4341): SHA-256 over the draft xBRIEF
 * without lifecycle fields or the finalize stamp, so the value a critique
 * records still matches after `stampPlanForFinalization` runs.
 */
import { createHash } from 'node:crypto';

import { stableStringify, stripAllowedFields } from '../cloister/plan-integrity-gate.js';

export function planDigest(doc: unknown): string {
  const stripped = stripAllowedFields(doc);
  const plan = stripped.plan as Record<string, unknown> | undefined;
  const metadata = plan?.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    delete metadata.canonicalFilename;
    delete metadata.promotionIntent;
    if (Object.keys(metadata).length === 0) delete plan!.metadata;
  }
  return createHash('sha256').update(stableStringify(stripped)).digest('hex');
}
