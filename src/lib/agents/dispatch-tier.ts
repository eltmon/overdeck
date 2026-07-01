import type { VBriefDifficulty, VBriefItem } from '../vbrief/types.js';

export type DispatchTier = 'in-context' | 'registered-slot';

const CHEAP_DIFFICULTIES = new Set<VBriefDifficulty>(['trivial', 'simple']);
const HEAVY_DIFFICULTIES = new Set<VBriefDifficulty>(['complex', 'expert']);

export function chooseDispatchTier(item: Pick<VBriefItem, 'metadata'>): DispatchTier {
  const metadata = item.metadata;
  const difficulty = metadata?.difficulty;

  if (difficulty && HEAVY_DIFFICULTIES.has(difficulty)) return 'registered-slot';

  const highConfidenceScope =
    metadata?.files_scope_confidence === 'high'
    && (metadata.files_scope?.length ?? 0) > 0;
  const independentlyDispatchable = metadata?.readiness === 'ready';

  if (difficulty && CHEAP_DIFFICULTIES.has(difficulty) && highConfidenceScope) {
    return 'in-context';
  }

  if (independentlyDispatchable && highConfidenceScope) return 'registered-slot';

  return 'in-context';
}
