import { useMemo } from 'react';
import { groupPipelineEntries, type BucketedFeature, type IssueCostBreakdown } from './pipeline-helpers';
import { PipelineRow } from './PipelineRow';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

export interface PipelineSectionProps {
  entries: readonly BucketedFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
}

export function PipelineSection({ entries, issueCosts, issueCostDetails, onSelectFeature }: PipelineSectionProps) {
  const groups = useMemo(() => groupPipelineEntries(entries), [entries]);
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="pipeline-section">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-label={`${group.title.toLowerCase()} pipeline stage`}
          data-phase-group={group.key}
        >
          <div className="mb-1.5 flex items-baseline gap-2.5">
            <h3 className="text-[13px] font-semibold text-foreground">{group.title}</h3>
            <span className="text-[11px] text-muted-foreground">{group.entries.length} {group.subtitle}</span>
          </div>
          <div className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <PipelineRow
                key={entry.feature.issueId}
                entry={entry}
                issueCosts={issueCosts}
                issueCostDetails={issueCostDetails}
                onSelectFeature={onSelectFeature}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
