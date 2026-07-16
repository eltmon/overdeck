import type { ReactNode } from 'react';
import { ReviewPolicyControl } from '../ReviewPolicyControl';
import { ShipProgress } from './ShipProgress';
import { deriveShip } from './derivations';
import { useReviewStatusQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import { sectionsForDensity } from './densitySections';
import type { IssueViewDensity } from './inventory';

interface IssueViewProps {
  issueId: string;
  density: IssueViewDensity;
  children: ReactNode;
  className?: string;
}

/**
 * Shared semantic boundary for the three progressive issue-view densities.
 * Shells retain routing and interaction glue; this component owns density
 * membership and the cross-density policy controls.
 */
export function IssueView({ issueId, density, children, className }: IssueViewProps) {
  return (
    <div className={className} data-component="issue-view" data-density={density}>
      {sectionsForDensity(density).map((section) => (
        <span key={section} hidden data-section={section} />
      ))}
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
