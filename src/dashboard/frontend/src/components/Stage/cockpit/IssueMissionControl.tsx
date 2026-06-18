import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { MergeButton } from '../../MergeButton'
import { IssueActionDialogHost } from '../../IssueActionMenu/IssueActionMenu'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { ProjectNode, type ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import { SessionPanel } from '../../CommandDeck/SessionView/SessionPanel'
import type { PaneType } from '../../../lib/panesStore'
import { ISSUE_ACTIONS, type IssueActionGroup } from '../../../lib/issueActions'
import { IssueBlockerSpotlight } from './IssueBlockerSpotlight'
import { ReviewVerificationCard } from './ReviewVerificationCard'
import { StatusHistoryTab } from './StatusHistoryTab'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'
import type { ProjectSessionTree, SessionNode } from '@overdeck/contracts'
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

type IssueTreeContext = 'issue'

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

function toCockpitSession(section: {
  type?: string
  sessionId?: string
  model?: string
  status?: string
  startedAt?: string
  duration?: number | null
}): SessionNode | null {
  const type = section.type === 'reviewer'
    ? 'reviewer'
    : section.type === 'review'
      ? 'review'
      : section.type === 'test'
        ? 'test'
        : section.type === 'ship'
          ? 'ship'
          : section.type === 'merge'
            ? 'merge'
            : section.type === 'planning'
              ? 'planning'
              : section.type === 'legacy'
                ? 'legacy'
                : section.type === 'strike'
                  ? 'strike'
                  : section.type === 'work'
                    ? 'work'
                    : null
  if (!type) return null
  const normalizedStatus = section.status === 'completed'
    ? 'stopped'
    : section.status === 'running' || section.status === 'starting' || section.status === 'error' || section.status === 'stopped'
    ? section.status
    : section.status?.toLowerCase().includes('fail')
      ? 'error'
      : section.status?.toLowerCase().includes('run')
        ? 'running'
        : 'stopped'
  return {
    type,
    sessionId: section.sessionId || `${type}-session`,
    model: section.model || 'unknown',
    startedAt: section.startedAt || new Date(0).toISOString(),
    duration: section.duration ?? null,
    status: normalizedStatus,
    presence: normalizedStatus === 'running' || normalizedStatus === 'starting' ? 'active' : 'ended',
  }
}

function issueTreeStateLabel(rs: ReviewStatusData | undefined): string {
  if (rs?.mergeStatus === 'merged') return 'Done'
  if (rs?.readyForMerge) return 'In Review'
  if (rs?.testStatus === 'testing') return 'Testing'
  if (rs?.reviewStatus === 'reviewing' || rs?.reviewStatus === 'passed' || rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed') return 'In Review'
  return 'In Progress'
}

async function fetchCockpitProjectFeature(projectName: string | undefined, issueId: string): Promise<ProjectFeature | null> {
  const lowerIssueId = issueId.toLowerCase()

  // The session-trees endpoint (which carries each session's harness) needs a
  // concrete project key. On an `?issue=` deep-link the projectName prop is
  // often missing, which previously disabled this query and forced the cockpit
  // onto the harness-less activity-sections fallback — so pi/codex work agents
  // showed neither the RPC terminal notice nor live streaming (PAN-1908).
  // Resolve the project from resource-allocated (which records each feature's
  // projectName) when the prop is absent.
  const issuesRes = await fetch('/api/issues/resource-allocated')
  if (!issuesRes.ok) return null
  const issues = await issuesRes.json() as ProjectFeature[]
  const feature = issues.find((candidate) =>
    candidate.issueId.toLowerCase() === lowerIssueId &&
    (!projectName || candidate.projectName === projectName),
  ) ?? null

  const effectiveProject = projectName ?? feature?.projectName
  if (!effectiveProject) return feature

  const treesRes = await fetch(`/api/session-trees?projects=${encodeURIComponent(effectiveProject)}`)
  if (!treesRes.ok) return feature
  const treesPayload = await treesRes.json() as { trees?: ProjectSessionTree[] }
  const treeFeature = (treesPayload.trees ?? [])
    .find((tree) => tree.projectKey === effectiveProject)
    ?.features
    .find((candidate) => candidate.issueId.toLowerCase() === lowerIssueId)

  if (!feature && !treeFeature) return null
  if (!feature) {
    return {
      issueId,
      title: treeFeature?.title ?? issueId,
      projectName: effectiveProject,
      branch: '',
      status: treeFeature?.sessions.some((session) => session.presence === 'active') ? 'running' : 'has_state',
      stateLabel: 'In Progress',
      agentStatus: treeFeature?.sessions.some((session) => session.presence === 'active') ? 'running' : null,
      hasPlanning: treeFeature?.sessions.some((session) => session.type === 'planning' || session.type === 'legacy') ?? false,
      hasPrd: false,
      hasState: false,
      isShadow: false,
      sessions: treeFeature?.sessions ?? [],
    }
  }
  return {
    ...feature,
    sessions: treeFeature?.sessions ?? feature.sessions,
  }
}

function IssueTreeLane({
  issueId,
  title,
  projectName,
  selectedIssue,
  selectedSessionId,
  onSelectIssue,
  onSelectSession,
  onSessionsChange,
}: {
  issueId: string
  title: string
  projectName?: string
  selectedIssue: boolean
  selectedSessionId: string | null
  onSelectIssue: () => void
  onSelectSession: (session: SessionNode) => void
  onSessionsChange: (sessions: readonly SessionNode[]) => void
}) {
  const review = useReviewStatusQuery(issueId)
  const activity = useActivityQuery(issueId)
  const actions = useIssueActions(issueId)
  const projectFeature = useQuery({
    queryKey: ['cockpit-project-feature', projectName, issueId],
    // Always enabled: fetchCockpitProjectFeature resolves the project from the
    // issue when the projectName prop is absent (deep-link), so the harness-
    // carrying session-trees data is fetched either way (PAN-1908).
    queryFn: () => fetchCockpitProjectFeature(projectName, issueId),
    enabled: true,
    staleTime: 10_000,
  })
  const sessions = useMemo(() => {
    const base = (activity.data?.sections ?? [])
      .map((section) => toCockpitSession(section))
      .filter((session): session is SessionNode => Boolean(session))
    if (actions.state.hasPlan && !base.some((session) => session.type === 'planning' || session.type === 'legacy')) {
      base.push({
        type: 'legacy',
        sessionId: `${issueId}-planning-state`,
        model: 'planning',
        startedAt: new Date(0).toISOString(),
        duration: null,
        status: 'stopped',
        presence: 'ended',
      })
    }
    return base
  }, [actions.state.hasPlan, activity.data?.sections, issueId])

  const fallbackFeature: ProjectFeature = useMemo(() => ({
    issueId,
    title,
    projectName: projectName ?? 'Project',
    branch: '',
    status: sessions.some((session) => session.presence === 'active') ? 'running' : actions.state.hasPlan ? 'has_state' : 'idle',
    stateLabel: issueTreeStateLabel(review.data),
    agentStatus: sessions.some((session) => session.presence === 'active') ? 'running' : null,
    hasPlanning: actions.state.hasPlan,
    hasPrd: actions.state.hasPlan,
    hasState: actions.state.hasPlan,
    isShadow: false,
    readyForMerge: review.data?.readyForMerge,
    sessions,
    resourceSources: [
      ...(actions.state.hasPlan ? ['vbrief' as const] : []),
      ...(actions.state.hasBeads ? ['beads' as const] : []),
      'workspace' as const,
    ],
    resourceDetails: {
      hasWorkspace: true,
      localBranchCount: 0,
      remoteBranchCount: 0,
      tmuxSessionCount: sessions.length,
      prs: [],
      hasVbrief: actions.state.hasPlan,
      hasBeads: actions.state.hasBeads,
      dockerContainerCount: 0,
    },
  }), [actions.state.hasBeads, actions.state.hasPlan, issueId, projectName, review.data, sessions, title])

  const feature = projectFeature.data ?? fallbackFeature
  const renderedSessions = useMemo(() => feature.sessions ?? [], [feature.sessions])

  useEffect(() => {
    onSessionsChange(renderedSessions)
  }, [onSessionsChange, renderedSessions])

  return (
    <aside className="min-w-0 rounded-[20px] border border-border bg-card/50 p-2" aria-label="Issue tree">
      <ProjectNode
        name={projectName ?? 'Project'}
        features={[feature]}
        selectedFeature={selectedIssue ? issueId : null}
        selectedProject={projectName ?? 'Project'}
        onSelectFeature={onSelectIssue}
        selectedSessionId={selectedSessionId}
        onSelectSession={(_, sessionId) => {
          const session = renderedSessions.find((candidate) => candidate.sessionId === sessionId)
          if (session) onSelectSession(session)
        }}
        filter="all"
      />
    </aside>
  )
}

function IssueTreeContextPanel({
  context,
  issueId,
  selectedSession,
  treeSessions,
  launcher,
  agentDock,
  actionDock,
  timeline,
  onBackToIssue,
}: {
  context: IssueTreeContext
  issueId: string
  selectedSession: SessionNode | null
  treeSessions: readonly SessionNode[]
  launcher: ReactNode
  agentDock: ReactNode
  actionDock: ReactNode
  timeline: ReactNode
  onBackToIssue: () => void
}) {
  const copy: Record<IssueTreeContext, { title: string; summary: string }> = {
    issue: { title: issueId, summary: 'Issue overview from the tree. Workspace tabs stay visible above this pane.' },
  }

  const body = (() => {
    if (selectedSession) {
      return (
        <SessionPanel
          session={selectedSession}
          issueId={issueId}
          reviewers={treeSessions.filter((session) => session.type === 'reviewer')}
        />
      )
    }
    if (context === 'issue') return <OverviewTab issueId={issueId} />
    return <ConversationTab launcher={launcher} agentDock={agentDock} actionDock={actionDock} timeline={timeline} />
  })()

  const title = selectedSession
    ? selectedSession.role
      ? `${selectedSession.role[0]?.toUpperCase() ?? ''}${selectedSession.role.slice(1)} reviewer`
      : `${selectedSession.type[0]?.toUpperCase() ?? ''}${selectedSession.type.slice(1)} session`
    : copy[context].title
  const summary = selectedSession
    ? `${selectedSession.sessionId} · ${selectedSession.status}`
    : copy[context].summary

  return (
    <div className="space-y-3.5" data-testid="issue-tree-context-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[16px] border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold text-foreground">{title}</h2>
          <p className="mt-1 truncate text-[12px] text-muted-foreground">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onBackToIssue}
          className="shrink-0 rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-accent"
        >
          Issue overview
        </button>
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
  const [selectedTreeSession, setSelectedTreeSession] = useState<SessionNode | null>(null)
  const [treeSessions, setTreeSessions] = useState<readonly SessionNode[]>([])
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const checks = useIssueCheckRunsQuery(issueId)
  const costs = useIssueCostsQuery(issueId)
  const phase = phaseStatus(review.data)
  const cost = costs.data?.resolvedTotalCost ?? costs.data?.totalCost ?? 0
  const selectTab = (tab: MissionTab) => {
    setActiveTab(tab)
    setTreeContext(null)
    setSelectedTreeSession(null)
  }
  const selectIssueFromTree = () => {
    setTreeContext('issue')
    setSelectedTreeSession(null)
    setActiveTab(null)
  }
  const selectSessionFromTree = (session: SessionNode) => {
    setSelectedTreeSession(session)
    setTreeContext(null)
    setActiveTab(null)
  }
  const recordTreeSessions = useCallback((sessions: readonly SessionNode[]) => {
    setTreeSessions(sessions)
    setSelectedTreeSession((current) => {
      if (!current) return current
      return sessions.find((session) => session.sessionId === current.sessionId) ?? current
    })
  }, [])

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
              <h1 className="min-w-0 max-w-full break-words text-[16px] font-semibold leading-snug text-foreground">{title}</h1>
              <CockpitPill tone={statusToTone(phase)}>{phase}</CockpitPill>
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">Issue Cockpit · Mission Control</div>
          </div>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
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
        <IssueTreeLane
          issueId={issueId}
          title={title}
          projectName={projectName}
          selectedIssue={treeContext === 'issue'}
          selectedSessionId={selectedTreeSession?.sessionId ?? null}
          onSelectIssue={selectIssueFromTree}
          onSelectSession={selectSessionFromTree}
          onSessionsChange={recordTreeSessions}
        />
        <main className="min-w-0 rounded-[20px] border border-border bg-card/30">
          <nav className="flex flex-wrap gap-1 border-b border-border bg-card px-3 pt-2" aria-label="Issue cockpit tabs">
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
            {(treeContext || selectedTreeSession) && (
              <IssueTreeContextPanel
                context={treeContext ?? 'issue'}
                issueId={issueId}
                selectedSession={selectedTreeSession}
                treeSessions={treeSessions}
                launcher={launcher}
                agentDock={agentDock}
                actionDock={actionDock}
                timeline={timeline}
                onBackToIssue={selectIssueFromTree}
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
