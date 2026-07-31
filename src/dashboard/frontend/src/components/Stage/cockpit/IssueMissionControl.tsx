import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Copy, ExternalLink, GitBranch, GitPullRequest } from 'lucide-react'
import { ActivityTab } from '../../CommandDeck/ZoneCOverviewTabs/ActivityTab'
import { ShipTab } from './ShipTab'
import { CostsTab } from '../../CommandDeck/ZoneCOverviewTabs/CostsTab'
import { DiscussionsTab } from '../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab'
import { statusColor } from '../../CommandDeck/ZoneCOverviewTabs/PrDiffTab'
import {
  useActivityQuery,
  useIssueCheckRunsQuery,
  useIssueCostsQuery,
  usePrQuery,
  useReviewStatusQuery,
  type IssueCheckRun,
  type ReviewStatusData,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { IssueActionMenu } from '../../IssueActionMenu/IssueActionMenu'
import { useIssueActions } from '../../IssueActionMenu/useIssueActions'
import { selectAgents, selectReviewStatus, useDashboardStore } from '../../../lib/store'
import { derivePipelineState, type PipelineState } from '../../../lib/issuePipelineState'
import { currentPhase, phaseLabel } from '../../../lib/simple/phases'
import { IssueDetail } from '../../issue-detail/IssueDetail'
import { IssueView } from '../../issue-view/IssueView'
import { NeedsYouSlot } from '../../issue-view/NeedsYouSlot'
import { TellComposer } from '../../issue-view/TellComposer'
import { useIssueView } from '../../issue-view/useIssueView'
import { SessionPanel } from '../../CommandDeck/SessionView/SessionPanel'
import { MissionConversationTab } from './MissionConversationTab'
import type { PaneType } from '../../../lib/panesStore'
import { formatRelativeTime } from '../../../lib/formatRelativeTime'
import { trackerIssueUrl } from '../../../lib/issueLinks'
import { taskStatusRollup } from '../../../lib/taskStatus'
import { TasksPanel } from '../../TasksPanel'
import { PrdViewer } from '../../PrdViewer'
import type { XBriefDocument } from '../../xbrief/types'
import { IssueBlockerSpotlight } from './IssueBlockerSpotlight'
import { IssueTreeLane } from './IssueTreeLane'
import { UatEnvironmentPanel } from '../../CommandDeck/UatEnvironmentPanel'
import { PickupGateCard } from './PickupGateCard'
import { ChangedFilesView } from './ChangedFilesView'
import { StatusHistoryTab } from './StatusHistoryTab'
import { HappenedFeed } from './HappenedFeed'
import { PlanMapCard } from './PlanMapCard'
import { StatusNarrative } from './StatusNarrative'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'
import type { SessionNode } from '@overdeck/contracts'
import type { Agent } from '../../../types'
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

type MissionTab = 'overview' | 'session' | 'plan' | 'changes' | 'activity' | 'discussion'
type MissionSubView = 'conversation' | 'terminal' | 'tasks' | 'map' | 'prd' | 'files' | 'checks' | 'artifacts' | 'feed' | 'history'
type TabSelection = { tab: MissionTab; subView?: MissionSubView }

/** Tabs whose bodies delegate to the ONE IssueDetail component for at least one sub-view. */
const ISSUE_DETAIL_TAB_IDS = new Set<MissionTab>(['session', 'changes', 'activity'])

const TABS: Array<{ id: MissionTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'session', label: 'Session' },
  { id: 'plan', label: 'Plan' },
  { id: 'changes', label: 'Changes' },
  { id: 'activity', label: 'Activity' },
  { id: 'discussion', label: 'Discussion' },
]

// Legacy cockpit tab ids → { tab, subView }. Applied when reading the route/tab param.
const LEGACY_TAB_MAP: Record<string, TabSelection> = {
  conversation: { tab: 'session', subView: 'conversation' },
  terminal: { tab: 'session', subView: 'terminal' },
  tasks: { tab: 'plan', subView: 'tasks' },
  code: { tab: 'changes', subView: 'checks' },
  files: { tab: 'changes', subView: 'files' },
  artifacts: { tab: 'changes', subView: 'artifacts' },
  timeline: { tab: 'activity', subView: 'history' },
  costs: { tab: 'overview' },
  ship: { tab: 'overview' },
}

const DEFAULT_SUB_VIEW: Partial<Record<MissionTab, MissionSubView>> = {
  session: 'conversation',
  plan: 'map',
  changes: 'files',
  activity: 'feed',
}

function resolveTabSelection(tabId: string | null): TabSelection | null {
  if (!tabId) return null
  const legacy = LEGACY_TAB_MAP[tabId]
  if (legacy) return legacy
  const tab = TABS.find((candidate) => candidate.id === tabId)?.id
  return tab ? { tab, subView: DEFAULT_SUB_VIEW[tab] } : null
}

function issueDetailTabFor(tab: MissionTab | null, subView: MissionSubView | undefined): string | null {
  if (!tab || !ISSUE_DETAIL_TAB_IDS.has(tab)) return null
  if (tab === 'session') return subView === 'terminal' ? 'terminal' : 'conversation'
  if (tab === 'changes') return subView === 'artifacts' ? 'artifacts' : subView === 'checks' ? null : 'files'
  if (tab === 'activity') return subView === 'history' ? null : 'activity'
  return null
}

type IssueTreeContext = 'issue'

const SPINE_COLLAPSED_KEY = 'overdeck.cockpit.spineCollapsed'

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

// PAN-2908: the cockpit's bespoke phaseStatus() derivation is deleted — the
// header pill speaks the ONE shared machine (derivePipelineState) and the
// six-word vocabulary (phaseLabel), same as the board, drawer, and rail.
function pillTone(state: PipelineState): CockpitTone {
  if (state === 'merged' || state === 'done') return 'success'
  if (state === 'in_review_changes_requested' || state === 'testing_failures' || state === 'verification_failing' || state === 'canceled') return 'destructive'
  if (state === 'generic') return 'muted'
  return 'info'
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



function githubCompareUrl(issueUrl: string | null, branch: string): string | null {
  if (!issueUrl) return null
  const match = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/issues\/\d+$/.exec(issueUrl)
  return match ? `${match[1]}/compare/main...${encodeURIComponent(branch)}?expand=1` : null
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
  onTab: (tab: MissionTab, subView?: MissionSubView) => void
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
function NowPanel({ issueId, onTab, onOpenAgent }: { issueId: string; onTab: (tab: MissionTab, subView?: MissionSubView) => void; onOpenAgent: (type: string) => void }) {
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
        {p && <button type="button" className={lk} onClick={() => onTab('changes', 'checks')}>Open diff →</button>}
        {p?.url && <a className={lk} href={p.url} target="_blank" rel="noreferrer">Open PR ↗</a>}
      </div>
      {recent.length > 0 && (
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <span>Recent activity</span>
            <button type="button" className="text-[10px] normal-case tracking-normal text-muted-foreground hover:text-foreground" onClick={() => onTab('activity', 'history')}>→ Timeline</button>
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
type OverviewTabProps = { issueId: string; onTab: (tab: MissionTab, subView?: MissionSubView) => void; onOpenAgent: (type: string) => void }
function OverviewTab({ issueId, onTab, onOpenAgent }: OverviewTabProps) {
  return (
    <div className="space-y-3.5">
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
  if (tab === 'changes' && checks?.summary.total) return { label: checks.summary.failed ? '!' : checks.summary.running || checks.summary.pending ? '…' : '✓', tone: checks.summary.failed ? 'destructive' : checks.summary.running || checks.summary.pending ? 'info' : 'success' }
  return null
}

export function IssueMissionControl({ issueId, title, branch, projectName, launcher, agentDock, actionDock, timeline }: IssueMissionControlProps) {
  const allAgents = useDashboardStore(selectAgents) as Agent[]
  const issueAgents = useMemo(
    () => allAgents.filter((a) => a.issueId?.toLowerCase() === issueId.toLowerCase()),
    [allAgents, issueId],
  )
  const routeSelection = useMemo(
    () => resolveTabSelection(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab')),
    [],
  )
  const initialTab = routeSelection?.tab ?? (issueAgents.length > 0 ? 'session' : 'overview')
  const [activeTab, setActiveTab] = useState<MissionTab | null>(initialTab)
  const [activeSubView, setActiveSubView] = useState<MissionSubView | undefined>(
    routeSelection?.subView ?? DEFAULT_SUB_VIEW[initialTab],
  )
  const tabSelectionLocked = useRef(Boolean(routeSelection) || issueAgents.length > 0)
  const [treeContext, setTreeContext] = useState<IssueTreeContext | null>(null)
  const [selectedTreeSession, setSelectedTreeSession] = useState<SessionNode | null>(null)
  const [treeSessions, setTreeSessions] = useState<readonly SessionNode[]>([])
  // Operator decision (#2962): the session-tree lane starts collapsed behind a
  // toggle (persisted preference honored).
  const [spineCollapsed, setSpineCollapsed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(SPINE_COLLAPSED_KEY) !== 'false',
  )
  const planQuery = useQuery<XBriefDocument | null>({
    queryKey: ['plan', issueId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${issueId}/plan`)
      if (!response.ok) return null
      return response.json() as Promise<XBriefDocument>
    },
    staleTime: 60_000,
  })
  const tasksRollup = taskStatusRollup(planQuery.data?.plan?.items ?? [])
  const review = useReviewStatusQuery(issueId)
  const pr = usePrQuery(issueId)
  const checks = useIssueCheckRunsQuery(issueId)
  const costs = useIssueCostsQuery(issueId)
  const headerActions = useIssueActions(issueId)
  const issueView = useIssueView(issueId, { title, branch, projectName })
  const reviewSnapshot = useDashboardStore(selectReviewStatus(issueId))
  const issueRecord = useDashboardStore((s) =>
    (s.issuesRaw as Array<{ identifier: string; state?: string; status?: string; url?: string }> | undefined)?.find(
      (candidate) => candidate.identifier === issueId,
    ),
  )
  // PAN-2908 C-VOCAB/one-data-model: the header pill runs on the shared
  // pipeline machine (WS snapshot first, HTTP detail as warmup fallback) —
  // no bespoke phase re-derivation on this surface.
  const primaryAgent = useMemo(() => {
    const live = issueAgents.filter((a) => a.status === 'running' || a.status === 'starting')
    return live.find((a) => a.role === 'work') ?? live[0] ?? issueAgents[0] ?? null
  }, [issueAgents])
  const workAgentRunning = useMemo(
    () => issueAgents.some((a) => a.role === 'work' && (a.status === 'running' || a.status === 'starting')),
    [issueAgents],
  )
  const sessionTarget = useMemo(
    () => treeSessions.find((session) => session.presence === 'active')
      ?? treeSessions.find((session) => !session.sessionId.endsWith('-planning-state'))
      ?? null,
    [treeSessions],
  )
  const sessionTargetAgent = useMemo(
    () => issueAgents.find((agent) => agent.id === sessionTarget?.sessionId) ?? primaryAgent,
    [issueAgents, primaryAgent, sessionTarget?.sessionId],
  )
  const sessionComposerAgentId = sessionTargetAgent?.id ?? sessionTarget?.sessionId ?? null
  const sessionComposerIsLive = sessionTargetAgent
    ? sessionTargetAgent.status === 'running' || sessionTargetAgent.status === 'starting'
    : sessionTarget?.presence === 'active'
  const hasLiveSession = issueAgents.some((agent) => agent.status === 'running' || agent.status === 'starting')
    || treeSessions.some((session) => session.presence === 'active')
  const pipelineState = derivePipelineState({
    reviewStatus: (reviewSnapshot ?? review.data ?? null),
    agent: primaryAgent,
    hasPlan: headerActions.state.hasPlan,
    hasTasks: tasksRollup.total > 0,
    issueCanonicalState: issueRecord?.state ?? issueRecord?.status ?? null,
    isMerged: (reviewSnapshot ?? review.data)?.mergeStatus === 'merged',
  })
  const currentPhaseKey = currentPhase(pipelineState)
  const phase = currentPhaseKey
    ? phaseLabel(currentPhaseKey)
    : pipelineState === 'merged' || pipelineState === 'done'
      ? phaseLabel('done')
      : '—'
  const cost = costs.data?.resolvedTotalCost ?? costs.data?.totalCost ?? 0
  const trackerHref = trackerIssueUrl(issueId, issueRecord?.url)
  const createPrHref = pr.data?.pr ? null : githubCompareUrl(trackerHref, branch)
  const issueDetailTab = issueDetailTabFor(activeTab, activeSubView)

  useEffect(() => {
    if (tabSelectionLocked.current || issueAgents.length === 0) return
    tabSelectionLocked.current = true
    setActiveTab('session')
    setActiveSubView('conversation')
  }, [issueAgents.length])

  const toggleSpine = () => {
    setSpineCollapsed((collapsed) => {
      const next = !collapsed
      window.localStorage.setItem(SPINE_COLLAPSED_KEY, String(next))
      return next
    })
  }
  const selectTab = (tab: MissionTab, subView: MissionSubView | undefined = DEFAULT_SUB_VIEW[tab]) => {
    tabSelectionLocked.current = true
    setActiveTab(tab)
    setActiveSubView(subView)
    setTreeContext(null)
    setSelectedTreeSession(null)
  }
  const selectIssueFromTree = () => {
    tabSelectionLocked.current = true
    setTreeContext('issue')
    setSelectedTreeSession(null)
    setActiveTab(null)
    setActiveSubView(undefined)
  }
  const selectSessionFromTree = (session: SessionNode) => {
    tabSelectionLocked.current = true
    setSelectedTreeSession(session)
    setTreeContext(null)
    setActiveTab(null)
    setActiveSubView(undefined)
  }
  // Open an agent's conversation by session type (work/review/test/…). Shared by
  // the pipeline phases (#4) and the Overview "Now" links (#9).
  const openAgentByType = (type: string): boolean => {
    const session = treeSessions.find((s) => s.type === type)
    if (session) { selectSessionFromTree(session); return true }
    return false
  }
  const recordTreeSessions = useCallback((sessions: readonly SessionNode[]) => {
    setTreeSessions(sessions)
    setSelectedTreeSession((current) => {
      if (!current) return current
      return sessions.find((session) => session.sessionId === current.sessionId) ?? current
    })
    if (!tabSelectionLocked.current && sessions.length > 0) {
      tabSelectionLocked.current = true
      setActiveTab('session')
      setActiveSubView('conversation')
    }
  }, [])

  return (
    <IssueView issueId={issueId} density="cockpit" className={styles.missionWrap}>
      <header data-section="Header bar" className="rounded-[22px] border border-border bg-card p-4">
        <div className={styles.headerTop}>
          <div className={styles.headerTitle}>
            <div className="text-[11px] text-muted-foreground/70">
              {projectName ? <><span className="text-muted-foreground">{projectName}</span> / </> : null}<span>Issues</span> / <span className="font-mono text-foreground">{issueId}</span>
            </div>
            <h1 className="mt-1 min-w-0 max-w-full break-words text-[17px] font-medium leading-snug text-foreground">{title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CockpitPill tone={pillTone(pipelineState)}>{phase}</CockpitPill>
              <StatusNarrative
                issueId={issueId}
                hasPlan={headerActions.state.hasPlan}
                workRunning={workAgentRunning}
              />
            </div>
          </div>
          <div className={styles.headerMeta}>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span
                data-testid="header-branch-chip"
                className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-background/40 px-2 text-[11px] text-muted-foreground"
              >
                <GitBranch size={12} aria-hidden="true" />
                <span className="max-w-44 truncate font-mono text-foreground">{branch}</span>
                <button
                  type="button"
                  aria-label="Copy branch name"
                  title="Copy branch name"
                  className="grid h-5 w-5 place-items-center rounded-[var(--radius-sm)] hover:bg-accent hover:text-foreground"
                  onClick={() => void navigator.clipboard?.writeText(branch)}
                >
                  <Copy size={11} aria-hidden="true" />
                </button>
              </span>

              {pr.data?.pr ? (
                <a
                  href={checks.data?.pr?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-background/40 px-2 text-[11px] text-foreground hover:bg-accent"
                >
                  <GitPullRequest size={12} aria-hidden="true" />
                  <span className="font-mono">PR #{pr.data.pr.number}</span>
                  {checks.data?.summary.total ? <span className="text-muted-foreground">{checks.data.summary.passed}/{checks.data.summary.total}</span> : null}
                </a>
              ) : (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-background/40 px-2 text-[11px] text-muted-foreground">
                  <GitPullRequest size={12} aria-hidden="true" />
                  <span>No PR</span>
                  {createPrHref ? <a href={createPrHref} target="_blank" rel="noreferrer" className="text-primary hover:underline">Create PR</a> : null}
                </span>
              )}

              <span
                data-testid="header-cost-chip"
                aria-label={`Cost ${cost > 0 ? `$${cost.toFixed(2)}` : 'unavailable'}`}
                className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border badge-border-signal-cost badge-bg-signal-cost px-2 font-mono text-[11px] font-medium tabular-nums text-signal-cost-foreground"
              >
                {cost > 0 ? `$${cost.toFixed(2)}` : '—'}
              </span>

              {trackerHref ? (
                <a
                  data-testid="header-tracker-link"
                  href={trackerHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center overflow-hidden rounded-[var(--radius-sm)] border border-border bg-background/40 text-[11px] text-foreground hover:bg-accent"
                >
                  <span className="inline-flex h-full items-center gap-1.5 px-2">
                    Open tracker <ExternalLink size={11} aria-hidden="true" />
                  </span>
                  <span className="grid h-full w-6 place-items-center border-l border-border text-muted-foreground" aria-hidden="true">
                    <ChevronDown size={11} />
                  </span>
                </a>
              ) : null}

              {/* PAN-2908 C-ACTIONS: merge flows through the shared registry menu
                  (primary at READY_TO_MERGE); the bespoke MergeCta is gone. */}
              <IssueActionMenu issueId={issueId} mode="primary-strip" className="flex items-center gap-1" />
            </div>
          </div>
        </div>
        {/* PAN-2908 C-DETAIL: the pipeline band lives inside IssueDetail now —
            the cockpit route renders the ONE component, no duplicate shell. */}
      </header>

      <NeedsYouSlot model={issueView} actions={headerActions.all} />

      <nav data-section="Detail Tabs" className="flex flex-nowrap gap-1 overflow-x-auto border-b border-border bg-card px-3 pt-2" aria-label="Issue cockpit tabs">
        {TABS.map((tab) => {
          const badge = tabBadge(tab.id, checks.data)
          return (
            <button
              key={tab.id}
              type="button"
              aria-selected={activeTab === tab.id}
              aria-label={tab.id === 'plan' ? tab.label : undefined}
              onClick={() => selectTab(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary/9 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.id === 'session' && hasLiveSession ? (
                <span data-testid="session-live-dot" className="h-[7px] w-[7px] rounded-full bg-info" aria-hidden="true" />
              ) : null}
              {tab.label}
              {tab.id === 'plan' && tasksRollup.total > 0 ? (
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
                  {tasksRollup.done}/{tasksRollup.total}
                </span>
              ) : null}
              {badge && <CockpitPill tone={badge.tone} className="px-[5px] py-0 text-[9px]">{badge.label}</CockpitPill>}
            </button>
          )
        })}
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
        <main
          className="min-w-0 rounded-[20px] border border-border bg-card/30"
          data-active-tab={activeTab ?? undefined}
          data-active-subview={activeSubView}
        >
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
            {/* The six cockpit tabs fold the legacy surfaces into sub-views while
                preserving the ONE IssueDetail page-density renderer. */}
            {issueDetailTab && (
              <div
                data-section="IssueDetail page body"
                className={`h-[calc(100vh-340px)] min-h-[520px] ${activeTab === 'session' ? 'flex flex-col' : ''}`}
              >
                {activeTab === 'session' ? (
                  <div
                    role="tablist"
                    aria-label="Session views"
                    className="flex shrink-0 gap-1 border-b border-border px-3 py-2"
                  >
                    {(['conversation', 'terminal'] as const).map((subView) => (
                      <button
                        key={subView}
                        type="button"
                        role="tab"
                        aria-selected={activeSubView === subView}
                        onClick={() => selectTab('session', subView)}
                        className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                          activeSubView === subView
                            ? 'bg-primary/9 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {subView === 'conversation' ? 'Conversation' : 'Terminal'}
                      </button>
                    ))}
                  </div>
                ) : null}
                <IssueDetail
                  issueId={issueId}
                  density="page"
                  showTabs={false}
                  tab={issueDetailTab}
                  onSelectTab={(tab) => {
                    const selection = resolveTabSelection(tab)
                    if (selection) selectTab(selection.tab, selection.subView)
                  }}
                  agents={issueAgents}
                  reviewStatus={reviewSnapshot}
                  className={activeTab === 'session' ? 'min-h-0 flex-1' : undefined}
                />
                {activeTab === 'session' && activeSubView === 'conversation' && sessionComposerAgentId ? (
                  <TellComposer
                    agentId={sessionComposerAgentId}
                    isEffectivelyLive={sessionComposerIsLive}
                    className="shrink-0 border-t border-border bg-card/70 px-3 pb-3"
                  />
                ) : null}
              </div>
            )}
            {activeTab === 'plan' && (
              <div className="space-y-3.5">
                <div role="tablist" aria-label="Plan views" className="flex gap-1 border-b border-border pb-2">
                  {(['tasks', 'map', 'prd'] as const).map((subView) => (
                    <button
                      key={subView}
                      type="button"
                      role="tab"
                      aria-selected={activeSubView === subView}
                      onClick={() => selectTab('plan', subView)}
                      className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                        activeSubView === subView
                          ? 'bg-primary/9 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {subView === 'tasks' ? 'Tasks' : subView === 'map' ? 'Map' : 'PRD'}
                    </button>
                  ))}
                </div>
                {activeSubView === 'tasks' ? (
                  <div data-section="TasksRail / TasksTab"><TasksPanel issueId={issueId} /></div>
                ) : null}
                {activeSubView === 'map' ? <PlanMapCard issueId={issueId} /> : null}
                {activeSubView === 'prd' ? <PrdViewer issueId={issueId} onClose={() => selectTab('plan', 'map')} /> : null}
              </div>
            )}
            {activeTab === 'overview' && (
              <div data-section="Awareness rail" className="space-y-3.5">
                <OverviewTab issueId={issueId} onTab={selectTab} onOpenAgent={openAgentByType} />
                <div data-section="Costs / Artifacts / Ship tabs" className="space-y-3.5">
                  <CostsTab issueId={issueId} />
                  <ShipTab issueId={issueId} />
                </div>
              </div>
            )}
            {activeTab === 'changes' && activeSubView === 'checks' && (
              <div data-section="Code tab" className="space-y-3.5">
                <GitHubCiPanel issueId={issueId} />
                <ChangedFilesView issueId={issueId} />
              </div>
            )}
            {activeTab === 'activity' && activeSubView === 'history' && (
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
          </div>
        </main>
      </div>
    </IssueView>
  )
}
