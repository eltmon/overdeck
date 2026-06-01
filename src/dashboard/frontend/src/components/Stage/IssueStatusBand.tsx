import { GitPullRequest } from 'lucide-react'
import PhaseTimeline from '../drawer/PhaseTimeline'
import DrawerVerificationGates from '../drawer/DrawerVerificationGates'
import { IssueActionMenu } from '../IssueActionMenu/IssueActionMenu'
import { usePrQuery, useIssueCostsQuery } from '../CommandDeck/ZoneCOverviewTabs/queries'

/**
 * Compact PR link (+diffstat) + cost-to-date chip, pinned top-right of the
 * status band. Uses the same robust query sources as the cockpit body's
 * OverviewTab (resolved cost across issues+activity, full PR details) so the
 * cost shows even when live agents are stopped.
 */
function IssuePrCostChip({ issueId }: { issueId: string }) {
  const prQuery = usePrQuery(issueId)
  const costsQuery = useIssueCostsQuery(issueId)
  const pr = prQuery.data?.pr ?? null
  const cost = costsQuery.data?.resolvedTotalCost ?? null

  return (
    <div className="flex items-center gap-3">
      {pr && (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={`PR #${pr.number} · ${pr.isDraft ? 'draft' : pr.state.toLowerCase()} · +${pr.additions}/-${pr.deletions}`}
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          #{pr.number}
        </a>
      )}
      {cost != null && cost > 0 && (
        <span className="font-mono text-xs font-medium text-foreground" title="Cost to date">
          ${cost.toFixed(2)}
        </span>
      )}
    </div>
  )
}

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
      <div className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-card px-2 py-1.5">
        <IssueActionMenu issueId={issueId} mode="hybrid" />
        <IssuePrCostChip issueId={issueId} />
      </div>
      <DrawerVerificationGates issueId={issueId} />
    </div>
  )
}
