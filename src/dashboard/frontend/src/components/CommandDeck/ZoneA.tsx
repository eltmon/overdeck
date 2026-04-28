/**
 * ZoneA — issue header zone for the unified Command Deck (PAN-830, pan-11sr).
 *
 * Always-visible top zone. Identifies the issue (id, title, source link),
 * surfaces pipeline state + cost, and exposes the issue-level action buttons
 * via <ZoneActionStrip> so every canonical action is reachable from Zone A.
 */

import type { Agent, Issue } from '../../types';
import type { OverviewTab } from './ZoneCOverview';
import { IssueHeader } from './SessionView/IssueHeader';
import { ZoneActionStrip } from './ZoneActionStrip';

interface ZoneAProps {
  issueId: string;
  title: string;
  source?: string;
  url?: string;
  onOpenBeads?: () => void;
  /** Work agent for this issue — drives action strip visibility. */
  agent?: Agent;
  /** Full issue record — drives danger-zone gating and status. */
  issue?: Issue;
  /** Called when an artifact action wants to switch a ZoneC tab. */
  onSwitchTab?: (tab: OverviewTab) => void;
}

export function ZoneA({
  issueId,
  title,
  source,
  url,
  onOpenBeads,
  agent,
  issue,
  onSwitchTab,
}: ZoneAProps) {
  return (
    <div data-testid="zone-a">
      <IssueHeader
        issueId={issueId}
        title={title}
        source={source}
        url={url}
        onOpenBeads={onOpenBeads}
      />
      <ZoneActionStrip
        issueId={issueId}
        agent={agent}
        issue={issue}
        onOpenBeads={onOpenBeads}
        onSwitchTab={onSwitchTab}
      />
    </div>
  );
}
