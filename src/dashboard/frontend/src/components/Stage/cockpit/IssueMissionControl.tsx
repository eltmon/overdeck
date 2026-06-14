import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityTab } from '../../CommandDeck/ZoneCOverviewTabs/ActivityTab'
import { BeadsTab } from '../../CommandDeck/ZoneCOverviewTabs/BeadsTab'
import { CostsTab } from '../../CommandDeck/ZoneCOverviewTabs/CostsTab'
import { DiscussionsTab } from '../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import { PrDiffTab, statusColor } from '../../CommandDeck/ZoneCOverviewTabs/PrDiffTab'
import { VBriefTab } from '../../CommandDeck/ZoneCOverviewTabs/VBriefTab'
import {
  useActivityQuery,
  useIssueCheckRunsQuery,
  useIssueCostsQuery,
  usePlanningQuery,
  usePrQuery,
  useReviewStatusQuery,
  type IssueCheckRun,
  type IssueCheckRunsResponse,
  type PullRequestData,
  type ReviewStatusData,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import DrawerArtifactsPanel from '../../drawer/DrawerArtifactsPanel'
import DrawerReviewSpecialists from '../../drawer/DrawerReviewSpecialists'
import { MergeButton } from '../../MergeButton'
import { IssueActionDialogHost } from '../../IssueActionMenu/IssueActionMenu'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import type { PaneType } from '../../../lib/panesStore'
import { ISSUE_ACTIONS, type IssueActionGroup } from '../../../lib/issueActions'
import { IssueBlockerSpotlight } from './IssueBlockerSpotlight'
import { ReviewVerificationCard } from './ReviewVerificationCard'
import { StatusHistoryTab } from './StatusHistoryTab'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'
import styles from './cockpitBody.module.css'

export interface IssueMissionControlProps {
  issueId: string
  title: string
  branch: string
  /** Active project name for the breadcrumb (e.g. "panopticon-cli"). */
  projectName?: string
  launcher: ReactNode
  agentDock: ReactNode
  actionDock: ReactNode
  timeline: ReactNode
  onOpenPane: (paneType: PaneType) => void
}

type MissionTab =
  | 'overview'
  | 'review'
  | 'test'
  | 'ci'
  | 'conversation'
  | 'diff'
  | 'files'
  | 'terminal'
  | 'plan'
  | 'beads'
  | 'discussion'
  | 'costs'
  | 'activity'
  | 'artifacts'
  | 'history'

type PipelineState = 'done' | 'active' | 'fail' | 'todo'

type PipelinePhaseKey = 'plan' | 'work' | 'review' | 'test' | 'ci' | 'ship' | 'merge'

type IssueTreeContext = 'issue' | 'work' | 'review' | 'test' | 'ci' | 'plan' | 'beads' | 'activity'

const TABS: Array<{ id: MissionTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'review', label: 'Review' },
  { id: 'test', label: 'Test' },
  { id: 'ci', label: 'PR & CI' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'diff', label: 'Diff' },
  { id: 'files', label: 'Files' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'plan', label: 'PRD / Plan' },
  { id: 'beads', label: 'Beads' },
  { id: 'discussion', label: 'Discussion' },
  { id: 'costs', label: 'Costs' },
  { id: 'activity', label: 'Activity' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'history', label: 'History' },
]

const GROUP_LABELS: Record<IssueActionGroup, string> = {
  planning: 'Planning',
  work: 'Work',
  review: 'Review & Test',
  agent: 'Agent',
  workspace: 'Workspace',
  artifacts: 'Artifacts',
  navigation: 'Navigation',
  danger: 'Danger',
  preserved: 'Preserved',
}

const GROUP_ORDER: IssueActionGroup[] = [
  'planning',
  'work',
  'review',
  'agent',
  'workspace',
  'artifacts',
  'navigation',
  'danger',
  'preserved',
]

// Explicit, literal Tailwind classes — interpolated utilities get purged.
const PROGRESS_BAR_CLASS: Record<PipelineState, string> = {
  done: 'bg-success',
  active: 'bg-signal-review animate-pulse',
  fail: 'bg-destructive',
  todo: 'bg-muted',
}

const PROGRESS_TICK_CLASS: Record<PipelineState, string> = {
  done: 'border-success/50 bg-success/15 text-success-foreground',
  active: 'border-signal-review/50 bg-signal-review/15 text-signal-review-foreground',
  fail: 'border-destructive/50 bg-destructive/15 text-destructive-foreground',
  todo: 'border-border bg-muted/30 text-muted-foreground',
}

type GateTone = 'ok' | 'bad' | 'run' | 'wait'

const GATE_DOT: Record<GateTone, string> = {
  ok: 'bg-success',
  bad: 'bg-destructive',
  run: 'bg-signal-review',
  wait: 'bg-muted-foreground',
}

function statusToTone(status: string | undefined | null): CockpitTone {
  const normalized = (status ?? '').toLowerCase()
  if (['passed', 'success', 'completed', 'merged', 'ready'].includes(normalized)) return 'success'
  if (['failed', 'blocked', 'dispatch_failed', 'timed_out', 'action_required', 'startup_failure', 'failure'].includes(normalized)) return 'destructive'
  if (['running', 'reviewing', 'testing', 'queued', 'merging', 'verifying', 'in_progress'].includes(normalized)) return 'info'
  if (['skipped', 'neutral', 'cancelled'].includes(normalized)) return 'muted'
  return 'warning'
}

function pipelineGlyph(state: PipelineState): string {
  if (state === 'done') return '✓'
  if (state === 'fail') return '✕'
  if (state === 'active') return '◆'
  return '○'
}

function pipelineTone(state: PipelineState): string {
  if (state === 'done') return 'border-success/40 bg-success/10 text-success-foreground'
  if (state === 'fail') return 'border-destructive/40 bg-destructive/10 text-destructive-foreground'
  if (state === 'active') return 'border-signal-review/40 bg-signal-review/10 text-signal-review-foreground'
  return 'border-border bg-muted/30 text-muted-foreground'
}

function checkRunLabel(run: Pick<IssueCheckRun, 'status' | 'conclusion'>): string {
  if (run.status !== 'completed') return run.status.replace(/_/g, ' ')
  return (run.conclusion ?? 'unknown').replace(/_/g, ' ')
}

function phaseStatus(rs: ReviewStatusData | undefined) {
  if (!rs) return 'pending'
  if (rs.mergeStatus === 'merged') return 'merged'
  if (rs.mergeStatus === 'merging' || rs.mergeStatus === 'queued' || rs.mergeStatus === 'verifying') return rs.mergeStatus
  if (rs.testStatus === 'testing') return 'testing'
  if (rs.reviewStatus === 'reviewing') return 'reviewing'
  if (rs.reviewStatus === 'blocked' || rs.reviewStatus === 'failed') return rs.reviewStatus
  if (rs.testStatus === 'failed' || rs.testStatus === 'dispatch_failed') return rs.testStatus
  if (rs.readyForMerge) return 'ready'
  return rs.reviewStatus ?? 'pending'
}

/**
 * Single source of truth for the seven pipeline-phase states. Both the
 * command-bar progress bar and the left lane read from here so they never
 * disagree on whether Review is blocked, CI is green, etc.
 */
function computePipelineStates(args: {
  hasPlan: boolean
  rs: ReviewStatusData | undefined
  ci: IssueCheckRunsResponse | undefined
  work: { status: string } | undefined
}): Record<PipelinePhaseKey, PipelineState> {
  const { hasPlan, rs, ci, work } = args
  const review: PipelineState = rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed'
    ? 'fail'
    : rs?.reviewStatus === 'reviewing'
      ? 'active'
      : rs?.reviewStatus === 'passed'
        ? 'done'
        : 'todo'
  const test: PipelineState = rs?.testStatus === 'failed' || rs?.testStatus === 'dispatch_failed'
    ? 'fail'
    : rs?.testStatus === 'testing'
      ? 'active'
      : rs?.testStatus === 'passed' || rs?.testStatus === 'skipped'
        ? 'done'
        : 'todo'
  const summary = ci?.summary
  const ciState: PipelineState = summary && (summary.failed || summary.cancelled)
    ? 'fail'
    : summary && (summary.running || summary.pending)
      ? 'active'
      : summary && summary.total
        ? 'done'
        : 'todo'
  const ship: PipelineState = rs?.mergeStatus === 'failed'
    ? 'fail'
    : rs?.mergeStatus === 'queued' || rs?.mergeStatus === 'merging' || rs?.mergeStatus === 'verifying'
      ? 'active'
      : rs?.mergeStatus === 'merged'
        ? 'done'
        : 'todo'
  return {
    plan: hasPlan ? 'done' : 'todo',
    work: work?.status === 'running' ? 'active' : work ? 'done' : 'todo',
    review,
    test,
    ci: ciState,
    ship,
    merge: rs?.mergeStatus === 'merged' ? 'done' : rs?.readyForMerge ? 'active' : 'todo',
  }
}

function activePhaseLabel(states: Record<PipelinePhaseKey, PipelineState>): string {
  const order: Array<[string, PipelineState]> = [
    ['Plan', states.plan],
    ['Work', states.work],
    ['Review', states.review],
    ['Test', states.test],
    ['CI/CD', states.ci],
    ['Ship', states.ship],
    ['Merge', states.merge],
  ]
  const failed = order.find(([, s]) => s === 'fail')
  if (failed) return `${failed[0]} (failed)`
  const active = order.find(([, s]) => s === 'active')
  if (active) return `${active[0]} (in progress)`
  const todo = order.find(([, s]) => s === 'todo')
  if (todo) return `${todo[0]} (pending)`
  return 'Merged'
}

function nextAction(rs: ReviewStatusData | undefined): string {
  if (!rs) return 'start work'
  if (rs.mergeStatus === 'merged') return 'merged — close out'
  if (rs.readyForMerge) return 'merge to main'
  if (rs.reviewStatus === 'blocked' || rs.reviewStatus === 'failed') return 'work agent fixes → re-review'
  if (rs.reviewStatus === 'reviewing') return 'review in progress'
  if (rs.testStatus === 'testing') return 'test in progress'
  if (rs.testStatus === 'failed' || rs.testStatus === 'dispatch_failed') return 'fix tests → re-run'
  if (rs.reviewStatus === 'passed' && rs.testStatus !== 'passed' && rs.testStatus !== 'skipped') return 'dispatch test'
  return 'awaiting pipeline'
}

function mergeBlockReason(rs: ReviewStatusData | undefined): string {
  if (!rs) return 'status unknown'
  if (rs.mergeStatus === 'merged') return 'merged'
  if (rs.reviewStatus === 'blocked' || rs.reviewStatus === 'failed') return 'blocked by review'
  if (rs.testStatus === 'failed' || rs.testStatus === 'dispatch_failed') return 'test failed'
  if (rs.reviewStatus !== 'passed') return 'review pending'
  if (rs.testStatus === 'pending' || rs.testStatus === 'testing') return 'test pending'
  return 'not ready'
}

function computeGates(
  rs: ReviewStatusData | undefined,
  ci: IssueCheckRunsResponse | undefined,
  pr: Pick<PullRequestData, 'mergeable'> | null,
): Array<{ label: string; value: string; tone: GateTone }> {
  const review: { value: string; tone: GateTone } = rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed'
    ? { value: (rs?.reviewStatus ?? '').toUpperCase(), tone: 'bad' }
    : rs?.reviewStatus === 'reviewing'
      ? { value: 'reviewing', tone: 'run' }
      : rs?.reviewStatus === 'passed'
        ? { value: 'passed', tone: 'ok' }
        : { value: 'pending', tone: 'wait' }
  const test: { value: string; tone: GateTone } = rs?.testStatus === 'failed' || rs?.testStatus === 'dispatch_failed'
    ? { value: 'failed', tone: 'bad' }
    : rs?.testStatus === 'testing'
      ? { value: 'testing', tone: 'run' }
      : rs?.testStatus === 'passed' || rs?.testStatus === 'skipped'
        ? { value: rs.testStatus, tone: 'ok' }
        : { value: 'pending', tone: 'wait' }
  const verify: { value: string; tone: GateTone } = rs?.verificationStatus === 'passed'
    ? { value: 'passed', tone: 'ok' }
    : rs?.verificationStatus === 'failed'
      ? { value: 'failed', tone: 'bad' }
      : rs?.verificationStatus === 'running'
        ? { value: 'running', tone: 'run' }
        : { value: 'pending', tone: 'wait' }
  const summary = ci?.summary
  const ciGate: { value: string; tone: GateTone } = !summary || summary.total === 0
    ? { value: 'no checks', tone: 'wait' }
    : summary.failed || summary.cancelled
      ? { value: `${summary.passed}/${summary.total}`, tone: 'bad' }
      : summary.running || summary.pending
        ? { value: `${summary.passed}/${summary.total}`, tone: 'run' }
        : { value: `${summary.passed}/${summary.total} ✓`, tone: 'ok' }
  const mergeable = (pr?.mergeable ?? '').toUpperCase()
  const prGate: { value: string; tone: GateTone } = !pr
    ? { value: 'no PR', tone: 'wait' }
    : mergeable === 'MERGEABLE' || mergeable === 'CLEAN'
      ? { value: 'mergeable', tone: 'ok' }
      : mergeable === 'CONFLICTING'
        ? { value: 'conflicting', tone: 'bad' }
        : { value: 'unknown', tone: 'wait' }
  const mergeReady: { value: string; tone: GateTone } = rs?.readyForMerge
    ? { value: 'yes', tone: 'ok' }
    : { value: 'no', tone: 'bad' }
  return [
    { label: 'Review', ...review },
    { label: 'Test', ...test },
    { label: 'Verification', ...verify },
    { label: 'CI', ...ciGate },
    { label: 'PR', ...prGate },
    { label: 'Merge-ready', ...mergeReady },
  ]
}

function HeaderStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-right">
      <div className="text-[9px] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="text-[11px] font-semibold text-foreground">{value}</div>
    </div>
  )
}

function MergeCta({ issueId, rs }: { issueId: string; rs: ReviewStatusData | undefined }) {
  if (rs?.mergeStatus === 'merged') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border badge-border-success badge-bg-success px-3 py-2 text-[12px] font-semibold text-success-foreground">
        ✓ Merged
      </span>
    )
  }
  if (rs?.readyForMerge) {
    return <MergeButton issueId={issueId} reviewStatus={rs} variant="inspector" />
  }
  const reason = mergeBlockReason(rs)
  return (
    <button
      type="button"
      disabled
      title={`Merge gated: ${reason}`}
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-muted/40 px-3 py-2 text-[12px] font-semibold text-muted-foreground opacity-80"
    >
      ⛔ Merge — {reason}
    </button>
  )
}

function PipelineProgressBar({ issueId }: { issueId: string }) {
  const review = useReviewStatusQuery(issueId)
  const ci = useIssueCheckRunsQuery(issueId)
  const activity = useActivityQuery(issueId)
  const actions = useIssueActions(issueId)
  const work = activity.data?.sections.find((section) => section.type === 'work')
  const states = computePipelineStates({ hasPlan: actions.state.hasPlan, rs: review.data, ci: ci.data, work })
  const summary = ci.data?.summary
  const segments: Array<{ label: string; sub?: string; state: PipelineState }> = [
    { label: 'Plan', sub: states.plan === 'done' ? 'approved' : undefined, state: states.plan },
    { label: 'Work', sub: states.work === 'done' ? 'done' : states.work === 'active' ? 'running' : undefined, state: states.work },
    { label: 'Review', sub: review.data?.reviewStatus, state: states.review },
    { label: 'Test', sub: review.data?.testStatus, state: states.test },
    { label: 'CI/CD', sub: summary?.total ? `${summary.passed}/${summary.total}` : undefined, state: states.ci },
    { label: 'Ship', sub: review.data?.mergeStatus && review.data.mergeStatus !== 'pending' ? review.data.mergeStatus : undefined, state: states.ship },
    { label: 'Merge', sub: states.merge === 'active' ? 'ready' : undefined, state: states.merge },
  ]
  return (
    <div className="flex items-stretch gap-1.5" data-testid="cockpit-pipeline-progress">
      {segments.map((seg) => (
        <div key={seg.label} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border text-[9px] ${PROGRESS_TICK_CLASS[seg.state]}`}>
              {pipelineGlyph(seg.state)}
            </span>
            <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">
              <span className="font-semibold text-foreground">{seg.label}</span>
              {seg.sub ? ` ${seg.sub}` : ''}
            </span>
          </div>
          <div className={`h-[5px] rounded-full ${PROGRESS_BAR_CLASS[seg.state]}`} />
        </div>
      ))}
    </div>
  )
}

function GatesRow({ issueId }: { issueId: string }) {
  const review = useReviewStatusQuery(issueId)
  const ci = useIssueCheckRunsQuery(issueId)
  const pr = usePrQuery(issueId)
  const gates = computeGates(review.data, ci.data, pr.data?.pr ?? null)
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="cockpit-gates">
      {gates.map((gate) => (
        <span key={gate.label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px]">
          <span className={`h-2 w-2 rounded-[2px] ${GATE_DOT[gate.tone]}`} />
          <span className="font-semibold text-muted-foreground">{gate.label}</span>
          <span className="text-foreground">{gate.value}</span>
        </span>
      ))}
    </div>
  )
}

function IssueActionMegaMenu({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false)
  const actions = useIssueActions(issueId)
  const actionsByKey = useMemo(() => new Map(actions.all.map((view) => [view.action.key, view])), [actions.all])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const groups = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      views: ISSUE_ACTIONS.filter((action) => action.group === group)
        .map((action) => actionsByKey.get(action.key))
        .filter((view): view is IssueActionView => Boolean(view)),
    })).filter((entry) => entry.views.length > 0)
  }, [actionsByKey])

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Issue actions"
        className="inline-flex items-center rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-[12px] font-semibold text-foreground transition-colors hover:bg-accent"
        onClick={() => setOpen((value) => !value)}
      >
        ⌘ Actions ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 grid w-[min(560px,calc(100vw-48px))] grid-cols-1 gap-x-5 gap-y-2 rounded-[18px] border border-border bg-popover p-3 shadow-xl md:grid-cols-2">
            {groups.map(({ group, views }) => (
              <div key={group} className="min-w-0">
                <h4 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {GROUP_LABELS[group]}
                </h4>
                <div className="flex flex-col gap-1">
                  {views.map((view) => (
                    <button
                      key={view.action.key}
                      type="button"
                      disabled={!view.enabled || view.isPending}
                      title={view.disabledReason ?? view.action.label}
                      onClick={() => {
                        view.invoke()
                        if (view.action.kind !== 'dialog') setOpen(false)
                      }}
                      className={`rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                        view.action.kind === 'destructive' || view.action.group === 'danger'
                          ? 'text-destructive-foreground hover:bg-destructive/10'
                          : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      {view.isPending ? `${view.action.label}…` : view.action.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <IssueActionDialogHost issueId={issueId} actions={actions} />
    </div>
  )
}

function PipelineNode({
  label,
  state,
  summary,
  children,
}: {
  label: string
  state: PipelineState
  summary: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(state === 'active' || state === 'fail')
  return (
    <div className="rounded-[16px] border border-border bg-card/70">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border text-[12px] ${pipelineTone(state)}`}>
          {pipelineGlyph(state)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-foreground">{label}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{summary}</span>
        </span>
        <span className={`text-[10px] text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && children && (
        <div className="border-t border-border px-3 py-3 text-[12px] text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}

function PipelineLane({ issueId }: { issueId: string }) {
  const review = useReviewStatusQuery(issueId)
  const activity = useActivityQuery(issueId)
  const ci = useIssueCheckRunsQuery(issueId)
  const actions = useIssueActions(issueId)
  const rs = review.data
  const sections = activity.data?.sections ?? []
  const work = sections.find((section) => section.type === 'work')
  const test = sections.find((section) => section.type === 'test')
  const ship = sections.find((section) => section.type === 'ship')
  const states = computePipelineStates({ hasPlan: actions.state.hasPlan, rs, ci: ci.data, work })

  const smallActions = ['restartReview', 'recoverReview', 'reviewTest', 'viewPr']
    .map((key) => actions.all.find((view) => view.action.key === key))
    .filter((view): view is IssueActionView => Boolean(view && view.enabled))

  return (
    <aside className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>◢ Pipeline · live</span>
        <span>stage details</span>
      </div>
      <PipelineNode label="Plan" state={states.plan} summary={states.plan === 'done' ? 'plan artifacts present' : 'not planned'}>
        <div>vBRIEF and beads state are sourced from the plan and workspace panels.</div>
      </PipelineNode>
      <PipelineNode label="Work" state={states.work} summary={work ? `${work.sessionId} · ${work.status}` : 'no work session'}>
        {work ? <div className="font-mono text-[11px]">{work.sessionId} · {work.model}</div> : <div>No work agent session found.</div>}
      </PipelineNode>
      <PipelineNode label="Review" state={states.review} summary={rs?.reviewStatus ?? 'pending'}>
        <DrawerReviewSpecialists issueId={issueId} />
        {rs?.reviewNotes && <div className="mt-2 rounded-[10px] border-l-2 border-destructive/60 bg-destructive/[0.06] px-3 py-2 text-foreground/85">{rs.reviewNotes}</div>}
      </PipelineNode>
      <PipelineNode label="Test" state={states.test} summary={rs?.testStatus ?? 'pending'}>
        <div className="space-y-1">
          <div>testStatus: <span className="text-foreground">{rs?.testStatus ?? 'pending'}</span></div>
          {test && <div className="font-mono text-[11px]">{test.sessionId} · {test.status}</div>}
          {rs?.testNotes && <div>{rs.testNotes}</div>}
        </div>
      </PipelineNode>
      <PipelineNode label="GitHub CI/CD" state={states.ci} summary={ci.data?.summary.total ? `${ci.data.summary.passed}/${ci.data.summary.total} pass` : 'no checks'}>
        <CheckRunList checkRuns={ci.data?.checkRuns ?? []} compact />
      </PipelineNode>
      <PipelineNode label="Ship" state={states.ship} summary={rs?.mergeStatus ?? 'waiting'}>
        {ship ? <div className="font-mono text-[11px]">{ship.sessionId} · {ship.status}</div> : <div>Rebase, verify, and push after review/test gates pass.</div>}
      </PipelineNode>
      <PipelineNode label="Merge" state={states.merge} summary={rs?.mergeStatus === 'merged' ? 'merged' : rs?.readyForMerge ? 'ready for human merge' : 'gated'}>
        <div>Merge is gated on Panopticon review/test plus GitHub PR state.</div>
      </PipelineNode>
      {smallActions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2 px-1">
          {smallActions.map((view) => (
            <button key={view.action.key} type="button" disabled={view.isPending} onClick={view.invoke} className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50">
              {view.action.label}
            </button>
          ))}
        </div>
      )}
      <IssueActionDialogHost issueId={issueId} actions={actions} />
    </aside>
  )
}

function IssueTreeLane({
  issueId,
  title,
  projectName,
  selected,
  onSelect,
}: {
  issueId: string
  title: string
  projectName?: string
  selected: IssueTreeContext | null
  onSelect: (context: IssueTreeContext) => void
}) {
  const review = useReviewStatusQuery(issueId)
  const activity = useActivityQuery(issueId)
  const actions = useIssueActions(issueId)
  const checks = useIssueCheckRunsQuery(issueId)
  const sections = activity.data?.sections ?? []
  const work = sections.find((section) => section.type === 'work')
  const test = sections.find((section) => section.type === 'test')
  const ship = sections.find((section) => section.type === 'ship')
  const reviewerCount = sections.filter((section) => section.type === 'review' || section.type === 'reviewer').length
  const hasPlan = actions.state.hasPlan
  const hasBeads = actions.state.hasBeads
  const issueActive = selected === 'issue'

  const childClass = (context: IssueTreeContext) => `grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors ${
    selected === context ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'
  }`

  return (
    <aside className="min-w-0 rounded-[20px] border border-border bg-card/50 p-3" aria-label="Issue tree">
      <div className="mb-3 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Issues</span>
        <span>current</span>
      </div>
      <div className="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold text-foreground">
        <span>⌄</span>
        <span className="min-w-0 truncate">{projectName ?? 'Project'}</span>
      </div>
      <section className="border-l-2 border-primary bg-primary/[0.07] pl-2">
        <button
          type="button"
          onClick={() => onSelect('issue')}
          className={`grid w-full gap-1 rounded-r-[10px] px-2 py-2 text-left transition-colors ${issueActive ? 'bg-card shadow-sm' : 'hover:bg-card/70'}`}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{issueId}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{review.data?.readyForMerge ? 'ready' : review.data?.reviewStatus ?? 'open'}</span>
          </span>
          <span className="line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">{title}</span>
          <span className="flex flex-wrap gap-1.5">
            <CockpitPill tone={statusToTone(review.data?.reviewStatus)} className="px-1.5 py-0 text-[9px]">{review.data?.reviewStatus ?? 'status'}</CockpitPill>
            {review.data?.readyForMerge && <CockpitPill tone="success" className="px-1.5 py-0 text-[9px]">merge ready</CockpitPill>}
          </span>
        </button>
        <div className="mt-1 grid gap-0.5 pb-2 pl-4">
          <button type="button" onClick={() => onSelect('work')} className={childClass('work')}>
            <span>⌘</span>
            <span className="min-w-0 truncate">Work agent</span>
            <span className="font-mono text-[10px] text-muted-foreground">{work?.status ?? 'none'}</span>
          </button>
          <button type="button" onClick={() => onSelect('review')} className={childClass('review')}>
            <span>◇</span>
            <span className="min-w-0 truncate">Review</span>
            <span className="font-mono text-[10px] text-muted-foreground">{reviewerCount || review.data?.reviewStatus || 'pending'}</span>
          </button>
          <button type="button" onClick={() => onSelect('test')} className={childClass('test')}>
            <span>⚗</span>
            <span className="min-w-0 truncate">Test</span>
            <span className="font-mono text-[10px] text-muted-foreground">{test?.status ?? review.data?.testStatus ?? 'pending'}</span>
          </button>
          <button type="button" onClick={() => onSelect('ci')} className={childClass('ci')}>
            <span>◉</span>
            <span className="min-w-0 truncate">PR & CI</span>
            <span className="font-mono text-[10px] text-muted-foreground">{checks.data?.summary.total ? `${checks.data.summary.passed}/${checks.data.summary.total}` : 'none'}</span>
          </button>
          <button type="button" onClick={() => onSelect('plan')} className={childClass('plan')}>
            <span>☷</span>
            <span className="min-w-0 truncate">Planning state</span>
            <span className="font-mono text-[10px] text-muted-foreground">{hasPlan ? 'ready' : 'missing'}</span>
          </button>
          <button type="button" onClick={() => onSelect('beads')} className={childClass('beads')}>
            <span>▦</span>
            <span className="min-w-0 truncate">Beads</span>
            <span className="font-mono text-[10px] text-muted-foreground">{hasBeads ? 'present' : 'none'}</span>
          </button>
          <button type="button" onClick={() => onSelect('activity')} className={childClass('activity')}>
            <span>↯</span>
            <span className="min-w-0 truncate">Activity</span>
            <span className="font-mono text-[10px] text-muted-foreground">{sections.length}</span>
          </button>
          {ship && (
            <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
              <span>⇡</span>
              <span className="min-w-0 truncate">Ship agent</span>
              <span className="font-mono text-[10px]">{ship.status}</span>
            </div>
          )}
        </div>
      </section>
    </aside>
  )
}

function IssueTreeContextPanel({
  context,
  issueId,
  launcher,
  agentDock,
  actionDock,
  timeline,
}: {
  context: IssueTreeContext
  issueId: string
  launcher: ReactNode
  agentDock: ReactNode
  actionDock: ReactNode
  timeline: ReactNode
}) {
  const review = useReviewStatusQuery(issueId)
  const activity = useActivityQuery(issueId)
  const work = activity.data?.sections.find((section) => section.type === 'work')
  const copy: Record<IssueTreeContext, { title: string; summary: string }> = {
    issue: { title: issueId, summary: 'Issue detail from the tree. Workspace tabs stay visible above this pane.' },
    work: { title: 'Work agent', summary: work ? `${work.sessionId} · ${work.status}` : 'No work agent session is attached to this issue.' },
    review: { title: 'Review', summary: `Review status: ${review.data?.reviewStatus ?? 'pending'}.` },
    test: { title: 'Test', summary: `Test status: ${review.data?.testStatus ?? 'pending'}.` },
    ci: { title: 'PR & CI', summary: 'GitHub pull request and check run state for this issue.' },
    plan: { title: 'Planning state', summary: 'vBRIEF, PRD, and planning state for this issue.' },
    beads: { title: 'Beads', summary: 'Implementation beads generated from the finalized plan.' },
    activity: { title: 'Activity', summary: 'Issue activity feed and recent pipeline events.' },
  }

  const body = (() => {
    if (context === 'issue') return <OverviewTab issueId={issueId} />
    if (context === 'work') return <ConversationTab launcher={launcher} agentDock={agentDock} actionDock={actionDock} timeline={timeline} />
    if (context === 'review') return <ReviewVerificationCard issueId={issueId} />
    if (context === 'test') return <TestPanel issueId={issueId} />
    if (context === 'ci') return <GitHubCiPanel issueId={issueId} />
    if (context === 'plan') return <PlanMissionTab issueId={issueId} />
    if (context === 'beads') return <BeadsTab issueId={issueId} />
    return <ActivityTab issueId={issueId} />
  })()

  return (
    <div className="space-y-3.5" data-testid="issue-tree-context-panel">
      <div className="rounded-[16px] border border-border bg-card px-4 py-3">
        <h2 className="text-[16px] font-semibold text-foreground">{copy[context].title}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">{copy[context].summary}</p>
      </div>
      {body}
    </div>
  )
}

function CheckRunList({ checkRuns, compact = false }: { checkRuns: IssueCheckRun[]; compact?: boolean }) {
  if (checkRuns.length === 0) {
    return <div className="text-[12px] text-muted-foreground">No GitHub check runs reported.</div>
  }
  return (
    <div className="flex flex-col gap-2">
      {checkRuns.slice(0, compact ? 5 : undefined).map((run) => {
        const c = statusColor({ status: run.status, conclusion: run.conclusion ?? undefined })
        const content = (
          <>
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px]" style={{ background: c.bg, color: c.fg }}>
              {c.label === 'pass' ? '✓' : c.label === 'fail' ? '✕' : c.label === 'skip' ? '–' : '•'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{run.name}</span>
            <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{checkRunLabel(run)}</span>
          </>
        )
        return run.htmlUrl || run.detailsUrl ? (
          <a key={run.id || run.name} href={run.htmlUrl ?? run.detailsUrl ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-[10px] border border-border bg-background/40 px-2.5 py-2 hover:bg-accent">
            {content}
          </a>
        ) : (
          <div key={run.id || run.name} className="flex items-center gap-2 rounded-[10px] border border-border bg-background/40 px-2.5 py-2">
            {content}
          </div>
        )
      })}
      {compact && checkRuns.length > 5 && <div className="text-[11px] text-muted-foreground">+{checkRuns.length - 5} more checks in PR & CI</div>}
    </div>
  )
}

function GitHubCiPanel({ issueId }: { issueId: string }) {
  const checks = useIssueCheckRunsQuery(issueId)
  const data = checks.data
  const summary = data?.summary
  const tone: CockpitTone = summary?.failed || summary?.cancelled
    ? 'destructive'
    : summary?.running || summary?.pending
      ? 'info'
      : summary?.total
        ? 'success'
        : 'muted'

  return (
    <CockpitCard
      tone={tone}
      title="GitHub CI/CD"
      right={summary ? <CockpitPill tone={tone}>{summary.passed}/{summary.total} pass</CockpitPill> : undefined}
    >
      {checks.isLoading ? <div className="text-[12px] text-muted-foreground">Loading GitHub checks…</div> : null}
      {!checks.isLoading && !data?.pr ? (
        <div className="text-[12px] text-muted-foreground">No pull request found for this issue.</div>
      ) : null}
      {data?.pr && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <a href={data.pr.url} target="_blank" rel="noreferrer" className="font-semibold text-foreground hover:underline">PR #{data.pr.number}</a>
          <span>·</span>
          <span>{data.pr.mergeable ?? 'mergeability unknown'}</span>
          <span>·</span>
          <code className="text-[11px]">{data.pr.headRefName}</code>
        </div>
      )}
      {data?.error && <div className="mb-3 rounded-[10px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive-foreground">{data.error}</div>}
      <CheckRunList checkRuns={data?.checkRuns ?? []} />
      {summary && summary.total > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span>{summary.failed} failed</span>
          <span>{summary.running} running</span>
          <span>{summary.pending} pending</span>
          <span>{summary.skipped} skipped</span>
        </div>
      )}
    </CockpitCard>
  )
}

function TestPanel({ issueId }: { issueId: string }) {
  const review = useReviewStatusQuery(issueId)
  const activity = useActivityQuery(issueId)
  const actions = useIssueActions(issueId)
  const rs = review.data
  const testSection = activity.data?.sections.find((section) => section.type === 'test')
  const reviewTest = actions.all.find((view) => view.action.key === 'reviewTest' && view.enabled)
  const recover = actions.all.find((view) => view.action.key === 'recoverReview' && view.enabled)
  const actionButtons = [reviewTest, recover].filter((view): view is IssueActionView => Boolean(view))
  const tone = statusToTone(rs?.testStatus)

  return (
    <CockpitCard tone={tone} title="Test & Verification" right={<CockpitPill tone={tone}>{rs?.testStatus ?? 'pending'}</CockpitPill>}>
      <div className="space-y-2 text-[12px]">
        <div className="flex justify-between gap-4 border-b border-border pb-2"><span className="text-muted-foreground">Pipeline test</span><span>{rs?.testStatus ?? 'pending'}</span></div>
        <div className="flex justify-between gap-4 border-b border-border pb-2"><span className="text-muted-foreground">Verification gate</span><span>{rs?.verificationStatus ?? 'pending'}</span></div>
        <div className="flex justify-between gap-4 border-b border-border pb-2"><span className="text-muted-foreground">Verification cycles</span><span>{rs?.verificationCycleCount ?? 0}{rs?.verificationMaxCycles ? `/${rs.verificationMaxCycles}` : ''}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Test agent</span><span className="font-mono text-[11px]">{testSection ? `${testSection.sessionId} · ${testSection.status}` : 'not dispatched'}</span></div>
      </div>
      {rs?.testNotes && <div className="mt-3 rounded-[10px] border border-border bg-background/40 px-3 py-2 text-[12px] text-foreground/85">{rs.testNotes}</div>}
      {!testSection && rs?.reviewStatus === 'blocked' && <div className="mt-3 text-[12px] text-muted-foreground">Test dispatch is gated behind the review verdict.</div>}
      {actionButtons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actionButtons.map((view) => (
            <button key={view.action.key} type="button" disabled={view.isPending} onClick={view.invoke} className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[12px] font-medium hover:bg-accent disabled:opacity-50">
              {view.action.label}
            </button>
          ))}
        </div>
      )}
      <IssueActionDialogHost issueId={issueId} actions={actions} />
    </CockpitCard>
  )
}

function MarkdownMissionTab({ issueId, field }: { issueId: string; field: 'prd' | 'state' }) {
  const planning = usePlanningQuery(issueId, { enabled: true })
  return <MarkdownTab body={planning.data?.[field]} isLoading={planning.isLoading} emptyLabel={`No ${field.toUpperCase()} document.`} />
}

function PlanMissionTab({ issueId }: { issueId: string }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <CockpitCard tone="info" title="vBRIEF"><VBriefTab issueId={issueId} /></CockpitCard>
      <CockpitCard tone="muted" title="PRD draft"><MarkdownMissionTab issueId={issueId} field="prd" /></CockpitCard>
      <CockpitCard tone="muted" title="STATE"><MarkdownMissionTab issueId={issueId} field="state" /></CockpitCard>
    </div>
  )
}

function OpenPaneCard({ title, description, action, onOpen }: { title: string; description: string; action: string; onOpen: () => void }) {
  return (
    <CockpitCard tone="muted" title={title}>
      <p className="text-[12px] text-muted-foreground">{description}</p>
      <button type="button" className="mt-3 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-[12px] font-semibold hover:bg-accent" onClick={onOpen}>
        {action}
      </button>
    </CockpitCard>
  )
}

function KRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-[12px] last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="min-w-0 text-right text-foreground">{children}</span>
    </div>
  )
}

/** "Now" card — the issue's current state in one glance (mockup Overview, left). */
function NowCard({ issueId }: { issueId: string }) {
  const review = useReviewStatusQuery(issueId)
  const ci = useIssueCheckRunsQuery(issueId)
  const activity = useActivityQuery(issueId)
  const actions = useIssueActions(issueId)
  const rs = review.data
  const work = activity.data?.sections.find((section) => section.type === 'work')
  const states = computePipelineStates({ hasPlan: actions.state.hasPlan, rs, ci: ci.data, work })
  const phase = phaseStatus(rs)
  const tone = statusToTone(phase)
  return (
    <CockpitCard tone={tone} title="Now" right={<CockpitPill tone={tone}>{phase}</CockpitPill>}>
      <KRow k="Phase">{activePhaseLabel(states)}</KRow>
      <KRow k="Review">{rs?.reviewStatus ?? 'pending'}</KRow>
      <KRow k="Test">{rs?.testStatus ?? 'pending'}</KRow>
      {rs?.reviewNotes && <KRow k="Blocker"><span className="text-destructive-foreground">{rs.reviewNotes}</span></KRow>}
      <KRow k="Next action">{nextAction(rs)}</KRow>
    </CockpitCard>
  )
}

/** "Issue" card — PR / CI / diff / verification facts (mockup Overview, right). */
function IssueCard({ issueId }: { issueId: string }) {
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const ci = useIssueCheckRunsQuery(issueId)
  const rs = review.data
  const p = pr.data?.pr
  const summary = ci.data?.summary
  return (
    <CockpitCard tone="muted" title="Issue">
      <KRow k="Pull request">
        {p ? (
          p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">#{p.number} · {p.mergeable ?? p.state.toLowerCase()}</a>
          ) : (
            <span>#{p.number} · {p.mergeable ?? p.state.toLowerCase()}</span>
          )
        ) : 'no PR'}
      </KRow>
      <KRow k="CI checks">{summary?.total ? `${summary.passed}/${summary.total} passed` : 'no checks'}</KRow>
      <KRow k="Diff">{p ? <span><span className="text-success-foreground">+{p.additions}</span> <span className="text-destructive-foreground">−{p.deletions}</span> · {p.changedFiles} file{p.changedFiles === 1 ? '' : 's'}</span> : '—'}</KRow>
      <KRow k="Verification">{rs?.verificationStatus ?? 'pending'}{rs?.verificationCycleCount ? ` · ${rs.verificationCycleCount} cycle${rs.verificationCycleCount === 1 ? '' : 's'}` : ''}</KRow>
      <KRow k="Merge-ready">{rs?.readyForMerge ? 'yes' : 'no'}</KRow>
    </CockpitCard>
  )
}

/** Overview — faithful to the v3 mockup: blocker spotlight + Now / Issue cards. */
function OverviewTab({ issueId }: { issueId: string }) {
  return (
    <div className="space-y-3.5">
      <IssueBlockerSpotlight issueId={issueId} />
      <div className="grid gap-3.5 xl:grid-cols-2">
        <NowCard issueId={issueId} />
        <IssueCard issueId={issueId} />
      </div>
    </div>
  )
}

/** Conversation tab — the issue-scoped launch composition + timeline. */
function ConversationTab({ launcher, agentDock, actionDock, timeline }: Pick<IssueMissionControlProps, 'launcher' | 'agentDock' | 'actionDock' | 'timeline'>) {
  return (
    <div className="space-y-3.5">
      <CockpitCard tone="info" title="Launch">{launcher}</CockpitCard>
      <div className="grid gap-3.5 xl:grid-cols-2">
        <CockpitCard tone="success" title="Agents">{agentDock}</CockpitCard>
        <CockpitCard tone="muted" title="Quick tools">{actionDock}</CockpitCard>
      </div>
      <CockpitCard tone="warning" title="Conversation timeline">{timeline}</CockpitCard>
    </div>
  )
}

function tabBadge(tab: MissionTab, rs: ReviewStatusData | undefined, checks: ReturnType<typeof useIssueCheckRunsQuery>['data']): { label: string; tone: CockpitTone } | null {
  if (tab === 'review' && (rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed')) return { label: '!', tone: 'destructive' }
  if (tab === 'test' && rs?.testStatus && rs.testStatus !== 'pending') return { label: rs.testStatus === 'passed' ? '✓' : rs.testStatus === 'testing' ? '…' : '!', tone: statusToTone(rs.testStatus) }
  if (tab === 'ci' && checks?.summary.total) return { label: checks.summary.failed ? '!' : checks.summary.running || checks.summary.pending ? '…' : '✓', tone: checks.summary.failed ? 'destructive' : checks.summary.running || checks.summary.pending ? 'info' : 'success' }
  return null
}

export function IssueMissionControl({ issueId, title, branch, projectName, launcher, agentDock, actionDock, timeline, onOpenPane }: IssueMissionControlProps) {
  const [activeTab, setActiveTab] = useState<MissionTab | null>('overview')
  const [treeContext, setTreeContext] = useState<IssueTreeContext | null>(null)
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const checks = useIssueCheckRunsQuery(issueId)
  const costs = useIssueCostsQuery(issueId)
  const phase = phaseStatus(review.data)
  const cost = costs.data?.resolvedTotalCost ?? costs.data?.totalCost ?? 0
  const selectTab = (tab: MissionTab) => {
    setActiveTab(tab)
    setTreeContext(null)
  }
  const selectTreeContext = (context: IssueTreeContext) => {
    setTreeContext(context)
    setActiveTab(null)
  }

  return (
    <div className={styles.missionWrap}>
      <header className="rounded-[22px] border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-muted-foreground/70">
              {projectName ? <><span className="text-muted-foreground">{projectName}</span> / </> : null}Issues
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-foreground">{issueId}</span>
              <h1 className="min-w-0 text-[16px] font-semibold text-foreground">{title}</h1>
              <CockpitPill tone={statusToTone(phase)}>{phase}</CockpitPill>
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">Issue Cockpit · Mission Control</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <HeaderStat label="Branch" value={<span className="font-mono">{branch}</span>} />
            <HeaderStat
              label="PR / CI"
              value={pr.data?.pr
                ? `#${pr.data.pr.number}${checks.data?.summary.total ? ` · ${checks.data.summary.passed}/${checks.data.summary.total} ✓` : ''}`
                : 'no PR'}
            />
            <HeaderStat label="Cost" value={cost > 0 ? `$${cost.toFixed(2)}` : '—'} />
            <MergeCta issueId={issueId} rs={review.data} />
            <IssueActionMegaMenu issueId={issueId} />
          </div>
        </div>
        <div className="mt-4"><PipelineProgressBar issueId={issueId} /></div>
        <div className="mt-3"><GatesRow issueId={issueId} /></div>
      </header>

      <div className={styles.missionBody}>
        <IssueTreeLane issueId={issueId} title={title} projectName={projectName} selected={treeContext} onSelect={selectTreeContext} />
        <main className="min-w-0 rounded-[20px] border border-border bg-card/30">
          <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 pt-2" aria-label="Issue cockpit tabs">
            {TABS.map((tab) => {
              const badge = tabBadge(tab.id, review.data, checks.data)
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-selected={activeTab === tab.id}
                  onClick={() => selectTab(tab.id)}
                  className={`relative top-px flex shrink-0 items-center gap-1.5 rounded-t-[10px] border px-3 py-2 text-[12px] font-semibold transition-colors ${
                    activeTab === tab.id
                      ? 'border-border border-b-card bg-card text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  {badge && <CockpitPill tone={badge.tone} className="px-[5px] py-0 text-[9px]">{badge.label}</CockpitPill>}
                </button>
              )
            })}
          </nav>
          <div className="p-4">
            {treeContext && (
              <IssueTreeContextPanel
                context={treeContext}
                issueId={issueId}
                launcher={launcher}
                agentDock={agentDock}
                actionDock={actionDock}
                timeline={timeline}
              />
            )}
            {activeTab === 'overview' && <OverviewTab issueId={issueId} />}
            {activeTab === 'review' && <ReviewVerificationCard issueId={issueId} />}
            {activeTab === 'test' && <TestPanel issueId={issueId} />}
            {activeTab === 'ci' && <GitHubCiPanel issueId={issueId} />}
            {activeTab === 'conversation' && <ConversationTab launcher={launcher} agentDock={agentDock} actionDock={actionDock} timeline={timeline} />}
            {activeTab === 'diff' && <PrDiffTab issueId={issueId} />}
            {activeTab === 'files' && <OpenPaneCard title="Files" description="Open the issue-scoped workspace file browser in a deck pane." action="Open files pane" onOpen={() => onOpenPane('files')} />}
            {activeTab === 'terminal' && <OpenPaneCard title="Terminal" description="Open the issue terminal drawer for the current workspace." action="Open terminal" onOpen={() => onOpenPane('terminal')} />}
            {activeTab === 'plan' && <PlanMissionTab issueId={issueId} />}
            {activeTab === 'beads' && <BeadsTab issueId={issueId} />}
            {activeTab === 'discussion' && <DiscussionsTab issueId={issueId} />}
            {activeTab === 'costs' && <CostsTab issueId={issueId} />}
            {activeTab === 'activity' && <ActivityTab issueId={issueId} />}
            {activeTab === 'artifacts' && <DrawerArtifactsPanel issueId={issueId} />}
            {activeTab === 'history' && <StatusHistoryTab issueId={issueId} />}
          </div>
        </main>
      </div>
    </div>
  )
}
