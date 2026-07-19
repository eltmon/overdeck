import { useCallback, useState, type ReactNode } from 'react'
import { ActivityTab } from '../../CommandDeck/ZoneCOverviewTabs/ActivityTab'
import { ShipTab } from './ShipTab'
import { TasksTab } from '../../CommandDeck/ZoneCOverviewTabs/TasksTab'
import { CostsTab } from '../../CommandDeck/ZoneCOverviewTabs/CostsTab'
import { DiscussionsTab } from '../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import { statusColor } from '../../CommandDeck/ZoneCOverviewTabs/PrDiffTab'
import { XBriefTab } from '../../CommandDeck/ZoneCOverviewTabs/XBriefTab'
import {
  useActivityQuery,
  useIssueCheckRunsQuery,
  useIssueCostsQuery,
  usePlanningQuery,
  usePrQuery,
  useReviewStatusQuery,
  type IssueCheckRun,
  type ReviewStatusData,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import DrawerArtifactsPanel from '../../drawer/DrawerArtifactsPanel'
import { IssueActionMenu } from '../../IssueActionMenu/IssueActionMenu'
import { useIssueActions } from '../../IssueActionMenu/useIssueActions'
import { IssueView } from '../../issue-view/IssueView'
import { SessionPanel } from '../../CommandDeck/SessionView/SessionPanel'
import { MissionConversationTab } from './MissionConversationTab'
import type { PaneType } from '../../../lib/panesStore'
import { formatRelativeTime } from '../../../lib/formatRelativeTime'
import { taskStatusRollup } from '../../../lib/taskStatus'
import { IssueBlockerSpotlight } from './IssueBlockerSpotlight'
import { IssueTreeLane } from './IssueTreeLane'
import { useTasksQuery } from './TasksRail'
import { TasksDrawer } from './TasksDrawer'
import { UatEnvironmentPanel } from '../../CommandDeck/UatEnvironmentPanel'
import { PickupGateCard } from './PickupGateCard'
import { ChangedFilesView } from './ChangedFilesView'
import { StatusHistoryTab } from './StatusHistoryTab'
import { CrewStage } from './CrewStage'
import { HappenedFeed } from './HappenedFeed'
import { PlanMapCard } from './PlanMapCard'
import { StatusNarrative, type JourneyStageKey } from './StatusNarrative'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'
import type { SessionNode } from '@overdeck/contracts'
import styles from './cockpitBody.module.css'

export interface IssueMissionControlProps {
  issueId: string
  title: string
  branch: string
  /** Active project name for the breadcrumb (e.g. "overdeck"). */
  projectName?: string
  launcher: ReactNode
  agentDock: ReactNode
  actionDock: ReactNode
  timeline: ReactNode
  onOpenPane: (paneType: PaneType) => void
}

type MissionTab =
  | 'overview'
  | 'code'        // PAN-1991 #6: PR + CI checks + diff/changed-files
  | 'plan'
  | 'timeline'    // PAN-1991 #6: Activity + History merged
  | 'discussion'
  | 'costs'
  | 'artifacts'
  | 'ship'         // PAN-2487: Ship & Merge view — live merge-door progress + log
  | 'files'        // tool — #10
  | 'terminal'     // tool — #10
  | 'beads'        // not a visible tab; reachable from the rail's "open full"

type PipelinePhaseKey = 'plan' | 'work' | 'review' | 'test' | 'ci' | 'ship' | 'merge'

type IssueTreeContext = 'issue'

const SPINE_COLLAPSED_KEY = 'overdeck.cockpit.spineCollapsed'

// PAN-2398: status lives in StatusNarrative; beads = rail; tools = panes.
const TABS: Array<{ id: MissionTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'code', label: 'Code' },
  { id: 'plan', label: 'PRD / Plan' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'discussion', label: 'Discussion' },
  { id: 'costs', label: 'Costs' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'ship', label: 'Ship' },
  { id: 'files', label: 'Files' },
  { id: 'terminal', label: 'Terminal' },
]

// Explicit, literal Tailwind classes — interpolated utilities get purged.
// PAN-1991 #4: active = blue (a machine is working), not purple (purple is
// reserved for review/ship/planning specialist activity). done = emerald,
// failed = red, ahead = neutral track.
// PAN-1991 #5: gate dots follow the law — emerald=passing, red=failing,
// blue=running (a machine is working; was purple), neutral=pending/rest.
function statusToTone(status: string | undefined | null): CockpitTone {
  const normalized = (status ?? '').toLowerCase()
  if (['passed', 'success', 'completed', 'merged', 'ready'].includes(normalized)) return 'success'
  if (['failed', 'blocked', 'dispatch_failed', 'timed_out', 'action_required', 'startup_failure', 'failure'].includes(normalized)) return 'destructive'
  if (['running', 'reviewing', 'testing', 'queued', 'merging', 'verifying', 'in_progress'].includes(normalized)) return 'info'
  if (['skipped', 'neutral', 'cancelled'].includes(normalized)) return 'muted'
  return 'warning'
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



function HeaderStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-px text-right">
      <div className="text-[9px] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="text-[11.5px] text-foreground">{value}</div>
    </div>
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
  onTab,
  onOpenAgent,
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
  onTab: (tab: MissionTab) => void
  onOpenAgent: (type: string) => void
}) {
  const copy: Record<IssueTreeContext, { title: string; summary: string }> = {
    issue: { title: issueId, summary: 'Issue overview from the tree. Workspace tabs stay visible above this pane.' },
  }

  const body = (() => {
    if (selectedSession) {
      return (
        <div className="mx-auto w-full max-w-[980px]">
          <SessionPanel
            session={selectedSession}
            issueId={issueId}
            reviewers={treeSessions.filter((session) => session.type === 'reviewer')}
          />
        </div>
      )
    }
    if (context === 'issue') return (
      <div className="space-y-3.5">
        <OverviewTab issueId={issueId} onTab={onTab} onOpenAgent={onOpenAgent} />
        <div data-section="Conversation / Files / Terminal tabs">
          <MissionConversationTab launcher={launcher} agentDock={agentDock} actionDock={actionDock} timeline={timeline} sessions={treeSessions} />
        </div>
      </div>
    )
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

function MarkdownMissionTab({ issueId, field }: { issueId: string; field: 'prd' | 'state' }) {
  const planning = usePlanningQuery(issueId, { enabled: true })
  return <MarkdownTab body={planning.data?.[field]} isLoading={planning.isLoading} emptyLabel={`No ${field.toUpperCase()} document.`} />
}

function PlanMissionTab({ issueId }: { issueId: string }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <CockpitCard tone="info" title="xBRIEF"><XBriefTab issueId={issueId} /></CockpitCard>
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

const NOW_LABEL: Record<string, string> = {
  work: 'Work', strike: 'Strike', review: 'Review', reviewer: 'Reviewer',
  test: 'Test', ship: 'Ship', merge: 'Ship', planning: 'Plan', legacy: 'Plan',
}
const NOW_MODEL_PLACEHOLDERS = new Set(['', 'unknown', 'specialist', 'planning', 'idle', 'none'])
function nowModel(m: string | undefined): string {
  const v = (m ?? '').trim()
  return NOW_MODEL_PLACEHOLDERS.has(v.toLowerCase()) ? '' : v.replace(/^claude-/, '')
}

const NOW_DOT: Record<CockpitTone, string> = {
  info: 'bg-info', success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive',
  review: 'bg-signal-review', cost: 'bg-signal-cost', muted: 'bg-muted-foreground',
}

interface NowState { tone: CockpitTone; text: string; agentType?: string; agentLabel?: string }
function deriveNow(rs: ReviewStatusData | undefined, active: { type: string; model?: string } | undefined): NowState {
  const label = active ? (NOW_LABEL[active.type] ?? active.type) : ''
  const model = active ? nowModel(active.model) : ''
  const agentLabel = active ? (model ? `${label.toLowerCase()} · ${model}` : label.toLowerCase()) : undefined
  if (rs?.mergeStatus === 'merged') return { tone: 'success', text: 'Merged — ready to close out' }
  if (rs?.readyForMerge) return { tone: 'success', text: 'Review & tests passed — ready to merge' }
  if (rs?.reviewStatus === 'blocked' || rs?.reviewStatus === 'failed') {
    const onIt = active?.type === 'work'
    return { tone: 'destructive', text: onIt ? 'Review blocked — work agent is fixing it' : 'Review blocked — awaiting the work agent', agentType: onIt ? 'work' : undefined, agentLabel: onIt ? agentLabel : undefined }
  }
  if (rs?.testStatus === 'testing') return { tone: 'info', text: 'Tests running' }
  if (rs?.verificationStatus === 'running') return { tone: 'info', text: 'Verification running' }
  if (active) return { tone: 'info', text: `${label} agent is working`, agentType: active.type, agentLabel }
  return { tone: 'muted', text: 'Idle — awaiting the pipeline' }
}

/** Lean Overview "Now" panel (PAN-1991 #9) — only what the header gates, the
 * Agents lane, and the beads rail don't already show: what's happening, the next
 * action, the diff size, and the last few status events. No status grid. */
function NowPanel({ issueId, onTab, onOpenAgent }: { issueId: string; onTab: (tab: MissionTab) => void; onOpenAgent: (type: string) => void }) {
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const activity = useActivityQuery(issueId)
  const rs = review.data
  const p = pr.data?.pr
  const sections = activity.data?.sections ?? []
  const active = sections.find((s) => s.status === 'running' || s.status === 'active' || s.status === 'starting')
  const hasWork = sections.some((s) => s.type === 'work')
  const now = deriveNow(rs, active)
  const recent = [...(rs?.history ?? [])]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 3)
  const nowDate = new Date()
  const lk = 'rounded-[8px] border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent'

  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
        <span className={`h-[9px] w-[9px] shrink-0 rounded-full ${NOW_DOT[now.tone]}`} />
        <span>{now.text}</span>
        {now.agentLabel && (
          <button type="button" onClick={() => now.agentType && onOpenAgent(now.agentType)} className="rounded-[6px] border border-info/40 bg-info/10 px-1.5 font-mono text-[11px] text-info-foreground">
            {now.agentLabel}
          </button>
        )}
      </div>
      <div className="mt-2.5 text-[12.5px]">
        <span className="text-muted-foreground">Next:</span> {nextAction(rs)}
        {p && <> · <span className="text-muted-foreground">diff</span> <span className="text-success-foreground">+{p.additions}</span> <span className="text-destructive-foreground">−{p.deletions}</span> · {p.changedFiles} file{p.changedFiles === 1 ? '' : 's'}</>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {hasWork && <button type="button" className={lk} onClick={() => onOpenAgent('work')}>Open work agent ↗</button>}
        {p && <button type="button" className={lk} onClick={() => onTab('code')}>Open diff →</button>}
        {p?.url && <a className={lk} href={p.url} target="_blank" rel="noreferrer">Open PR ↗</a>}
      </div>
      {recent.length > 0 && (
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <span>Recent activity</span>
            <button type="button" className="text-[10px] normal-case tracking-normal text-muted-foreground hover:text-foreground" onClick={() => onTab('timeline')}>→ Timeline</button>
          </div>
          {recent.map((h, i) => (
            <div key={`${h.type}-${h.timestamp}-${i}`} className="flex items-baseline gap-2.5 py-1 text-[12.5px]">
              <span className={`mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full ${NOW_DOT[statusToTone(h.status)]}`} />
              <span className="capitalize">{h.type} {h.status}</span>
              <span className="ml-auto text-[10.5px] text-muted-foreground">{formatRelativeTime(h.timestamp, nowDate)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Overview — crew, feed, plan map, blocker spotlight, Now panel (PAN-2398). */
type OverviewTabProps = { issueId: string; onTab: (tab: MissionTab) => void; onOpenAgent: (type: string) => void; sessions?: readonly SessionNode[]; onSelectSession?: (session: SessionNode) => void }
function OverviewTab({ issueId, onTab, onOpenAgent, sessions, onSelectSession }: OverviewTabProps) {
  return (
    <div className="space-y-3.5">
      {sessions && onSelectSession && <CrewStage sessions={sessions} onSelectSession={onSelectSession} />}
      <div data-section="UatEnvironmentPanel"><UatEnvironmentPanel issueId={issueId} /></div>
      <HappenedFeed issueId={issueId} />
      <PlanMapCard issueId={issueId} />
      <IssueBlockerSpotlight issueId={issueId} />
      <div data-section="NowPanel"><NowPanel issueId={issueId} onTab={onTab} onOpenAgent={onOpenAgent} /></div>
      <div data-section="PickupGateCard"><PickupGateCard issueId={issueId} /></div>
    </div>
  )
}

function tabBadge(tab: MissionTab, checks: ReturnType<typeof useIssueCheckRunsQuery>['data']): { label: string; tone: CockpitTone } | null {
  if (tab === 'code' && checks?.summary.total) return { label: checks.summary.failed ? '!' : checks.summary.running || checks.summary.pending ? '…' : '✓', tone: checks.summary.failed ? 'destructive' : checks.summary.running || checks.summary.pending ? 'info' : 'success' }
  return null
}

export function IssueMissionControl({ issueId, title, branch, projectName, launcher, agentDock, actionDock, timeline, onOpenPane }: IssueMissionControlProps) {
  const [activeTab, setActiveTab] = useState<MissionTab | null>('overview')
  const [treeContext, setTreeContext] = useState<IssueTreeContext | null>(null)
  const [selectedTreeSession, setSelectedTreeSession] = useState<SessionNode | null>(null)
  const [treeSessions, setTreeSessions] = useState<readonly SessionNode[]>([])
  const [tasksDrawerOpen, setTasksDrawerOpen] = useState(false)
  const [spineCollapsed, setSpineCollapsed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(SPINE_COLLAPSED_KEY) === 'true',
  )
  const tasksQuery = useTasksQuery(issueId)
  const tasksRollup = taskStatusRollup(tasksQuery.data?.tasks ?? [])
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const checks = useIssueCheckRunsQuery(issueId)
  const costs = useIssueCostsQuery(issueId)
  const headerActions = useIssueActions(issueId)
  const phase = phaseStatus(review.data)
  const cost = costs.data?.resolvedTotalCost ?? costs.data?.totalCost ?? 0
  const toggleSpine = () => {
    setSpineCollapsed((collapsed) => {
      const next = !collapsed
      window.localStorage.setItem(SPINE_COLLAPSED_KEY, String(next))
      return next
    })
  }
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
  // Open an agent's conversation by session type (work/review/test/…). Shared by
  // the pipeline phases (#4) and the Overview "Now" links (#9).
  const openAgentByType = (type: string): boolean => {
    const session = treeSessions.find((s) => s.type === type)
    if (session) { selectSessionFromTree(session); return true }
    return false
  }
  // PAN-1991 #4/#6: clicking a pipeline phase opens that phase's info. Work/
  // Review/Test open the agent's own conversation/findings (per #6, review
  // findings live on the Review agent, not a status tab); CI/CD opens Code.
  const handleStageClick = (stage: JourneyStageKey) => {
    const map: Record<JourneyStageKey, PipelinePhaseKey> = {
      planned: 'plan', building: 'work', reviewing: 'review', testing: 'test', shipping: 'merge',
    }
    handlePhaseClick(map[stage])
  }
  const handlePhaseClick = (phase: PipelinePhaseKey) => {
    if (phase === 'work') { if (!openAgentByType('work')) selectTab('overview'); return }
    if (phase === 'review') { if (!openAgentByType('review')) selectTab('overview'); return }
    if (phase === 'test') { if (!openAgentByType('test')) selectTab('overview'); return }
    if (phase === 'plan') { selectTab('plan'); return }
    if (phase === 'ci') { selectTab('code'); return }
    selectTab('ship') // PAN-2487: ship / merge phases open the Ship & Merge view
  }
  const recordTreeSessions = useCallback((sessions: readonly SessionNode[]) => {
    setTreeSessions(sessions)
    setSelectedTreeSession((current) => {
      if (!current) return current
      return sessions.find((session) => session.sessionId === current.sessionId) ?? current
    })
  }, [])

  return (
    <IssueView issueId={issueId} density="cockpit" className={styles.missionWrap}>
      <header data-section="Header bar" className="rounded-[22px] border border-border bg-card p-4">
        <div className={styles.headerTop}>
          <div className={styles.headerTitle}>
            <div className="text-[11px] text-muted-foreground/70">
              {projectName ? <><span className="text-muted-foreground">{projectName}</span> / </> : null}Issues
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-medium text-foreground">{issueId}</span>
              <h1 className="min-w-0 max-w-full break-words text-[16px] font-medium leading-snug text-foreground">{title}</h1>
              <CockpitPill tone={statusToTone(phase)}>{phase}</CockpitPill>
            </div>
          </div>
          <div className={styles.headerMeta}>
            <div className="flex items-start gap-4">
              <HeaderStat label="Branch" value={<span className="font-mono">{branch}</span>} />
              <HeaderStat
                label="PR / CI"
                value={pr.data?.pr
                  ? `#${pr.data.pr.number}${checks.data?.summary.total ? ` · ${checks.data.summary.passed}/${checks.data.summary.total}` : ''}`
                  : 'no PR'}
              />
              <HeaderStat
                label="Cost"
                value={<span className="text-signal-cost-foreground tabular-nums">{cost > 0 ? `$${cost.toFixed(2)}` : '—'}</span>}
              />
            </div>
            <div className="flex items-center gap-2">
              {/* PAN-2908 C-ACTIONS: merge flows through the shared registry menu
                  (primary at READY_TO_MERGE); the bespoke MergeCta is gone. */}
              <IssueActionMenu issueId={issueId} mode="primary-strip" className="flex items-center gap-1" />
            </div>
          </div>
        </div>
        <div data-section="StatusNarrative" className="mt-4 border-t border-border pt-4">
          <StatusNarrative
            issueId={issueId}
            hasPlan={headerActions.state.hasPlan}
            workRunning={phase === 'pending'}
            cost={cost > 0 ? `$${cost.toFixed(2)}` : undefined}
            onStageClick={handleStageClick}
          />
        </div>
      </header>

      <nav data-section="Detail Tabs" className="flex flex-nowrap gap-1 overflow-x-auto border-b border-border bg-card px-3 pt-2" aria-label="Issue cockpit tabs">
        {TABS.map((tab) => {
          const badge = tabBadge(tab.id, checks.data)
          return (
            <button
              key={tab.id}
              type="button"
              aria-selected={activeTab === tab.id}
              onClick={() => selectTab(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/9 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
              {badge && <CockpitPill tone={badge.tone} className="px-[5px] py-0 text-[9px]">{badge.label}</CockpitPill>}
            </button>
          )
        })}
        <button
          type="button"
          data-section="TasksRail / TasksTab"
          aria-expanded={tasksDrawerOpen}
          aria-label={`Tasks: ${tasksRollup.done} of ${tasksRollup.total} complete. Open plan progress`}
          onClick={() => setTasksDrawerOpen(true)}
          className="sticky right-0 ml-auto flex shrink-0 items-center gap-2 rounded-[9px] border badge-border-primary badge-bg-primary px-3 py-2 text-[12px] font-medium text-primary shadow-[-10px_0_14px_var(--card)] transition-colors hover:bg-primary/15"
        >
          <span>Tasks</span>
          <span className="tabular-nums">{tasksRollup.done}/{tasksRollup.total}</span>
          <span className="h-1 w-12 overflow-hidden rounded-[var(--radius-sm)] bg-border" aria-hidden="true">
            <span className="block h-full bg-primary" style={{ width: `${tasksRollup.percentDone}%` }} />
          </span>
        </button>
      </nav>

      <div
        className={`${styles.missionBody} ${spineCollapsed ? styles.spineCollapsed : ''}`}
        data-spine-collapsed={spineCollapsed}
      >
        <div data-section="AgentsLane"><IssueTreeLane
          issueId={issueId}
          title={title}
          projectName={projectName}
          selectedSessionId={selectedTreeSession?.sessionId ?? null}
          spineCollapsed={spineCollapsed}
          onToggleSpine={toggleSpine}
          onSelectSession={selectSessionFromTree}
          onSessionsChange={recordTreeSessions}
          onOpenVerification={() => selectTab('overview')}
        /></div>
        <main className="min-w-0 rounded-[20px] border border-border bg-card/30">
          <div className="p-4">
            {(treeContext || selectedTreeSession) && (
              <div data-section="SessionPanel"><IssueTreeContextPanel
                context={treeContext ?? 'issue'}
                issueId={issueId}
                selectedSession={selectedTreeSession}
                treeSessions={treeSessions}
                launcher={launcher}
                agentDock={agentDock}
                actionDock={actionDock}
                timeline={timeline}
                onBackToIssue={selectIssueFromTree}
                onTab={selectTab}
                onOpenAgent={openAgentByType}
              /></div>
            )}
            {activeTab === 'overview' && <div data-section="Awareness rail"><OverviewTab issueId={issueId} onTab={selectTab} onOpenAgent={openAgentByType} sessions={treeSessions} onSelectSession={selectSessionFromTree} /></div>}
            {activeTab === 'code' && (
              <div data-section="Code tab" className="space-y-3.5">
                <GitHubCiPanel issueId={issueId} />
                <ChangedFilesView issueId={issueId} />
              </div>
            )}
            {activeTab === 'plan' && <div data-section="PRD / Timeline / Discussion tabs"><PlanMissionTab issueId={issueId} /></div>}
            {activeTab === 'timeline' && (
              <div data-section="PRD / Timeline / Discussion tabs" className="space-y-4">
                <div>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Status history</h3>
                  <StatusHistoryTab issueId={issueId} />
                </div>
                <div>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Activity</h3>
                  <ActivityTab issueId={issueId} />
                </div>
              </div>
            )}
            {activeTab === 'discussion' && <div data-section="PRD / Timeline / Discussion tabs"><DiscussionsTab issueId={issueId} /></div>}
            {activeTab === 'costs' && <div data-section="Costs / Artifacts / Ship tabs"><CostsTab issueId={issueId} /></div>}
            {activeTab === 'artifacts' && <div data-section="Costs / Artifacts / Ship tabs"><DrawerArtifactsPanel issueId={issueId} /></div>}
            {activeTab === 'ship' && <div data-section="Costs / Artifacts / Ship tabs"><ShipTab issueId={issueId} /></div>}
            {activeTab === 'files' && <div data-section="Conversation / Files / Terminal tabs"><OpenPaneCard title="Files" description="Open the issue-scoped workspace file browser in a deck pane." action="Open files pane" onOpen={() => onOpenPane('files')} /></div>}
            {activeTab === 'terminal' && <div data-section="Conversation / Files / Terminal tabs"><OpenPaneCard title="Terminal" description="Open the issue terminal drawer for the current workspace." action="Open terminal" onOpen={() => onOpenPane('terminal')} /></div>}
            {activeTab === 'beads' && <div data-section="TasksRail / TasksTab"><TasksTab issueId={issueId} /></div>}
          </div>
        </main>
      </div>
      <TasksDrawer
        issueId={issueId}
        open={tasksDrawerOpen}
        query={tasksQuery}
        rollup={tasksRollup}
        onClose={() => setTasksDrawerOpen(false)}
        onOpenFull={() => selectTab('beads')}
      />
    </IssueView>
  )
}
