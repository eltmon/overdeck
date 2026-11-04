/**
 * The merge-train project section's intro line (moved out of
 * MergeTrainView.tsx, PAN-4970, no behavior change — file-size extraction
 * only). Says what happened instead of promising a batch that may not exist
 * yet: promoted batches awaiting ship, a single ready feature that merges
 * directly, features assembled into a current batch, one assembling, one
 * whose last attempt failed, or nothing yet.
 *
 * Prop types are structural (not imported from MergeTrainView.tsx) so this
 * file never imports the view back — the view imports this component.
 */
import { ASSEMBLING_LINE, NO_BATCH_YET_LINE, SINGLE_FEATURE_READY_LINE, assemblyFailedLine, formatFailedAt, perPrTrainLine, shortName } from './mergeTrainCopy';

export interface SectionIntroLineProps {
  section: { projectKey: string; projectName: string; holdsForUat?: boolean; queue: Array<{ mergesPerPr?: boolean }> };
  featureCount: number;
  promotedPendingCount: number;
  /** Only checked for presence — the ready/superseded batch currently shown, if any. */
  currentBatch: unknown;
  assemblingNow: boolean;
  lastAssemblyFailed?: { name: string; updatedAt?: string; createdAt?: string };
}

export function SectionIntroLine({
  section,
  featureCount,
  promotedPendingCount,
  currentBatch,
  assemblingNow,
  lastAssemblyFailed,
}: SectionIntroLineProps) {
  // PAN-4970: every ready feature here merges through the per-PR auto-merge
  // train, so no batch will ever assemble for this exact set.
  const perPrCount = section.queue.filter((q) => q.mergesPerPr === true).length;
  return (
    <p className="px-1 pb-1 text-[11px] leading-snug text-muted-foreground">
      {featureCount === 0 && promotedPendingCount > 0 ? (
        <><span className="font-semibold text-foreground">{promotedPendingCount} promoted batch{promotedPendingCount === 1 ? '' : 'es'}</span> await{promotedPendingCount === 1 ? 's' : ''} version ship. Supply the version below to satisfy each member&apos;s ship row.</>
      ) : perPrCount === featureCount && featureCount > 0 && !currentBatch && !assemblingNow ? (
        <><span className="font-semibold text-foreground">{featureCount} feature{featureCount === 1 ? '' : 's'}</span> passed review &amp; tests.<span data-testid={`merge-train-per-pr-${section.projectKey}`}>{perPrTrainLine(featureCount, section.projectName)}</span></>
      ) : featureCount === 1 && !currentBatch && !assemblingNow && section.holdsForUat === false ? (
        <span data-testid={`merge-train-single-feature-${section.projectKey}`}>{SINGLE_FEATURE_READY_LINE}</span>
      ) : (
        <><span className="font-semibold text-foreground">{featureCount} feature{featureCount === 1 ? '' : 's'}</span> passed review &amp; tests.
          {currentBatch
            ? ' They’re assembled into the test batches below — open a batch’s frontend, run its checklist, then merge that batch to main.'
            : assemblingNow
              ? ASSEMBLING_LINE
              : lastAssemblyFailed
                ? (
                  <span data-testid={`merge-train-assembly-failed-${section.projectKey}`}>
                    {assemblyFailedLine(shortName(lastAssemblyFailed.name), formatFailedAt(lastAssemblyFailed))}
                  </span>
                )
                : NO_BATCH_YET_LINE}</>
      )}
    </p>
  );
}
