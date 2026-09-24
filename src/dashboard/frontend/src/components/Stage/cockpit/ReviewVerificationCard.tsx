import DrawerReviewSpecialists from '../../drawer/DrawerReviewSpecialists'
import { useIssueCheckRunsQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { useDerivedIssueState } from '../../../lib/store'
import type { DerivedIssueState } from '../../../types'
import { CockpitCard, type CockpitTone } from './CockpitCard'

const DOT: Record<CockpitTone, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  review: 'bg-signal-review',
  cost: 'bg-signal-cost',
  muted: 'bg-muted-foreground',
}

/**
 * The PR's review decision, as the forge reports it. The reviewer's verdict is
 * a PR review (FR-7) — there is no stored review status to read.
 */
function reviewStep(issue: DerivedIssueState | undefined): { tone: CockpitTone; label: string } {
  if (issue?.state === 'changes-requested') return { tone: 'destructive', label: 'Changes requested' }
  if (issue?.pr?.reviewState === 'approved') return { tone: 'success', label: 'Approved' }
  if (issue?.state === 'in-review') return { tone: 'warning', label: 'In review' }
  return { tone: 'muted', label: 'No review' }
}

/** Check-run rollup on the PR head (FR-8 reports verification as check runs). */
function checksStep(issue: DerivedIssueState | undefined): { tone: CockpitTone; label: string } {
  switch (issue?.pr?.checks) {
    case 'green': return { tone: 'success', label: 'Green' }
    case 'red': return { tone: 'destructive', label: 'Red' }
    case 'pending': return { tone: 'info', label: 'Running' }
    default: return { tone: 'muted', label: 'No checks' }
  }
}

/** Forge mergeability — the only thing that says whether this can land. */
function mergeStep(issue: DerivedIssueState | undefined): { tone: CockpitTone; label: string } {
  if (issue?.state === 'merged') return { tone: 'success', label: 'Merged' }
  if (issue?.state === 'ready') return { tone: 'warning', label: 'Ready' }
  if (issue?.pr && issue.pr.mergeable === false) return { tone: 'destructive', label: 'Conflicts' }
  return { tone: 'muted', label: 'Not ready' }
}

function Step({ name, tone, label }: { name: string; tone: CockpitTone; label: string }) {
  return (
    <div className="rounded-[12px] border border-border px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{name}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-medium">
        <span className={`h-[7px] w-[7px] rounded-full ${DOT[tone]}`} />
        {label}
      </div>
    </div>
  )
}

const CHECK_TONE: Record<string, string> = {
  passed: 'text-success-foreground',
  failed: 'text-destructive-foreground',
  running: 'text-info-foreground',
}

/**
 * ReviewVerificationCard — the cockpit's "where is this in review and why is it
 * stuck" card. PAN-3917: every figure comes from an owner — the derived issue
 * state for the review decision, mergeability and attention, and the forge's
 * own check runs for the quality gates. Nothing is read back from a record.
 */
export function ReviewVerificationCard({ issueId }: { issueId: string }) {
  const issue = useDerivedIssueState(issueId)
  const checkRuns = useIssueCheckRunsQuery(issueId)
  const actions = useIssueActions(issueId)

  const review = reviewStep(issue)
  const checks = checksStep(issue)
  const merge = mergeStep(issue)
  const summary = checkRuns.data?.summary
  const failing = (checkRuns.data?.checkRuns ?? []).filter(
    (run) => run.conclusion === 'failure' || run.conclusion === 'timed_out',
  )

  const restartReview = actions.all.find((v) => v.action.key === 'restartReview')
  const actionButtons = [restartReview].filter((v): v is IssueActionView => !!v && v.enabled)

  return (
    <CockpitCard
      tone="review"
      title="Review & Verification"
      right={
        summary && summary.total > 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            {summary.passed}/{summary.total} checks
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Step name="Review" tone={review.tone} label={review.label} />
        <Step name="Checks" tone={checks.tone} label={checks.label} />
        <Step name="Merge" tone={merge.tone} label={merge.label} />
      </div>

      {failing.length > 0 && (
        <ul className="mt-2.5 grid gap-1">
          {failing.map((run) => (
            <li key={run.id} className="flex items-center gap-2 rounded-[12px] border border-border px-2.5 py-1.5 text-[12px]">
              <span className={`text-[11px] font-medium ${CHECK_TONE.failed}`}>fail</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{run.name}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <DrawerReviewSpecialists issueId={issueId} />
      </div>

      {actionButtons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actionButtons.map((v) => (
            <button
              key={v.action.key}
              type="button"
              disabled={v.isPending}
              onClick={v.invoke}
              className="inline-flex items-center rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              {v.action.label}
            </button>
          ))}
        </div>
      )}
    </CockpitCard>
  )
}
