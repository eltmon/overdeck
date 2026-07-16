import type { HTMLAttributes, ReactNode } from 'react';
import { ReviewPolicyControl } from '../ReviewPolicyControl';
import { ShipProgress } from './ShipProgress';
import { deriveShip } from './derivations';
import { useReviewStatusQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import type { IssueViewDensity } from './inventory';
import { StartAgentCta } from './StartAgentCta';

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
  const dataComponent = (rootProps as Record<string, unknown>)['data-component'];
  return (
    <div {...rootProps} data-component={typeof dataComponent === 'string' ? dataComponent : 'issue-view'} data-density={density}>
      {(density === 'cockpit' || density === 'console') && (
        <div data-section="ReviewPolicyControl">
          <ReviewPolicyControl issueId={issueId} />
        </div>
      )}
      <StartAgentCta issueId={issueId} density={density} />
      {children}
    </div>
  );
}

export function RailShipProgress({ issueId, onClick }: { issueId: string; onClick: () => void }) {
  const { data } = useReviewStatusQuery(issueId);
  return <ShipProgress ship={deriveShip(data)} compact onClick={onClick} />;
}

export function IssueViewFullscreenButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return <button type="button" className={className} aria-label="Expand issue full screen" title="Expand issue full screen" onClick={(event) => { event.stopPropagation(); onClick(); }}>⛶</button>;
}
