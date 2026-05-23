import { IssueActionMenu } from '../IssueActionMenu';
import type { Agent, Issue } from '../../types';
import type { OverviewTab } from './ZoneCOverview';

interface ZoneActionStripProps {
  issueId: string;
  agent?: Agent;
  issue?: Issue;
  onOpenBeads?: () => void;
  onSwitchTab?: (tab: OverviewTab) => void;
}

export function ZoneActionStrip({ issueId }: ZoneActionStripProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <IssueActionMenu
        issueId={issueId}
        mode="hybrid"
        className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5"
      />
    </div>
  );
}
