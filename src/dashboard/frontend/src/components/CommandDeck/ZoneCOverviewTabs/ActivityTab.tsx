import { DeftFinishLoopFeed } from '../../deft/DeftFinishLoopFeed';
import { ActivityFeedSidebar } from '../ActivityFeedSidebar';

interface ActivityTabProps {
  issueId: string;
}

export function ActivityTab({ issueId }: ActivityTabProps) {
  return (
    <div data-testid="activity-tab" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <DeftFinishLoopFeed issueId={issueId} />
      <ActivityFeedSidebar issueId={issueId} />
    </div>
  );
}
