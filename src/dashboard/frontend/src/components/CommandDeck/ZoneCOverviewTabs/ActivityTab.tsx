import { ActivityFeed } from '../../GodView/ActivityFeed';

interface ActivityTabProps {
  issueId: string;
}

export function ActivityTab({ issueId }: ActivityTabProps) {
  return (
    <div data-testid="activity-tab" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ActivityFeed issueId={issueId} />
    </div>
  );
}
