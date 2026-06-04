import DrawerReviewSpecialists from '../../drawer/DrawerReviewSpecialists'
import { useReviewStatusQuery, type ReviewStatusData } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { CockpitCard, type CockpitTone } from './CockpitCard'

type GateStatus = 'passed' | 'failed' | 'pending' | 'running' | 'skipped'
const QUALITY_GATES = ['typecheck', 'lint', 'test'] as const

function vToGate(s: string | undefined): GateStatus {
  if (s === 'passed') return 'passed'
  if (s === 'failed') return 'failed'
  if (s === 'running') return 'running'
  if (s === 'skipped') return 'skipped'
  return 'pending'
}

/**
 * Derive the four verification gates (typecheck/lint/test/uat) from the
 * authoritative review-status API — same logic as useDrawerData but sourced
 * from React Query so it stays consistent with the stepper/spotlight and does
 * not depend on Zustand store hydration. UAT has no API field yet → pending.
 */
function deriveGates(rs: ReviewStatusData | undefined): { id: string; status: GateStatus }[] {
  const v = rs?.verificationStatus
  let quality: { id: string; status: GateStatus }[]
  if (v === 'failed') {
    const m = rs?.verificationNotes?.match(/Verification FAILED at (typecheck|lint|test)\b/i)
    const failedIdx = m ? QUALITY_GATES.indexOf(m[1].toLowerCase() as (typeof QUALITY_GATES)[number]) : -1
    quality = QUALITY_GATES.map((id, i) => ({
      id,
      status: failedIdx < 0 ? 'failed' : i < failedIdx ? 'passed' : i === failedIdx ? 'failed' : 'pending',
    }))
  } else {
    const st = vToGate(v)
    quality = QUALITY_GATES.map((id) => ({ id, status: st }))
  }
  return [...quality, { id: 'uat', status: 'pending' as GateStatus }]
}

const GATE_TONE: Record<GateStatus, { cls: string; label: string }> = {
  passed: { cls: 'text-success-foreground', label: 'pass' },
  failed: { cls: 'text-destructive-foreground', label: 'fail' },
  running: { cls: 'text-info-foreground', label: 'running' },
  skipped: { cls: 'text-muted-foreground', label: 'skipped' },
  pending: { cls: 'text-muted-foreground', label: 'pending' },
}

const DOT: Record<CockpitTone, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  review: 'bg-signal-review',
  cost: 'bg-signal-cost',
  muted: 'bg-muted-foreground',
}

/** Map a pipeline status string → tone + display label. */
function statusTone(status: string | undefined): { tone: CockpitTone; label: string } {
  switch (status) {
    case 'passed':
    case 'merged':
      return { tone: 'success', label: status === 'merged' ? 'Merged' : 'Passed' }
    case 'blocked':
      return { tone: 'destructive', label: 'Blocked' }
    case 'failed':
    case 'dispatch_failed':
      return { tone: 'destructive', label: 'Failed' }
    case 'reviewing':
    case 'testing':
    case 'running':
    case 'merging':
    case 'verifying':
    case 'queued':
      return { tone: 'info', label: status.charAt(0).toUpperCase() + status.slice(1) }
    case 'skipped':
      return { tone: 'muted', label: 'Skipped' }
    default:
      return { tone: 'muted', label: 'Pending' }
  }
}

function Step({ name, status }: { name: string; status: string | undefined }) {
  const { tone, label } = statusTone(status)
  return (
    <div className="rounded-[12px] border border-border px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{name}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold">
        <span className={`h-[7px] w-[7px] rounded-full ${DOT[tone]}`} />
        {label}
      </div>
    </div>
  )
}

/**
 * ReviewVerificationCard — the cockpit's "where is this in review and why is it
 * stuck" card. Merges what used to be four separate body sections (pipeline
 * stepper + verification gates + reviewer grid + tests) into one, so the figure
 * isn't repeated. (Command Deck remodel S3.)
 */
export function ReviewVerificationCard({ issueId }: { issueId: string }) {
  const rs = useReviewStatusQuery(issueId)
  const actions = useIssueActions(issueId)
  const data = rs.data

  const cycle = data?.verificationCycleCount
  const maxCycle = data?.verificationMaxCycles
  const finding =
    data?.reviewStatus === 'blocked' || data?.reviewStatus === 'failed'
      ? data?.reviewNotes?.trim()
      : undefined

  const gates = deriveGates(data)
  const reviewTest = actions.all.find((v) => v.action.key === 'reviewTest')
  const restartReview = actions.all.find((v) => v.action.key === 'restartReview')
  const actionButtons = [reviewTest, restartReview].filter(
    (v): v is IssueActionView => !!v && v.enabled,
  )

  return (
    <CockpitCard
      tone="review"
      title="Review & Verification"
      right={
        typeof cycle === 'number' ? (
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            cycle {cycle}{maxCycle ? `/${maxCycle}` : ''}
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Step name="Build gate" status={data?.verificationStatus} />
        <Step name="Review" status={data?.reviewStatus} />
        <Step name="Tests" status={data?.testStatus} />
        <Step name="Merge" status={data?.mergeStatus} />
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-2">
        {gates.map((g) => {
          const tone = GATE_TONE[g.status]
          return (
            <div key={g.id} className="rounded-[12px] border border-border px-2 py-2 text-center">
              <div className={`text-[11px] font-semibold ${tone.cls}`}>{tone.label}</div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.06em] text-muted-foreground">{g.id}</div>
            </div>
          )
        })}
      </div>

      <div className="mt-3">
        <DrawerReviewSpecialists issueId={issueId} />
      </div>

      {finding && (
        <div className="mt-3 rounded-r-[10px] border-l-2 border-destructive/60 bg-destructive/[0.06] px-3 py-2 text-[12px] leading-snug">
          <span className="font-semibold text-destructive-foreground">Blocking finding</span>
          <span className="text-foreground/85"> — {finding}</span>
        </div>
      )}

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
