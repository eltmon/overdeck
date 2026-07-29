import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ProjectSessionTree, SessionNode } from '@overdeck/contracts'
import { type ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import { useIssueActions } from '../../IssueActionMenu/useIssueActions'
import {
  useActivityQuery,
  useReviewStatusQuery,
  type ReviewStatusData,
} from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { AgentsLane } from './AgentsLane'

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

export function IssueTreeLane({
  issueId,
  title,
  projectName,
  selectedSessionId,
  spineCollapsed,
  onToggleSpine,
  onSelectSession,
  onSessionsChange,
  onOpenVerification,
}: {
  issueId: string
  title: string
  projectName?: string
  selectedSessionId: string | null
  spineCollapsed: boolean
  onToggleSpine: () => void
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
      hasXbrief: actions.state.hasPlan,
      hasTasks: actions.state.hasTasks,
      hasPrd: false,
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
      <div className={`flex pb-1 ${spineCollapsed ? 'justify-center' : 'justify-end'}`}>
        <button
          type="button"
          aria-expanded={!spineCollapsed}
          aria-label={spineCollapsed ? 'Expand agent spine' : 'Collapse agent spine'}
          title={spineCollapsed ? 'Expand agent spine' : 'Collapse agent spine'}
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onToggleSpine}
        >
          {spineCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      {staleReviewers.length > 0 ? (
        <div
          data-section="Stale-review warning"
          className={`mb-2 rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/10 text-[11px] ${spineCollapsed ? 'grid place-items-center p-1' : 'px-2.5 py-2'}`}
          role="alert"
        >
          {spineCollapsed ? (
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-amber-600 hover:bg-amber-500/15 dark:text-amber-400"
              aria-label={`Stale review state: ${staleReviewers.length} leftover review agent${staleReviewers.length === 1 ? '' : 's'}. Expand agent spine for details and reset.`}
              title="Stale review state — expand agent spine for details and reset"
              onClick={onToggleSpine}
            >
              <span aria-hidden="true">⚠</span>
            </button>
          ) : (
            <>
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
            </>
          )}
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
        onExpandSpine={onToggleSpine}
      />
    </aside>
  )
}
