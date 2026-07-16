/**
 * ShipTab (PAN-2487 / PAN-2499 WI-3) — the Ship & Merge cockpit view.
 *
 * The merge door runs server-side (no agent session), so this panel shows its
 * live progress via the shared ShipProgress component, which is also used as a
 * compact rail row in FeatureItem.
 */
import { useIssueView } from '../../issue-view/useIssueView';
import { ShipProgress } from '../../issue-view/ShipProgress';

export function ShipTab({ issueId }: { issueId: string }) {
  const { ship } = useIssueView(issueId);
  return <ShipProgress ship={ship} />;
}
