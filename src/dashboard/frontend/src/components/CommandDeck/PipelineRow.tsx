import { cn } from '../../lib/utils';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import {
  formatAge,
  homeStageTag,
  homeWhoFor,
  lastActivityAt,
  sublineFor,
  type BucketedFeature,
  type IssueCostBreakdown,
  type PipelineLaneKey,
} from './pipeline-helpers';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

export interface PipelineRowProps {
  entry: BucketedFeature;
  lane: PipelineLaneKey;
  needsYou: boolean;
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
}

/**
 * PAN-5294 G-D8 — one full-width Home pipeline row: id, title, tag, who, age.
 * The stuck reason and per-issue spend stay one hover away in `title`.
 */
export function PipelineRow({ entry, lane, needsYou, issueCosts, onSelectFeature }: PipelineRowProps) {
  const { feature } = entry;
  const tag = homeStageTag(entry, needsYou);
  const cost = issueCosts[feature.issueId];
  const tooltip = cost === undefined ? sublineFor(entry) : `${sublineFor(entry)} · spent $${cost.toFixed(2)}`;
  const last = lastActivityAt(entry);
  const now = Date.now();
  const age = last > 0 ? formatAge(now - last) : '—';

  return (
    <div
      role="button"
      tabIndex={0}
      title={tooltip}
      data-testid="pipeline-row"
      data-issue-id={feature.issueId}
      data-lane={lane}
      data-phase={entry.phase}
      data-needs-you={needsYou}
      onClick={() => onSelectFeature(feature)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelectFeature(feature);
        }
      }}
      className="grid cursor-pointer items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0 hover:bg-accent"
      style={{ gridTemplateColumns: '92px minmax(0,1fr) 150px 170px 80px' }}
    >
      <span className="truncate font-mono text-[12px] text-muted-foreground" data-cell="id">{feature.issueId}</span>
      <span className="truncate text-[13px] text-foreground" data-cell="title">{feature.title}</span>
      <span className="min-w-0" data-cell="tag">
        <span className={cn('inline-block max-w-full truncate rounded-md border px-2 py-0.5 text-[11px]', tag.className)}>
          {tag.label}
        </span>
      </span>
      <span className="truncate text-[12px] text-muted-foreground" data-cell="who">{homeWhoFor(entry)}</span>
      <span
        className="text-right font-mono text-[12px] text-muted-foreground"
        data-cell="age"
        title={last > 0 ? `last activity ${formatRelativeTime(new Date(last), new Date(now))}` : 'no recorded activity'}
      >
        {age}
      </span>
    </div>
  );
}
