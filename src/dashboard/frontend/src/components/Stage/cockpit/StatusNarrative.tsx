/**
 * The cockpit header's one-sentence phase narrative. Detailed pipeline state
 * lives in the pipeline band and right rail; this surface stays plain-language
 * and sits beside the single phase badge.
 */

import { useQuery } from '@tanstack/react-query'
import {
  useIssueCheckRunsQuery,
  type IssueCheckRunsResponse,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useDerivedIssueState } from '../../../lib/store'
import type { DerivedIssueState } from '../../../types'

interface PlanCounts { done: number; total: number }

export interface NarrativeModel {
  headline: string
  next: string
  needsYou: boolean
}

/** Pure narrative derivation — exported for tests. */
export function deriveNarrative(args: {
  hasPlan: boolean
  issue: DerivedIssueState | undefined
  ci: IssueCheckRunsResponse | undefined
  plan: PlanCounts | undefined
  workRunning: boolean
}): NarrativeModel {
  const { hasPlan, issue, ci, plan, workRunning } = args
  const summary = ci?.summary
  const ciFailing = Boolean(summary && (summary.failed || summary.cancelled))
  const progress = plan && plan.total > 0 ? `${plan.done} of ${plan.total} tasks done` : undefined

  let headline: string
  let next: string
  let needsYou = false

  if (issue?.state === 'merged') {
    headline = 'Shipped — this change is on main'
    next = 'Wrapping up: closing the issue out.'
  } else if (issue?.state === 'ready') {
    headline = 'Ready to ship — everything passed'
    next = 'Waiting on you: press Merge when you want it on main.'
    needsYou = true
  } else if (issue?.state === 'changes-requested') {
    headline = 'The reviewer asked for changes'
    next = 'The crew is addressing them, then review runs again.'
  } else if (ciFailing) {
    headline = `Automated checks are failing (${summary!.passed}/${summary!.total} passing)`
    next = 'The crew fixes the checks before anything ships.'
  } else if (issue?.state === 'in-review') {
    headline = 'The reviewer is checking the finished work'
    next = 'If it passes, it lines up to ship.'
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
  const issue = useDerivedIssueState(issueId)
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

  const model = deriveNarrative({ hasPlan, issue, ci: ci.data, plan: counts, workRunning })

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
