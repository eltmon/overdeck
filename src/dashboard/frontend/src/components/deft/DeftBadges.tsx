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

/**
 * `spec drift <n>` (Deft's own ledger of uncovered scope work) and
 * `install drift <n>` (hidden install files changed after install, BD-12) on
 * a project-tree row. The row passes its own badge classes, so this module
 * does not import the Command Deck stylesheet.
 */
export function DeftDriftBadges({ issueId, groupClassName, badgeClassName }: { issueId: string; groupClassName: string; badgeClassName: string }) {
  const { summary } = useDeftIssueSummary(issueId);
  const badges = [
    summary && summary.specDriftUnresolved > 0 ? `spec drift ${summary.specDriftUnresolved}` : null,
    summary && summary.installDrift > 0 ? `install drift ${summary.installDrift}` : null,
  ].filter((label): label is string => label !== null);
  if (badges.length === 0) return null;
  return (
    <span data-section="Deft drift badges" className={groupClassName}>
      {badges.map((label) => <span key={label} className={badgeClassName}>{label}</span>)}
    </span>
  );
}
