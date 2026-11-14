import type { HTMLAttributes, ReactNode } from 'react';
import { ShipProgress } from './ShipProgress';
import { deriveShip } from './derivations';
import { useDerivedIssueState } from '../../lib/store';
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
 *
 * PAN-5244: `IssueView` renders no start surface of its own. At console
 * density (the drawer) the start and resume surface is the Conversation tab's
 * (`DrawerAgentSession`, conversation-header layout); at rail density
 * `FeatureItem` mounts the chip inline; at cockpit density it is
 * `DrawerAgentSession`'s empty state.
 */
export function IssueView({ issueId: _issueId, density, children, ...rootProps }: IssueViewProps) {
  const dataComponent = (rootProps as Record<string, unknown>)['data-component'];
  return (
    <div {...rootProps} data-component={typeof dataComponent === 'string' ? dataComponent : 'issue-view'} data-density={density}>
      {children}
    </div>
  );
}

export function RailShipProgress({ issueId, onClick }: { issueId: string; onClick: () => void }) {
  const derived = useDerivedIssueState(issueId);
  return <ShipProgress ship={deriveShip(derived)} compact onClick={onClick} />;
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
