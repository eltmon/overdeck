/**
 * The cockpit header's one-sentence phase narrative. Detailed pipeline state
 * lives in the pipeline band and right rail; this surface stays plain-language
 * and sits beside the single phase badge.
 */

import { useQuery } from '@tanstack/react-query'
import {
  useIssueCheckRunsQuery,
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


export function StatusNarrative({ issueId, workRunning, hasPlan }: {
  issueId: string
  workRunning: boolean
  hasPlan: boolean
}) {
  const review = useReviewStatusQuery(issueId)
  const ci = useIssueCheckRunsQuery(issueId)
  const plan = useQuery<{ plan?: { items?: Array<{ status: string }> } }>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`)
      if (!res.ok) return {}
      return res.json()
    },
    staleTime: 60_000,
  })
  const items = plan.data?.plan?.items ?? []
  const counts: PlanCounts | undefined = items.length > 0
    ? { done: items.filter((item) => item.status === 'completed').length, total: items.length }
    : undefined

  const model = deriveNarrative({ hasPlan, rs: review.data, ci: ci.data, plan: counts, workRunning })

  return (
    <span
      data-testid="status-narrative"
      data-section="StatusNarrative"
      className="min-w-0 text-[12.5px] text-muted-foreground"
      title={model.next}
    >
      {model.headline}
    </span>
  )
}

export default StatusNarrative
