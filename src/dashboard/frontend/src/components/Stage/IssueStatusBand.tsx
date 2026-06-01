import PhaseTimeline from '../drawer/PhaseTimeline'
import DrawerVerificationGates from '../drawer/DrawerVerificationGates'
import { IssueActionMenu } from '../IssueActionMenu/IssueActionMenu'

/**
 * IssueStatusBand — the persistent issue-context header for the Command Deck
 * issue cockpit (remodel S2). Composes the dormant, data-backed drawer
 * components — now issueId-scoped so they read THIS issue without touching the
 * global drawer slice (no legacy IssueDrawer overlay, no URL rewrite).
 *
 * - PhaseTimeline: 6-step pipeline (TRIAGED→…→MERGED).
 * - ActionStrip: the phase-gated ~41-action registry via IssueActionMenu in
 *   `hybrid` mode (primary actions inline + ⋮ overflow).
 * - VerificationGates: typecheck / lint / test / uat.
 * The operator explicitly wanted gates + phase + actions visible.
 * Follow-on: PR card + cost-top-right.
 */
export function IssueStatusBand({ issueId }: { issueId: string }) {
  return (
    <div className="flex flex-col gap-2">
      <PhaseTimeline issueId={issueId} />
      <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-2 py-1.5">
        <IssueActionMenu issueId={issueId} mode="hybrid" />
      </div>
      <DrawerVerificationGates issueId={issueId} />
    </div>
  )
}
