/**
 * ZoneA — issue header zone for the unified Command Deck (PAN-830, pan-11sr).
 *
 * Always-visible top zone. Identifies the issue (id, title, source link),
 * surfaces pipeline state + cost, and exposes the issue-level action buttons.
 *
 * For the Phase-2 shell deliverable this is a thin wrapper around the existing
 * `IssueHeader`. Liveness wiring (cost LiveCounter, sparkline) is pan-d53s
 * components are ready; threading them in here is a follow-up bead.
 */

import { IssueHeader } from './SessionView/IssueHeader';

interface ZoneAProps {
  issueId: string;
  title: string;
  cost?: number;
  source?: string;
  url?: string;
  onOpenBeads?: () => void;
}

export function ZoneA({ issueId, title, cost, source, url, onOpenBeads }: ZoneAProps) {
  return (
    <IssueHeader
      issueId={issueId}
      title={title}
      cost={cost}
      source={source}
      url={url}
      onOpenBeads={onOpenBeads}
    />
  );
}
