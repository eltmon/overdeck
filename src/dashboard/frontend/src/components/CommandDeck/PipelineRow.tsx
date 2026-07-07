import { cn } from '../../lib/utils';
import { initialsFor } from '../../lib/model-names';
import {
  formatPipelineCost,
  isNeedsYouFeature,
  pipelineChipFor,
  sessionCountFor,
  sublineFor,
  whoLineFor,
  type BucketedFeature,
  type IssueCostBreakdown,
} from './pipeline-helpers';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

export interface PipelineRowProps {
  entry: BucketedFeature;
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
}

export function PipelineRow({ entry, issueCosts, onSelectFeature }: PipelineRowProps) {
  const { feature, reviewStatus } = entry;
  const chip = pipelineChipFor(entry);
  const cost = issueCosts[feature.issueId];
  const needsYou = isNeedsYouFeature(feature, reviewStatus);
  const primaryModel = feature.sessions?.find(session => session.presence === 'active')?.model
    ?? feature.sessions?.[0]?.model;
  const avatar = initialsFor(primaryModel ?? feature.issueId);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="pipeline-row"
      data-issue-id={feature.issueId}
      data-phase={entry.phase}
      data-needs-you={needsYou}
      onClick={() => onSelectFeature(feature)}
      className={cn(
        'group grid cursor-pointer items-center gap-3 rounded-[10px] border bg-card/40 px-3 py-2.5 transition-colors hover:border-[#2c3547] hover:bg-accent/40',
        needsYou ? 'border-amber-500/40' : 'border-border',
      )}
      style={{ gridTemplateColumns: '88px 1fr 200px 90px 34px' }}
    >
      <span className="truncate font-mono text-[11.5px] text-muted-foreground">{feature.issueId}</span>

      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-foreground">{feature.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{sublineFor(entry)}</span>
      </span>

      <span className="flex min-w-0 flex-col gap-[3px]">
        <span
          className={cn(
            'inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]',
            chip.bgClass,
            chip.textClass,
          )}
        >
          <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', chip.dotClass, chip.animate && 'animate-pulse')} />
          <span className="truncate">{chip.label}</span>
        </span>
        <span className="truncate text-[10.5px] text-muted-foreground">{whoLineFor(entry)}</span>
      </span>

      <span className="min-w-0 text-right">
        <span className="block truncate text-[12.5px] font-semibold text-foreground">{formatPipelineCost(cost)}</span>
        <span className="block truncate text-[9.5px] text-muted-foreground">{sessionCountFor(feature)} sessions</span>
      </span>

      <span
        className={cn(
          'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] border-[1.5px] bg-muted text-[10.5px] font-semibold text-foreground',
          chip.ringClass,
        )}
      >
        {avatar}
      </span>
    </div>
  );
}
