import type { DeployWindowAssessment } from '../deploy/deploy-window.js';
import type { BuildStaleness } from '../deploy/staleness.js';

interface Step0Dependencies {
  readonly computeStaleness: () => Promise<BuildStaleness>;
  readonly getWindowAssessment: () => Promise<DeployWindowAssessment>;
  readonly recordIntent: typeof import('../deploy/deploy-queue.js').recordDeployIntent;
  readonly log: (message: string) => void;
}

export async function shouldRestartForPostMerge(
  repoRoot: string,
  dependencies: Partial<Step0Dependencies> = {},
): Promise<boolean> {
  const computeStaleness = dependencies.computeStaleness ?? (async () => {
    const [{ getBuildInfo }, { computeBuildStaleness }] = await Promise.all([
      import('../deploy/build-info.js'),
      import('../deploy/staleness.js'),
    ]);
    return computeBuildStaleness({ repoRoot, buildCommit: getBuildInfo().buildCommit });
  });
  const staleness = await computeStaleness();

  if (staleness.status === 'fresh') {
    (dependencies.log ?? console.log)(
      'Running build already contains origin/main build inputs — skipping deploy restart',
    );
    return false;
  }

  const getWindowAssessment = dependencies.getWindowAssessment ?? (async () =>
    (await import('../deploy/deploy-window.js')).getDeployWindowAssessment());
  const assessment = await getWindowAssessment();
  if (assessment.reason) {
    const recordIntent = dependencies.recordIntent
      ?? (await import('../deploy/deploy-queue.js')).recordDeployIntent;
    await recordIntent({
      requestedBy: 'merge-step0',
      reason: assessment.reason,
      blockedBy: [],
    });
    (dependencies.log ?? console.log)(
      `Deploy window unsafe (${assessment.reason}) — deferring deploy to the staleness patrol`,
    );
    return false;
  }

  return true;
}
