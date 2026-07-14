import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ActivityTab } from '../../CommandDeck/ZoneCOverviewTabs/ActivityTab'
import { ShipTab } from './ShipTab'
import { TasksTab } from '../../CommandDeck/ZoneCOverviewTabs/TasksTab'
import { CostsTab } from '../../CommandDeck/ZoneCOverviewTabs/CostsTab'
import { DiscussionsTab } from '../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab'
import { MarkdownTab } from '../../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import { statusColor } from '../../CommandDeck/ZoneCOverviewTabs/PrDiffTab'
import { VBriefTab } from '../../CommandDeck/ZoneCOverviewTabs/VBriefTab'
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
import { MergeButton } from '../../MergeButton'
import { IssueActionDialogHost } from '../../IssueActionMenu/IssueActionMenu'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { ReviewPolicyControl } from '../../ReviewPolicyControl'
import { type ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import { SessionPanel } from '../../CommandDeck/SessionView/SessionPanel'
import type { PaneType } from '../../../lib/panesStore'
import { ISSUE_ACTIONS, type IssueActionGroup } from '../../../lib/issueActions'
import { AgentsLane } from './AgentsLane'
import { TasksRail } from './TasksRail'
import { ChangedFilesView } from './ChangedFilesView'
import { StatusHistoryTab } from './StatusHistoryTab'
import { StatusNarrative, type JourneyStageKey } from './StatusNarrative'
import { OverviewTab, statusToTone } from './OverviewTab'
import { CockpitCard, CockpitPill, type CockpitTone } from './CockpitCard'
import type { ProjectSessionTree, SessionNode } from '@overdeck/contracts'
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
  | 'conversation' // tool — relocates to a pane in #10
  | 'files'        // tool — #10
  | 'terminal'     // tool — #10
  | 'tasks'        // not a visible tab; reachable from the rail's "open full"

type PipelinePhaseKey = 'plan' | 'work' | 'review' | 'test' | 'ci' | 'ship' | 'merge'

type IssueTreeContext = 'issue'

// PAN-2398: status lives in StatusNarrative; tasks = rail; tools = panes.
const TABS: Array<{ id: MissionTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'code', label: 'Code' },
  { id: 'plan', label: 'PRD / Plan' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'discussion', label: 'Discussion' },
  { id: 'costs', label: 'Costs' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'ship', label: 'Ship' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'files', label: 'Files' },
  { id: 'terminal', label: 'Terminal' },
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
// PAN-1991 #4: active = blue (a machine is working), not purple (purple is
// reserved for review/ship/planning specialist activity). done = emerald,
// failed = red, ahead = neutral track.
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

function mergeBlockReason(rs: ReviewStatusData | undefined): string {
  if (!rs) return 'status unknown'
  if (rs.mergeStatus === 'merged') return 'merged'
  if (rs.reviewStatus === 'blocked' || rs.reviewStatus === 'failed') return 'blocked by review'
  if (rs.testStatus === 'failed' || rs.testStatus === 'dispatch_failed') return 'test failed'
  if (rs.reviewStatus !== 'passed') return 'review pending'
  if (rs.testStatus === 'pending' || rs.testStatus === 'testing') return 'test pending'
  return 'not ready'
}

function HeaderStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-px text-right">
      <div className="text-[9px] uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="text-[11.5px] text-foreground">{value}</div>
    </div>
  )
}

function MergeCta({ issueId, rs }: { issueId: string; rs: ReviewStatusData | undefined }) {
  if (rs?.mergeStatus === 'merged') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border badge-border-success badge-bg-success px-3 py-2 text-[12px] font-medium text-success-foreground">
        ✓ Merged
      </span>
    )
  }
  if (rs?.readyForMerge) {
    return <MergeButton issueId={issueId} reviewStatus={rs} variant="inspector" tone="primary" />
  }
  const reason = mergeBlockReason(rs)
  return (
    <button
      type="button"
      disabled
      title={`Merge gated: ${reason}`}
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-muted/40 px-3 py-2 text-[12px] font-medium text-muted-foreground opacity-80"
    >
      ⛔ Merge — {reason}
    </button>
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
  selectedSessionId,
  onSelectSession,
  onSessionsChange,
  onOpenVerification,
}: {
  issueId: string
  title: string
  projectName?: string
  selectedSessionId: string | null
  onSelectSession: (session: SessionNode) => void
  onSessionsChange: (sessions: readonly SessionNode[]) => void
  onOpenVerification: () => void
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
      ...(actions.state.hasTasks ? ['tasks' as const] : []),
      'workspace' as const,
    ],
    resourceDetails: {
      hasWorkspace: true,
      localBranchCount: 0,
      remoteBranchCount: 0,
      tmuxSessionCount: sessions.length,
      prs: [],
      hasVbrief: actions.state.hasPlan,
      hasTasks: actions.state.hasTasks,
      dockerContainerCount: 0,
      conversations: [],
    },
  }), [actions.state.hasTasks, actions.state.hasPlan, issueId, projectName, review.data, sessions, title])

  const feature = projectFeature.data ?? fallbackFeature
  const renderedSessions = useMemo(() => feature.sessions ?? [], [feature.sessions])

  // Stale-review detection (PAN-1866): quick review — the current hardcoded mode —
  // produces a single `review` parent and NO `reviewer` sub-sessions. So any reviewer
  // session is a leftover extended-review (convoy) ghost from a previous cycle that will
  // tangle a restart. Surface a warning that offers the complete review reset.
  // (When extended review returns this becomes a reviewRunId-mismatch check.)
  const staleReviewers = useMemo(
    () => renderedSessions.filter((session) => session.type === 'reviewer'),
    [renderedSessions],
  )

  useEffect(() => {
    onSessionsChange(renderedSessions)
  }, [onSessionsChange, renderedSessions])

  return (
    <aside className="min-w-0 rounded-[20px] border border-border bg-card/50 p-2" aria-label="Issue tree">
      {staleReviewers.length > 0 ? (
        <div className="mb-2 rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px]" role="alert">
          <div className="font-semibold text-amber-600 dark:text-amber-400">⚠ Stale review state</div>
          <div className="mt-0.5 text-muted-foreground">
            {staleReviewers.length} leftover review agent{staleReviewers.length === 1 ? '' : 's'} from a previous
            cycle (extended-review sub-reviewers). A fresh review can&rsquo;t run cleanly until they&rsquo;re cleared.
          </div>
          <button
            type="button"
            className="mt-1.5 rounded-[var(--radius-sm)] border border-destructive/50 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => actions.all.find((view) => view.action.key === 'purgeReview')?.invoke()}
          >
            Complete review reset
          </button>
        </div>
      ) : null}
      <AgentsLane
        issueId={issueId}
        sessions={renderedSessions}
        feature={feature}
        branch={feature.branch || `feature/${issueId.toLowerCase()}`}
        selectedSessionId={selectedSessionId}
        onSelectSession={onSelectSession}
        onOpenVerification={onOpenVerification}
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

  // Resume affordance for the work agent's own session: a stopped session with
  // a resumable thread previously offered NO way back in — the composer locks
  // and the operator had to know `pan resume` (2026-07-14). Reuses the
  // canonical resumeSession action (same dialog + endpoint as the Actions menu).
  const sessionActions = useIssueActions(issueId)
  const resumeView = sessionActions.all.find((view) => view.action.key === 'resumeSession')
  const showResume = !!selectedSession
    && selectedSession.type === 'work'
    && selectedSession.status !== 'running'
    && !!resumeView?.enabled

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
    if (context === 'issue') return <OverviewTab issueId={issueId} onTab={onTab} onOpenAgent={onOpenAgent} />
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
        <div className="flex shrink-0 items-center gap-2">
          {showResume && resumeView && (
            <button
              type="button"
              onClick={resumeView.invoke}
              disabled={resumeView.isPending}
              data-testid="session-resume-button"
              className="rounded-[var(--radius-sm)] border border-info/40 bg-info/10 px-2.5 py-1.5 text-[12px] font-semibold text-info-foreground hover:bg-info/20 disabled:opacity-60"
            >
              {resumeView.isPending ? 'Resuming…' : '▶ Resume session'}
            </button>
          )}
          <button
            type="button"
            onClick={onBackToIssue}
            className="rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-accent"
          >
            Issue overview
          </button>
        </div>
      </div>
      {body}
      <IssueActionDialogHost issueId={issueId} actions={sessionActions} />
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

function tabBadge(tab: MissionTab, checks: ReturnType<typeof useIssueCheckRunsQuery>['data']): { label: string; tone: CockpitTone } | null {
  if (tab === 'code' && checks?.summary.total) return { label: checks.summary.failed ? '!' : checks.summary.running || checks.summary.pending ? '…' : '✓', tone: checks.summary.failed ? 'destructive' : checks.summary.running || checks.summary.pending ? 'info' : 'success' }
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
  const headerActions = useIssueActions(issueId)
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
    <div className={styles.missionWrap}>
      <header className="rounded-[22px] border border-border bg-card p-4">
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
              {/* PAN-1874: per-issue review mode / re-review scope override (same
                  control as the session-view IssueHeader; PAN-2499's unified view
                  inventories it once). */}
              <ReviewPolicyControl issueId={issueId} />
              <MergeCta issueId={issueId} rs={review.data} />
              <IssueActionMegaMenu issueId={issueId} />
            </div>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <StatusNarrative
            issueId={issueId}
            hasPlan={headerActions.state.hasPlan}
            workRunning={phase === 'pending'}
            cost={cost > 0 ? `$${cost.toFixed(2)}` : undefined}
            onStageClick={handleStageClick}
          />
        </div>
      </header>

      <div className={styles.missionBody}>
        <IssueTreeLane
          issueId={issueId}
          title={title}
          projectName={projectName}
          selectedSessionId={selectedTreeSession?.sessionId ?? null}
          onSelectSession={selectSessionFromTree}
          onSessionsChange={recordTreeSessions}
          onOpenVerification={() => selectTab('overview')}
        />
        <main className="min-w-0 rounded-[20px] border border-border bg-card/30">
          <nav className="flex flex-wrap gap-1 border-b border-border bg-card px-3 pt-2" aria-label="Issue cockpit tabs">
            {TABS.map((tab) => {
              const badge = tabBadge(tab.id, checks.data)
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
                onTab={selectTab}
                onOpenAgent={openAgentByType}
              />
            )}
            {activeTab === 'overview' && <OverviewTab issueId={issueId} onTab={selectTab} onOpenAgent={openAgentByType} sessions={treeSessions} onSelectSession={selectSessionFromTree} />}
            {activeTab === 'code' && (
              <div className="space-y-3.5">
                <GitHubCiPanel issueId={issueId} />
                <ChangedFilesView issueId={issueId} />
              </div>
            )}
            {activeTab === 'plan' && <PlanMissionTab issueId={issueId} />}
            {activeTab === 'timeline' && (
              <div className="space-y-4">
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
            {activeTab === 'discussion' && <DiscussionsTab issueId={issueId} />}
            {activeTab === 'costs' && <CostsTab issueId={issueId} />}
            {activeTab === 'artifacts' && <DrawerArtifactsPanel issueId={issueId} />}
            {activeTab === 'ship' && <ShipTab issueId={issueId} />}
            {activeTab === 'conversation' && <ConversationTab launcher={launcher} agentDock={agentDock} actionDock={actionDock} timeline={timeline} />}
            {activeTab === 'files' && <OpenPaneCard title="Files" description="Open the issue-scoped workspace file browser in a deck pane." action="Open files pane" onOpen={() => onOpenPane('files')} />}
            {activeTab === 'terminal' && <OpenPaneCard title="Terminal" description="Open the issue terminal drawer for the current workspace." action="Open terminal" onOpen={() => onOpenPane('terminal')} />}
            {activeTab === 'tasks' && <TasksTab issueId={issueId} />}
          </div>
        </main>
        <TasksRail issueId={issueId} onOpenFull={() => selectTab('tasks')} />
      </div>
    </div>
  )
}
