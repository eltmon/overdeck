/**
 * PAN-2398 — the ONE status narrative. Replaces the cockpit's duplicate
 * pipeline chip row + gates pill row with a single plain-language headline
 * and a "what happens next" line.
 * Design contract: docs/design/mockups/issue-cockpit-redesign.html.
 *
 * Copy rules (binding, from the PRD): no pipeline jargon — never render
 * "verification gate", "merge-ready", "pickup", "released". A failing gate is
 * folded into the headline in plain words; deep detail stays in the Code tab.
 *
 * PAN-2908 C-VOCAB: the five-stage journey strip (Planned→…→Shipping) is gone
 * from the tree, not just the render — the shared IssuePhaseRail beside this
 * narrative is the one phase vocabulary everywhere.
 */

import { useQuery } from '@tanstack/react-query'
import {
  useIssueCheckRunsQuery,
  usePrQuery,
  useReviewStatusQuery,
  type IssueCheckRunsResponse,
  type ReviewStatusData,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'

interface PlanCounts { done: number; total: number }

export interface NarrativeModel {
  headline: string
  next: string
  needsYou: boolean
}

/** Pure narrative derivation — exported for tests. */
export function deriveNarrative(args: {
  hasPlan: boolean
  rs: ReviewStatusData | undefined
  ci: IssueCheckRunsResponse | undefined
  plan: PlanCounts | undefined
  workRunning: boolean
}): NarrativeModel {
  const { hasPlan, rs, ci, plan, workRunning } = args
  const summary = ci?.summary
  const ciFailing = Boolean(summary && (summary.failed || summary.cancelled))
  const progress = plan && plan.total > 0 ? `${plan.done} of ${plan.total} tasks done` : undefined

  let headline: string
  let next: string
  let needsYou = false

  if (rs?.mergeStatus === 'merged') {
    headline = 'Shipped — this change is on main'
    next = 'Wrapping up: closing the issue out.'
  } else if (rs?.readyForMerge) {
    headline = 'Ready to ship — everything passed'
    next = 'Waiting on you: press Merge when you want it on main.'
    needsYou = true
  } else if (rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed') {
    headline = 'The reviewer found problems'
    next = 'The crew is fixing them, then review runs again.'
  } else if (rs?.testStatus === 'failed' || rs?.testStatus === 'dispatch_failed') {
    headline = 'Tests failed'
    next = 'The crew is fixing the failures, then tests run again.'
  } else if (ciFailing) {
    headline = `Automated checks are failing (${summary!.passed}/${summary!.total} passing)`
    next = 'The crew fixes the checks before anything ships.'
  } else if (rs?.reviewStatus === 'reviewing') {
    headline = 'The reviewer is checking the finished work'
    next = 'If it passes, testing is next.'
  } else if (rs?.testStatus === 'testing') {
    headline = 'Testing whether it all works'
    next = 'If tests pass, it lines up to ship.'
  } else if (workRunning || (plan && plan.total > 0 && plan.done < plan.total)) {
    headline = progress ? `The crew is writing code — ${progress}` : 'The crew is writing code'
    next = 'Up next: the reviewer checks the finished work.'
  } else if (!hasPlan) {
    headline = 'Planning what to build'
    next = 'A plan gets written before any code.'
  } else {
    headline = 'Waiting to start'
    next = 'The plan is ready; work begins when it’s picked up.'
  }
  if (!needsYou) next = `${next} Nothing needs you yet.`
  return { headline, next, needsYou }
}


export function detailFragments(args: {
  rs: ReviewStatusData | undefined
  ci: IssueCheckRunsResponse | undefined
  prMergeable: string | null | undefined
  hasPr: boolean
}): string[] {
  const { rs, ci, prMergeable, hasPr } = args
  const fragments: string[] = []
  fragments.push(
    rs?.reviewStatus === 'passed' ? 'review passed ✓'
    : rs?.reviewStatus === 'reviewing' ? 'review in progress'
    : rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed' ? 'review found problems'
    : 'review not started')
  fragments.push(
    rs?.testStatus === 'passed' ? 'tests passed ✓'
    : rs?.testStatus === 'skipped' ? 'tests skipped'
    : rs?.testStatus === 'testing' ? 'tests running'
    : rs?.testStatus === 'failed' || rs?.testStatus === 'dispatch_failed' ? 'tests failed'
    : 'tests not run')
  if (rs?.verificationStatus) {
    fragments.push(
      rs.verificationStatus === 'passed' ? 'build check passed ✓'
      : rs.verificationStatus === 'failed' ? 'build check failed'
      : rs.verificationStatus === 'running' ? 'build check running'
      : 'build check pending')
  }
  const summary = ci?.summary
  fragments.push(!summary || summary.total === 0
    ? 'no automated checks yet'
    : `checks ${summary.passed}/${summary.total}${summary.failed || summary.cancelled ? ' failing' : summary.running || summary.pending ? ' running' : ' ✓'}`)
  const mergeable = (prMergeable ?? '').toUpperCase()
  fragments.push(!hasPr ? 'no PR yet'
    : mergeable === 'MERGEABLE' || mergeable === 'CLEAN' ? 'PR ready ✓'
    : mergeable === 'CONFLICTING' ? 'PR has conflicts'
    : 'PR state unknown')
  fragments.push(rs?.readyForMerge ? 'cleared to ship ✓' : 'not cleared to ship yet')
  return fragments
}

export function StatusNarrative({ issueId, workRunning, hasPlan, cost }: {
  issueId: string
  workRunning: boolean
  hasPlan: boolean
  cost?: string
}) {
  const review = useReviewStatusQuery(issueId)
  const ci = useIssueCheckRunsQuery(issueId)
  const pr = usePrQuery(issueId)
  const plan = useQuery<{ plan?: { items?: Array<{ status: string }> } }>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`)
      if (!res.ok) return {}
      return res.json()
    },
  })
  const items = plan.data?.plan?.items ?? []
  const counts: PlanCounts | undefined = items.length > 0
    ? { done: items.filter((item) => item.status === 'completed').length, total: items.length }
    : undefined

  const model = deriveNarrative({ hasPlan, rs: review.data, ci: ci.data, plan: counts, workRunning })

  return (
    <div data-testid="status-narrative" data-section="StatusNarrative">
      {model.needsYou && (
        <div className="mb-3 rounded-[10px] border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-[12.5px] text-foreground">
          ⚠ <span className="font-semibold">Waiting on you:</span> {model.next}
        </div>
      )}
      <div className="flex items-center gap-3.5">
        <span className={`h-3 w-3 shrink-0 rounded-full ${model.needsYou ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'}`} />
        <div className="min-w-0">
          <div className="truncate font-['Space_Grotesk'] text-[16.5px] font-semibold text-foreground">{model.headline}</div>
          {!model.needsYou && <div className="text-[12.5px] text-muted-foreground">{model.next}</div>}
        </div>
        {cost && (
          <div className="ml-auto text-right">
            <div className="font-['Space_Grotesk'] text-[18px] font-semibold text-foreground">{cost}</div>
            <div className="text-[10.5px] text-muted-foreground">spent so far</div>
          </div>
        )}
      </div>
      {/* PAN-2908 C-VOCAB: the legacy journey strip (Planned→…→Shipping) is
          replaced by the shared IssuePhaseRail mounted beside this narrative
          in the cockpit header — one vocabulary everywhere. */}
      <div className="mt-2 text-[11px] text-muted-foreground/80" data-testid="status-details">
        {detailFragments({ rs: review.data, ci: ci.data, prMergeable: pr.data?.pr?.mergeable, hasPr: Boolean(pr.data?.pr) }).join(' · ')}
      </div>
    </div>
  )
}

export default StatusNarrative
