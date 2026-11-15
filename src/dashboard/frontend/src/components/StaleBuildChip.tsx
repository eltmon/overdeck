import { useDeployStaleness } from '../hooks/useDeployStaleness';

function shortCommit(commit: string | null): string {
  return commit?.slice(0, 8) || 'unknown';
}

/**
 * The top bar's "Build behind main" exception chip (PAN-5292 WI-E6, E-D10).
 * It reports that the dashboard *server* build is behind origin/main, which a
 * browser reload does not fix (NewBuildBanner owns that case), so the title
 * names the remedy: `pan reload`. Renders nothing unless a build input changed.
 */
export function StaleBuildChip() {
  const { data: staleness } = useDeployStaleness();

  if (staleness?.status !== 'stale' || (staleness.behindBuildInputs ?? 0) < 1) {
    return null;
  }

  const title = [
    `Running build ${shortCommit(staleness.buildCommit)}`,
    `origin/main ${shortCommit(staleness.originMainSha)}`,
    `${staleness.behindBuildInputs} build-input commit(s) behind`,
    `${staleness.behindTotal ?? 'unknown'} total commit(s) behind`,
    'Run pan reload to build and restart the dashboard.',
  ].join(' · ');

  return (
    <span className="text-[11px] font-medium text-warning-foreground" title={title} data-testid="stale-build-chip">
      Build behind main
    </span>
  );
}
