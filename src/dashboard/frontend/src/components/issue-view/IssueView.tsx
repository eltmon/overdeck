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
 *
 * PAN-2975: the StartAgentCta block renders ONLY at console density (the
 * drawer's own surface). At rail density FeatureItem mounts it inline in the
 * row's meta line (chip surface); at cockpit density the no-agent surface
 * comes from IssueDetail's DrawerAgentSession empty state. No detached CTA
 * blocks above rows anywhere.
 */
export function IssueView({ issueId, density, children, ...rootProps }: IssueViewProps) {
  const dataComponent = (rootProps as Record<string, unknown>)['data-component'];
  return (
    <div {...rootProps} data-component={typeof dataComponent === 'string' ? dataComponent : 'issue-view'} data-density={density}>
      {(density === 'cockpit' || density === 'console') && (
        <div data-section={density === 'console' ? 'IssuePolicyStrip / PoliciesControl' : 'ReviewPolicyControl'}>
          <ReviewPolicyControl issueId={issueId} />
        </div>
      )}
      {density === 'console' && (
        <div data-section="StartAgentCta"><StartAgentCta issueId={issueId} density={density} /></div>
      )}
      {children}
    </div>
  );
}

export function RailShipProgress({ issueId, onClick }: { issueId: string; onClick: () => void }) {
  const { data } = useReviewStatusQuery(issueId);
  return <ShipProgress ship={deriveShip(data)} compact onClick={onClick} />;
}

export function IssueViewFullscreenButton({
  onClick,
  className,
  ariaLabel = 'Expand issue full screen',
}: {
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  return <button type="button" className={className} aria-label={ariaLabel} title={ariaLabel} onClick={(event) => { event.stopPropagation(); onClick(); }}>⛶</button>;
}
