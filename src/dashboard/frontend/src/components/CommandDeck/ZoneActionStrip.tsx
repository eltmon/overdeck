import { IssueActionMenu } from '../IssueActionMenu';
import { MergeAutoMergeCountdown } from '../MergeAutoMergeCountdown';
import type { Agent, Issue } from '../../types';
import type { OverviewTab } from './ZoneCOverview';

interface ZoneActionStripProps {
  issueId: string;
  agent?: Agent;
  issue?: Issue;
  onOpenBeads?: () => void;
  onSwitchTab?: (tab: OverviewTab) => void;
}

export function ZoneActionStrip({ issueId, issue }: ZoneActionStripProps) {
  const autoMergeScheduled = issue?.mergeStatus === 'merged' ? null : issue?.autoMergeScheduled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {autoMergeScheduled ? (
        <div style={{ padding: '6px 12px 0' }}>
          <MergeAutoMergeCountdown issueId={issueId} executeAt={autoMergeScheduled.executeAt} />
        </div>
      ) : null}
      <IssueActionMenu
        issueId={issueId}
        mode="hybrid"
        className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5"
      />
    </div>
  );
}
