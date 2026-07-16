import type { HTMLAttributes, ReactNode } from 'react';
import { ReviewPolicyControl } from '../ReviewPolicyControl';
import { ShipProgress } from './ShipProgress';
import { deriveShip } from './derivations';
import { useReviewStatusQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import type { IssueViewDensity } from './inventory';

interface IssueViewProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  issueId: string;
  density: IssueViewDensity;
  children: ReactNode;
}

/**
 * Shared semantic boundary for the three progressive issue-view densities.
 * Shells retain routing and interaction glue; this component owns density
 * membership and the cross-density policy controls.
 */
export function IssueView({ issueId, density, children, ...rootProps }: IssueViewProps) {
  return (
    <div {...rootProps} data-component={rootProps['data-component'] ?? 'issue-view'} data-density={density}>
      {(density === 'cockpit' || density === 'console') && (
        <div data-section="ReviewPolicyControl">
          <ReviewPolicyControl issueId={issueId} />
        </div>
      )}
      {children}
    </div>
  );
}

export function RailShipProgress({ issueId, onClick }: { issueId: string; onClick: () => void }) {
  const { data } = useReviewStatusQuery(issueId);
  return <ShipProgress ship={deriveShip(data)} compact onClick={onClick} />;
}
