import { useSystemHealth } from '../hooks/useSystemHealth';

function shortCommit(commit: string | null): string {
  return commit?.slice(0, 8) || 'unknown';
}

export function StaleBuildChip() {
  const { data } = useSystemHealth();
  const staleness = data?.deployStaleness;

  if (staleness?.status !== 'stale' || (staleness.behindBuildInputs ?? 0) < 1) {
    return null;
  }

  const title = [
    `Running build ${shortCommit(staleness.buildCommit)}`,
    `origin/main ${shortCommit(staleness.originMainSha)}`,
    `${staleness.behindTotal ?? 'unknown'} total commit(s) behind`,
  ].join(' · ');

  return (
    <span className="text-[11px] font-medium text-warning-foreground" title={title}>
      build stale ×{staleness.behindBuildInputs}
    </span>
  );
}
