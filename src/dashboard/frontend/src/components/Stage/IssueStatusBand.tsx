import PhaseTimeline from '../drawer/PhaseTimeline'
import DrawerVerificationGates from '../drawer/DrawerVerificationGates'

/**
 * IssueStatusBand — the persistent issue-context header for the Command Deck
 * issue cockpit (remodel S2). Composes the dormant, data-backed drawer
 * components — now issueId-scoped so they read THIS issue without touching the
 * global drawer slice (no legacy IssueDrawer overlay, no URL rewrite).
 *
 * Phase 1 (this commit): PhaseTimeline (6-step pipeline) + VerificationGates
 * (typecheck/lint/test/uat). The operator explicitly wanted these visible.
 * Follow-on: the ~41-action ActionStrip, the PR card, and cost-top-right.
 */
export function IssueStatusBand({ issueId }: { issueId: string }) {
  return (
    <div className="flex flex-col gap-2">
      <PhaseTimeline issueId={issueId} />
      <DrawerVerificationGates issueId={issueId} />
    </div>
  )
}
