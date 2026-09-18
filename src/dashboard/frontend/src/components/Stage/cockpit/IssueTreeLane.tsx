import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ProjectSessionTree, SessionNode } from '@overdeck/contracts'
import { type ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import { useIssueActions } from '../../IssueActionMenu/useIssueActions'
import { useActivityQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useBackendPanes, useDerivedIssueState } from '../../../lib/store'
import type { BackendPane, DerivedIssueState } from '../../../types'
import { AgentsLane } from './AgentsLane'

/**
 * PAN-3917 FR-5: the issue tree's rows ARE the backend panes in the issue
 * workspace. A pane's `role` metadata token decides which row it is — so a
 * reviewer spawned by `pan handoff --issue` renders as the Review row, never as
 * a loose conversation.
 */
const PANE_ROLE_TO_SESSION_TYPE: Record<BackendPane['role'], SessionNode['type']> = {
  plan: 'planning',
  work: 'work',
  worker: 'work',
  review: 'review',
  test: 'test',
  uat: 'test',
  strike: 'strike',
}

/** The backend owns pane state; this is the only place it becomes a row status. */
function paneStatus(state: BackendPane['state']): { status: SessionNode['status']; presence: SessionNode['presence'] } {
  switch (state) {
    case 'working': return { status: 'running', presence: 'active' }
    case 'blocked': return { status: 'running', presence: 'active' }
    case 'idle': return { status: 'running', presence: 'idle' }
    case 'done': return { status: 'stopped', presence: 'ended' }
    case 'exited': return { status: 'stopped', presence: 'ended' }
    default: return { status: 'unknown', presence: 'ended' }
  }
}

function paneToSession(pane: BackendPane): SessionNode {
  const { status, presence } = paneStatus(pane.state)
  return {
    type: PANE_ROLE_TO_SESSION_TYPE[pane.role],
    role: pane.role,
    sessionId: pane.id,
    model: pane.model,
    harness: pane.harness,
    startedAt: new Date(0).toISOString(),
    duration: null,
    status,
    presence,
    ...(pane.terminalId ? { tmuxSession: pane.terminalId } : {}),
    ...(pane.state === 'blocked' ? { awaitingInput: true } : {}),
  }
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

const ISSUE_TREE_STATE_LABEL: Record<DerivedIssueState['state'], string> = {
  backlog: 'Backlog',
  parked: 'Parked',
  planned: 'Planned',
  working: 'In Progress',
  'in-review': 'In Review',
  'changes-requested': 'Changes requested',
  ready: 'Ready to merge',
  merged: 'Merged',
  closed: 'Done',
}

function issueTreeStateLabel(issue: DerivedIssueState | undefined): string {
  return issue ? ISSUE_TREE_STATE_LABEL[issue.state] : 'In Progress'
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
      status: 'has_state',
      stateLabel: 'In Progress',
      agentStatus: null,
      hasPlanning: false,
      hasPrd: false,
      hasState: false,
      isShadow: false,
      sessions: [],
    }
  }
  return feature
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
  const issue = useDerivedIssueState(issueId)
  const panes = useBackendPanes(issueId)
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
    // Live rows come from the backend's pane inventory; the transcript-derived
    // activity sections fill in the finished sessions the backend no longer owns.
    const base = panes.map(paneToSession)
    const paneTypes = new Set(base.map((session) => session.type))
    for (const section of activity.data?.sections ?? []) {
      const session = toCockpitSession(section)
      if (session && !paneTypes.has(session.type)) base.push(session)
    }
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
  }, [actions.state.hasPlan, activity.data?.sections, issueId, panes])

  const fallbackFeature: ProjectFeature = useMemo(() => ({
    issueId,
    title,
    projectName: projectName ?? 'Project',
    branch: '',
    status: sessions.some((session) => session.presence === 'active') ? 'running' : actions.state.hasPlan ? 'has_state' : 'idle',
    stateLabel: issueTreeStateLabel(issue),
    agentStatus: sessions.some((session) => session.presence === 'active') ? 'running' : null,
    hasPlanning: actions.state.hasPlan,
    hasPrd: actions.state.hasPlan,
    hasState: actions.state.hasPlan,
    isShadow: false,
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
  }), [actions.state.hasTasks, actions.state.hasPlan, issue, issueId, projectName, sessions, title])

  // The pane inventory is the tree (FR-5). The project-feature read only
  // supplies the surrounding metadata (title, branch, resource details) — it
  // must never replace the rows, or a Herdr-spawned reviewer would vanish
  // behind whatever the session-tree endpoint happened to remember.
  const feature: ProjectFeature = useMemo(
    () => (projectFeature.data ? { ...projectFeature.data, sessions } : fallbackFeature),
    [fallbackFeature, projectFeature.data, sessions],
  )
  const renderedSessions = sessions

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
