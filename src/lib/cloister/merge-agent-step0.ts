import type { BuildStaleness } from '../deploy/staleness.js';

interface Step0Dependencies {
  readonly computeStaleness: () => Promise<BuildStaleness>;
  readonly getBlockReason: () => Promise<string | null>;
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

  if (staleness.status === 'stale') {
    const getBlockReason = dependencies.getBlockReason ?? (async () =>
      (await import('../deploy/deploy-window.js')).getDeployBlockReason());
    const reason = await getBlockReason();
    if (reason) {
      (dependencies.log ?? console.log)(
        `Deploy window unsafe (${reason}) — deferring deploy to the staleness patrol`,
      );
      return false;
    }
  }

  return true;
}
