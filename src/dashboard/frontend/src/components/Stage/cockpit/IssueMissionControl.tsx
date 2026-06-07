import { useMemo, useState, type ReactNode } from 'react'
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
  usePlanningQuery,
  usePrQuery,
  useReviewStatusQuery,
  type IssueCheckRun,
  type ReviewStatusData,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import DrawerArtifactsPanel from '../../drawer/DrawerArtifactsPanel'
import DrawerReviewSpecialists from '../../drawer/DrawerReviewSpecialists'
import PhaseTimeline from '../../drawer/PhaseTimeline'
import { IssueActionDialogHost } from '../../IssueActionMenu/IssueActionMenu'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import type { PaneType } from '../../../lib/panesStore'
import { ISSUE_ACTIONS, type IssueActionGroup } from '../../../lib/issueActions'
import { IssueBlockerSpotlight } from './IssueBlockerSpotlight'
import { IssueMetricStrip } from './IssueMetricStrip'
import { ReviewVerificationCard } from './ReviewVerificationCard'
import { CodeCard } from './CodeCard'
import { PlanCard } from './PlanCard'
import { CostCard } from './CostCard'
import { WorkspaceCard } from './WorkspaceCard'
import { AgentCard, ActivityCard } from './AgentActivityCards'
import { StatusHistoryTab } from './StatusHistoryTab'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'
import styles from './cockpitBody.module.css'

export interface IssueMissionControlProps {
  issueId: string
  title: string
  branch: string
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

function statusToTone(status: string | undefined | null): CockpitTone {
  const normalized = (status ?? '').toLowerCase()
  if (['passed', 'success', 'completed', 'merged'].includes(normalized)) return 'success'
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

function checkRunTone(run: Pick<IssueCheckRun, 'status' | 'conclusion'>): CockpitTone {
  if (run.status !== 'completed') return run.status === 'in_progress' ? 'info' : 'warning'
  return statusToTone(run.conclusion)
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

function IssueActionMegaMenu({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false)
  const actions = useIssueActions(issueId)
  const actionsByKey = useMemo(() => new Map(actions.all.map((view) => [view.action.key, view])), [actions.all])

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

  const reviewState: PipelineState = rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed'
    ? 'fail'
    : rs?.reviewStatus === 'reviewing'
      ? 'active'
      : rs?.reviewStatus === 'passed'
        ? 'done'
        : 'todo'
  const testState: PipelineState = rs?.testStatus === 'failed' || rs?.testStatus === 'dispatch_failed'
    ? 'fail'
    : rs?.testStatus === 'testing'
      ? 'active'
      : rs?.testStatus === 'passed' || rs?.testStatus === 'skipped'
        ? 'done'
        : 'todo'
  const ciState: PipelineState = ci.data?.summary.failed || ci.data?.summary.cancelled
    ? 'fail'
    : ci.data?.summary.running || ci.data?.summary.pending
      ? 'active'
      : ci.data?.summary.total
        ? 'done'
        : 'todo'
  const shipState: PipelineState = rs?.mergeStatus === 'failed'
    ? 'fail'
    : rs?.mergeStatus === 'queued' || rs?.mergeStatus === 'merging' || rs?.mergeStatus === 'verifying'
      ? 'active'
      : rs?.mergeStatus === 'merged'
        ? 'done'
        : 'todo'

  const smallActions = ['restartReview', 'recoverReview', 'reviewTest', 'viewPr']
    .map((key) => actions.all.find((view) => view.action.key === key))
    .filter((view): view is IssueActionView => Boolean(view && view.enabled))

  return (
    <aside className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>◢ Pipeline · live</span>
        <span>stage details</span>
      </div>
      <PipelineNode label="Plan" state={actions.state.hasPlan ? 'done' : 'todo'} summary={actions.state.hasPlan ? 'plan artifacts present' : 'not planned'}>
        <div>vBRIEF and beads state are sourced from the plan and workspace panels.</div>
      </PipelineNode>
      <PipelineNode label="Work" state={work?.status === 'running' ? 'active' : work ? 'done' : 'todo'} summary={work ? `${work.sessionId} · ${work.status}` : 'no work session'}>
        {work ? <div className="font-mono text-[11px]">{work.sessionId} · {work.model}</div> : <div>No work agent session found.</div>}
      </PipelineNode>
      <PipelineNode label="Review" state={reviewState} summary={rs?.reviewStatus ?? 'pending'}>
        <DrawerReviewSpecialists issueId={issueId} />
        {rs?.reviewNotes && <div className="mt-2 rounded-[10px] border-l-2 border-destructive/60 bg-destructive/[0.06] px-3 py-2 text-foreground/85">{rs.reviewNotes}</div>}
      </PipelineNode>
      <PipelineNode label="Test" state={testState} summary={rs?.testStatus ?? 'pending'}>
        <div className="space-y-1">
          <div>testStatus: <span className="text-foreground">{rs?.testStatus ?? 'pending'}</span></div>
          {test && <div className="font-mono text-[11px]">{test.sessionId} · {test.status}</div>}
          {rs?.testNotes && <div>{rs.testNotes}</div>}
        </div>
      </PipelineNode>
      <PipelineNode label="GitHub CI/CD" state={ciState} summary={ci.data?.summary.total ? `${ci.data.summary.passed}/${ci.data.summary.total} pass` : 'no checks'}>
        <CheckRunList checkRuns={ci.data?.checkRuns ?? []} compact />
      </PipelineNode>
      <PipelineNode label="Ship" state={shipState} summary={rs?.mergeStatus ?? 'waiting'}>
        {ship ? <div className="font-mono text-[11px]">{ship.sessionId} · {ship.status}</div> : <div>Rebase, verify, and push after review/test gates pass.</div>}
      </PipelineNode>
      <PipelineNode label="Merge" state={rs?.mergeStatus === 'merged' ? 'done' : rs?.readyForMerge ? 'active' : 'todo'} summary={rs?.readyForMerge ? 'ready for human merge' : 'gated'}>
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

function OverviewTab({ issueId, launcher, agentDock, actionDock, timeline }: Pick<IssueMissionControlProps, 'issueId' | 'launcher' | 'agentDock' | 'actionDock' | 'timeline'>) {
  return (
    <div className="space-y-3.5">
      <IssueBlockerSpotlight issueId={issueId} />
      <div className="grid gap-3.5 xl:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-3.5">
          <ReviewVerificationCard issueId={issueId} />
          <TestPanel issueId={issueId} />
          <GitHubCiPanel issueId={issueId} />
          <CodeCard issueId={issueId} />
          <PlanCard issueId={issueId} />
        </div>
        <div className="flex flex-col gap-3.5">
          <CockpitCard tone="info" title="Launch">{launcher}</CockpitCard>
          <CockpitCard tone="success" title="Agents">{agentDock}</CockpitCard>
          <CockpitCard tone="muted" title="Quick tools">{actionDock}</CockpitCard>
          <AgentCard issueId={issueId} />
          <WorkspaceCard issueId={issueId} />
          <CostCard issueId={issueId} />
          <ActivityCard issueId={issueId} />
          <CockpitCard tone="warning" title="Conversation timeline">{timeline}</CockpitCard>
        </div>
      </div>
    </div>
  )
}

function tabBadge(tab: MissionTab, rs: ReviewStatusData | undefined, checks: ReturnType<typeof useIssueCheckRunsQuery>['data']): { label: string; tone: CockpitTone } | null {
  if (tab === 'review' && (rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed')) return { label: '!', tone: 'destructive' }
  if (tab === 'test' && rs?.testStatus && rs.testStatus !== 'pending') return { label: rs.testStatus === 'passed' ? '✓' : rs.testStatus === 'testing' ? '…' : '!', tone: statusToTone(rs.testStatus) }
  if (tab === 'ci' && checks?.summary.total) return { label: checks.summary.failed ? '!' : checks.summary.running || checks.summary.pending ? '…' : '✓', tone: checks.summary.failed ? 'destructive' : checks.summary.running || checks.summary.pending ? 'info' : 'success' }
  return null
}

export function IssueMissionControl({ issueId, title, branch, launcher, agentDock, actionDock, timeline, onOpenPane }: IssueMissionControlProps) {
  const [activeTab, setActiveTab] = useState<MissionTab>('overview')
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const checks = useIssueCheckRunsQuery(issueId)
  const phase = phaseStatus(review.data)

  return (
    <div className={styles.missionWrap}>
      <header className="rounded-[22px] border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Issue Cockpit · Mission Control</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-foreground">{issueId}</span>
              <h1 className="min-w-0 text-[16px] font-semibold text-foreground">{title}</h1>
              <CockpitPill tone={statusToTone(phase)}>{phase}</CockpitPill>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-right">
              <div className="text-[9px] uppercase tracking-[0.06em] text-muted-foreground">Branch</div>
              <div className="font-mono text-[11px] text-foreground">{branch}</div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-right">
              <div className="text-[9px] uppercase tracking-[0.06em] text-muted-foreground">PR / CI</div>
              <div className="text-[11px] font-semibold text-foreground">
                {pr.data?.pr ? `#${pr.data.pr.number}` : 'no PR'}{checks.data?.summary.total ? ` · ${checks.data.summary.passed}/${checks.data.summary.total} ✓` : ''}
              </div>
            </div>
            <IssueActionMegaMenu issueId={issueId} />
          </div>
        </div>
        <div className="mt-4"><PhaseTimeline issueId={issueId} /></div>
        <IssueMetricStrip issueId={issueId} />
      </header>

      <div className={styles.missionBody}>
        <PipelineLane issueId={issueId} />
        <main className="min-w-0 rounded-[20px] border border-border bg-card/30">
          <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 pt-2" aria-label="Issue cockpit tabs">
            {TABS.map((tab) => {
              const badge = tabBadge(tab.id, review.data, checks.data)
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
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
            {activeTab === 'overview' && <OverviewTab issueId={issueId} launcher={launcher} agentDock={agentDock} actionDock={actionDock} timeline={timeline} />}
            {activeTab === 'review' && <ReviewVerificationCard issueId={issueId} />}
            {activeTab === 'test' && <TestPanel issueId={issueId} />}
            {activeTab === 'ci' && <GitHubCiPanel issueId={issueId} />}
            {activeTab === 'conversation' && <CockpitCard tone="warning" title="Conversation timeline">{timeline}</CockpitCard>}
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
