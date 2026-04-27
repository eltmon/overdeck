import { ActivityFeed } from '../../GodView/ActivityFeed';

import type { Issue } from '../../../types';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';

interface ActivityTabProps {
  issueId: string;
  issues?: readonly Issue[];
  featureData?: ProjectFeature | null;
}

export function ActivityTab({ issueId }: ActivityTabProps) {
  return (
    <div data-testid="activity-tab" data-issue-id={issueId} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 16 }}>
      <ActivityFeed />
    </div>
  );
}
