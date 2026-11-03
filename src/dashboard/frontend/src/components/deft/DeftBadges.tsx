/**
 * Small Deft badges for existing rows (PAN-4849 WI-14, WI-15). Labels are
 * neutral: only existing state badges carry color.
 */
import { CockpitPill } from '../Stage/cockpit/CockpitCard';
import { useDeftIssueSummary } from './queries';

/** `Deft: <handoffState>` in the phase rail's ship cell, for a Deft issue with a delivery state. */
export function DeftDeliveryChip({ issueId }: { issueId: string }) {
  const { summary } = useDeftIssueSummary(issueId);
  if (!summary?.handoffState) return null;
  return <CockpitPill tone="muted" className="mt-1.5">Deft: {summary.handoffState}</CockpitPill>;
}
