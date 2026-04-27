import type { Issue } from '../../../types';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';
import { ActivityView } from '../ActivityView';

interface ActivityTabProps {
  issueId: string;
  issues?: readonly Issue[];
  featureData?: ProjectFeature | null;
}

export function ActivityTab({ issueId, issues, featureData }: ActivityTabProps) {
  return (
    <div data-testid="activity-tab" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ActivityView
        issueId={issueId}
        issues={issues ? [...issues] : undefined}
        featureData={featureData}
      />
    </div>
  );
}
