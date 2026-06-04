import PhaseTimeline from '../drawer/PhaseTimeline'
import { IssueActionMenu } from '../IssueActionMenu/IssueActionMenu'
import { IssueBlockerSpotlight } from './cockpit/IssueBlockerSpotlight'
import { IssueMetricStrip } from './cockpit/IssueMetricStrip'

/**
 * IssueStatusBand — the always-on GLANCE layer of the issue cockpit (Command
 * Deck remodel S3). Answers, at a glance: where is this in its lifecycle, is
 * anything blocking it, what are the headline numbers, and what can I do next.
 *
 *   1. BlockerSpotlight — the #1 thing right now (stuck reason + unblock action,
 *      or "ready to merge"); renders nothing when neither applies.
 *   2. PhaseTimeline — 6-step lifecycle (TRIAGED→…→MERGED).
 *   3. MetricStrip — cost · diff · PR · sessions · last-activity, single-sourced
 *      so the scan cards below never repeat these figures.
 *   4. ActionStrip — the phase-gated action registry (IssueActionMenu, hybrid).
 *
 * Verification gates, the PR card, and the cost breakdown deliberately live in
 * the SCAN cards below — the band states each figure exactly once.
 */
export function IssueStatusBand({ issueId }: { issueId: string }) {
  return (
    <div className="flex flex-col">
      <IssueBlockerSpotlight issueId={issueId} />
      <div className="mt-4">
        <PhaseTimeline issueId={issueId} />
      </div>
      <IssueMetricStrip issueId={issueId} />
      <div className="mt-4 rounded-[var(--radius)] border border-border bg-card px-2 py-1.5">
        <IssueActionMenu issueId={issueId} mode="hybrid" />
      </div>
    </div>
  )
}
